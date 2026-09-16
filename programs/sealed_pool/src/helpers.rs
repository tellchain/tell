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
