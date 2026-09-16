use crate::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::set_return_data;
use anchor_spl::token::{self, Burn, Mint, MintTo, TokenAccount, Transfer};
use envelope::OrderContent;

pub(crate) fn read_token(ai: &AccountInfo) -> Option<TokenAccount> {
    if ai.owner != &token::ID || ai.data_len() != TOKEN_ACCOUNT_LEN {
        return None;
    }
    let d = ai.try_borrow_data().ok()?;
    TokenAccount::try_deserialize(&mut &d[..]).ok()
}

pub(crate) fn read_mint(ai: &AccountInfo) -> Option<Mint> {
    if ai.owner != &token::ID {
        return None;
    }
    let d = ai.try_borrow_data().ok()?;
    Mint::try_deserialize(&mut &d[..]).ok()
}

pub(crate) fn verdict(filled: bool, reason: u8) {
    set_return_data(&[filled as u8, filled as u8, reason]);
}

pub(crate) struct Ctx<'a, 'info> {
    pub(crate) a: &'a [AccountInfo<'info>],
    pub(crate) rem: &'a [AccountInfo<'info>],
    pub(crate) cranker: AccountInfo<'info>,
    pub(crate) auth: AccountInfo<'info>,
    pub(crate) owner: Pubkey,
    pub(crate) place: u64,
    pub(crate) cap: u64,
    pub(crate) rb: u64,
    pub(crate) rq: u64,
}

impl<'a, 'info> Ctx<'a, 'info> {
    fn ensure(&self, ata: usize, mint: usize) -> Result<()> {
        envelope::ensure_ata(
            &self.a[ata],
            &self.a[6],
            &self.a[mint],
            &self.cranker,
            &self.a[12],
            &self.a[10],
            &self.a[11],
        )
    }
    fn from_escrow(&self, i: usize, to: usize, amount: u64) -> Result<()> {
        if amount == 0 {
            return Ok(());
        }
        token::transfer(
            CpiContext::new(
                self.a[10].clone(),
                Transfer {
                    from: self.rem[i].clone(),
                    to: self.a[to].clone(),
                    authority: self.auth.clone(),
                },
            ),
            amount,
        )
    }
    fn from_vault(&self, pool: &Pool, from: usize, to: usize, amount: u64) -> Result<()> {
        if amount == 0 {
            return Ok(());
        }
        let seeds: &[&[u8]] = &[
            b"pool",
            pool.base_mint.as_ref(),
            pool.quote_mint.as_ref(),
            &[pool.bump],
        ];
        token::transfer(
            CpiContext::new_with_signer(
                self.a[10].clone(),
                Transfer {
                    from: self.a[from].clone(),
                    to: self.a[to].clone(),
                    authority: self.a[0].clone(),
                },
                &[seeds],
            ),
            amount,
        )
    }
    fn escrow_amount(&self, i: usize) -> u64 {
        read_token(&self.rem[i]).map(|t| t.amount).unwrap_or(0)
    }
}

pub(crate) fn do_swap(
    k: &Ctx,
    pool: &mut Account<Pool>,
    c: &OrderContent,
    side: u8,
    amount_in: u64,
    min_out: u64,
) -> Result<u8> {
    let (owner, place) = (k.owner, k.place);
    let pk = k.a[0].key();
    let fail = |reason: u8| -> Result<u8> {
        emit!(Swapped {
            pool: pk,
            place,
            owner,
            side,
            amount_in,
            amount_out: 0,
            fee: 0,
            filled: false,
            reason,
            base_reserve: k.rb,
            quote_reserve: k.rq
        });
        Ok(reason)
    };
    if side > 1 {
        return fail(REASON_BAD_PAYLOAD);
    }
    let in_mint = if side == 0 {
        pool.quote_mint
    } else {
        pool.base_mint
    };
    if c.escrows.len() != 1 || c.escrows[0].mint != in_mint || k.escrow_amount(0) < amount_in {
        return fail(REASON_ACCOUNTS);
    }
    if amount_in == 0 {
        return fail(REASON_ZERO);
    }
    if k.rb == 0 || k.rq == 0 {
        return fail(REASON_EMPTY);
    }
    let (r_in, r_out) = if side == 0 {
        (k.rq, k.rb)
    } else {
        (k.rb, k.rq)
    };
    let (out, fee) = swap_out(amount_in, r_in, r_out, pool.fee_bps);
    let quote_side = if side == 0 { amount_in } else { out };
    if quote_side > k.cap {
        return fail(REASON_CAP);
    }
    if out == 0 || out < min_out {
        return fail(REASON_SLIPPAGE);
    }
    let (vault_in, vault_out, dest, dest_mint) = if side == 0 {
        (2, 1, 7, 4)
    } else {
        (1, 2, 8, 5)
    };
    k.ensure(dest, dest_mint)?;
    k.from_escrow(0, vault_in, amount_in)?;
    k.from_vault(pool, vault_out, dest, out)?;
    let (nb, nq) = if side == 0 {
        (k.rb - out, k.rq + amount_in)
    } else {
        (k.rb + amount_in, k.rq - out)
    };
    pool.swaps += 1;
    pool.reserve_base = nb;
    pool.reserve_quote = nq;
    pool.exit(&crate::ID)?;
    emit!(Swapped {
        pool: pk,
        place,
        owner,
        side,
        amount_in,
        amount_out: out,
        fee,
        filled: true,
        reason: REASON_OK,
        base_reserve: nb,
        quote_reserve: nq
    });
    Ok(REASON_OK)
}

pub(crate) fn do_add(
    k: &Ctx,
    pool: &mut Account<Pool>,
    c: &OrderContent,
    max_base: u64,
    max_quote: u64,
    min_lp: u64,
) -> Result<u8> {
    let (owner, place) = (k.owner, k.place);
    let pk = k.a[0].key();
    let fail = |reason: u8| -> Result<u8> {
        emit!(LiquidityAdded {
            pool: pk,
            place,
            owner,
            base: 0,
            quote: 0,
            lp: 0,
            filled: false,
            reason
        });
        Ok(reason)
    };
    if c.escrows.len() != 2
        || c.escrows[0].mint != pool.base_mint
        || c.escrows[1].mint != pool.quote_mint
    {
        return fail(REASON_ACCOUNTS);
    }
    let max_base = max_base.min(k.escrow_amount(0));
    let max_quote = max_quote.min(k.escrow_amount(1));
    if max_base == 0 || max_quote == 0 {
        return fail(REASON_ZERO);
    }
    if k.rb == 0 || k.rq == 0 {
        return fail(REASON_EMPTY);
    }
    let Some(mint) = read_mint(&k.a[3]) else {
        return fail(REASON_ACCOUNTS);
    };
    let supply = mint.supply as u128 + pool.lp_locked as u128;
    let lp =
        (max_base as u128 * supply / k.rb as u128).min(max_quote as u128 * supply / k.rq as u128);
    let base_used = ((lp * k.rb as u128 + supply - 1) / supply) as u64;
    let quote_used = ((lp * k.rq as u128 + supply - 1) / supply) as u64;
    if quote_used > k.cap {
        return fail(REASON_CAP);
    }
    if lp == 0 || (lp as u64) < min_lp || base_used > max_base || quote_used > max_quote {
        return fail(REASON_SLIPPAGE);
    }
    k.ensure(9, 3)?;
    k.from_escrow(0, 1, base_used)?;
    k.from_escrow(1, 2, quote_used)?;
    let seeds: &[&[u8]] = &[
        b"pool",
        pool.base_mint.as_ref(),
        pool.quote_mint.as_ref(),
        &[pool.bump],
    ];
    token::mint_to(
        CpiContext::new_with_signer(
            k.a[10].clone(),
            MintTo {
                mint: k.a[3].clone(),
                to: k.a[9].clone(),
                authority: k.a[0].clone(),
            },
            &[seeds],
        ),
        lp as u64,
    )?;
    pool.reserve_base = k.rb + base_used;
    pool.reserve_quote = k.rq + quote_used;
    pool.exit(&crate::ID)?;
    emit!(LiquidityAdded {
        pool: pk,
        place,
        owner,
        base: base_used,
        quote: quote_used,
        lp: lp as u64,
        filled: true,
        reason: REASON_OK
    });
    Ok(REASON_OK)
}

pub(crate) fn do_remove(
    k: &Ctx,
    pool: &mut Account<Pool>,
    c: &OrderContent,
    lp_amount: u64,
    min_base: u64,
    min_quote: u64,
) -> Result<u8> {
    let (owner, place) = (k.owner, k.place);
    let pk = k.a[0].key();
    let fail = |reason: u8| -> Result<u8> {
        emit!(LiquidityRemoved {
            pool: pk,
            place,
            owner,
            base: 0,
            quote: 0,
            lp: 0,
            filled: false,
            reason
        });
        Ok(reason)
    };
    if c.escrows.len() != 1 || c.escrows[0].mint != pool.lp_mint {
        return fail(REASON_ACCOUNTS);
    }
    let lp_amount = lp_amount.min(k.escrow_amount(0));
    if lp_amount == 0 {
        return fail(REASON_ZERO);
    }
    let Some(mint) = read_mint(&k.a[3]) else {
        return fail(REASON_ACCOUNTS);
    };
    let supply = mint.supply as u128 + pool.lp_locked as u128;
    let base_out = (lp_amount as u128 * k.rb as u128 / supply) as u64;
    let quote_out = (lp_amount as u128 * k.rq as u128 / supply) as u64;
    if quote_out > k.cap {
        return fail(REASON_CAP);
    }
    if base_out < min_base || quote_out < min_quote {
        return fail(REASON_SLIPPAGE);
    }
    k.ensure(7, 4)?;
    k.ensure(8, 5)?;
    token::burn(
        CpiContext::new(
            k.a[10].clone(),
            Burn {
                mint: k.a[3].clone(),
                from: k.rem[0].clone(),
                authority: k.auth.clone(),
            },
        ),
        lp_amount,
    )?;
    k.from_vault(pool, 1, 7, base_out)?;
    k.from_vault(pool, 2, 8, quote_out)?;
    pool.reserve_base = k.rb - base_out;
    pool.reserve_quote = k.rq - quote_out;
    pool.exit(&crate::ID)?;
    emit!(LiquidityRemoved {
        pool: pk,
        place,
        owner,
        base: base_out,
        quote: quote_out,
        lp: lp_amount,
        filled: true,
        reason: REASON_OK
    });
    Ok(REASON_OK)
}
