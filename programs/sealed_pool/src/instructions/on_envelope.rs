use crate::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::{get_associated_token_address, ID as ATA_ID};
use anchor_spl::token::{self};
use envelope::{Envelope, Line, OrderContent, STATE_OPENED};

#[derive(Accounts)]
pub struct OnEnvelope<'info> {
    pub envelope_authority: Signer<'info>,
    pub envelope: Box<Account<'info, Envelope>>,
    pub line: Box<Account<'info, Line>>,
    #[account(mut)]
    pub cranker: Signer<'info>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, OnEnvelope<'info>>,
    owner: Pubkey,
    place: u64,
    cap: u64,
    payload: Vec<u8>,
) -> Result<()> {
    let line_key = ctx.accounts.line.key();
    require_keys_eq!(
        ctx.accounts.envelope_authority.key(),
        envelope::authority_address(&line_key).0,
        PoolError::NotEnvelope
    );
    let env = &ctx.accounts.envelope;
    require!(
        env.state == STATE_OPENED && env.place == place && env.owner == owner,
        PoolError::NotEnvelope
    );
    require_keys_eq!(env.line, line_key, PoolError::NotEnvelope);
    require_keys_eq!(
        ctx.accounts.line.consumer,
        crate::ID,
        PoolError::NotEnvelope
    );
    let env_key = env.key();
    let c =
        OrderContent::try_from_slice(&env.content).map_err(|_| error!(PoolError::NotEnvelope))?;
    let n = c.escrows.len();
    let rem = ctx.remaining_accounts;
    require!(rem.len() >= n + 13, PoolError::AccountMismatch);
    for i in 0..n {
        require_keys_eq!(
            rem[i].key(),
            envelope::escrow_address(&env_key, i as u8).0,
            PoolError::AccountMismatch
        );
        require!(rem[i].is_writable, PoolError::AccountMismatch);
    }
    let a = &rem[n..];
    let w = |ai: &AccountInfo, key: Pubkey| -> Result<()> {
        require_keys_eq!(ai.key(), key, PoolError::AccountMismatch);
        require!(ai.is_writable, PoolError::AccountMismatch);
        Ok(())
    };
    require_keys_eq!(
        a[0].key(),
        ctx.accounts.line.market,
        PoolError::AccountMismatch
    );
    require!(
        a[0].owner == &crate::ID && a[0].is_writable,
        PoolError::AccountMismatch
    );
    let mut pool: Account<'info, Pool> = Account::try_from(&a[0])?;
    w(&a[1], pool.base_vault)?;
    w(&a[2], pool.quote_vault)?;
    w(&a[3], pool.lp_mint)?;
    require_keys_eq!(a[4].key(), pool.base_mint, PoolError::AccountMismatch);
    require_keys_eq!(a[5].key(), pool.quote_mint, PoolError::AccountMismatch);
    require_keys_eq!(a[6].key(), owner, PoolError::AccountMismatch);
    w(&a[7], get_associated_token_address(&owner, &pool.base_mint))?;
    w(
        &a[8],
        get_associated_token_address(&owner, &pool.quote_mint),
    )?;
    w(&a[9], get_associated_token_address(&owner, &pool.lp_mint))?;
    require_keys_eq!(a[10].key(), token::ID, PoolError::AccountMismatch);
    require_keys_eq!(a[11].key(), ATA_ID, PoolError::AccountMismatch);
    require_keys_eq!(a[12].key(), System::id(), PoolError::AccountMismatch);

    let order = match Order::try_from_slice(&payload) {
        Ok(o) => o,
        Err(_) => {
            emit!(Swapped {
                pool: a[0].key(),
                place,
                owner,
                side: 0,
                amount_in: 0,
                amount_out: 0,
                fee: 0,
                filled: false,
                reason: REASON_BAD_PAYLOAD,
                base_reserve: 0,
                quote_reserve: 0
            });
            verdict(false, REASON_BAD_PAYLOAD);
            return Ok(());
        }
    };
    let (rb, rq) = (pool.reserve_base, pool.reserve_quote);
    let k = Ctx {
        a,
        rem,
        cranker: ctx.accounts.cranker.to_account_info(),
        auth: ctx.accounts.envelope_authority.to_account_info(),
        owner,
        place,
        cap,
        rb,
        rq,
    };
    let reason = match order {
        Order::Swap {
            side,
            amount_in,
            min_out,
        } => do_swap(&k, &mut pool, &c, side, amount_in, min_out)?,
        Order::AddLiquidity {
            max_base,
            max_quote,
            min_lp,
        } => do_add(&k, &mut pool, &c, max_base, max_quote, min_lp)?,
        Order::RemoveLiquidity {
            lp_amount,
            min_base,
            min_quote,
        } => do_remove(&k, &mut pool, &c, lp_amount, min_base, min_quote)?,
    };
    verdict(reason == REASON_OK, reason);
    Ok(())
}
