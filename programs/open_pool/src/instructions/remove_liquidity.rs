use crate::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Transfer};

pub fn handler(
    ctx: Context<Liquidity>,
    lp_amount: u64,
    min_base: u64,
    min_quote: u64,
) -> Result<()> {
    require!(lp_amount > 0, PoolError::ZeroAmount);
    let rb = ctx.accounts.base_vault.amount as u128;
    let rq = ctx.accounts.quote_vault.amount as u128;
    let pool = &ctx.accounts.pool;
    let supply = ctx.accounts.lp_mint.supply as u128 + pool.lp_locked as u128;
    let base_out = (lp_amount as u128 * rb / supply) as u64;
    let quote_out = (lp_amount as u128 * rq / supply) as u64;
    require!(
        base_out >= min_base && quote_out >= min_quote,
        PoolError::Slippage
    );
    let tp = ctx.accounts.token_program.to_account_info();
    token::burn(
        CpiContext::new(
            tp.clone(),
            Burn {
                mint: ctx.accounts.lp_mint.to_account_info(),
                from: ctx.accounts.user_lp.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        lp_amount,
    )?;
    let seeds: &[&[u8]] = &[
        b"pool",
        pool.base_mint.as_ref(),
        pool.quote_mint.as_ref(),
        &[pool.bump],
    ];
    let pa = ctx.accounts.pool.to_account_info();
    token::transfer(
        CpiContext::new_with_signer(
            tp.clone(),
            Transfer {
                from: ctx.accounts.base_vault.to_account_info(),
                to: ctx.accounts.user_base.to_account_info(),
                authority: pa.clone(),
            },
            &[seeds],
        ),
        base_out,
    )?;
    token::transfer(
        CpiContext::new_with_signer(
            tp,
            Transfer {
                from: ctx.accounts.quote_vault.to_account_info(),
                to: ctx.accounts.user_quote.to_account_info(),
                authority: pa,
            },
            &[seeds],
        ),
        quote_out,
    )?;
    emit!(LiquidityRemoved {
        pool: ctx.accounts.pool.key(),
        place: u64::MAX,
        owner: ctx.accounts.user.key(),
        base: base_out,
        quote: quote_out,
        lp: lp_amount,
        filled: true,
        reason: 0
    });
    Ok(())
}
