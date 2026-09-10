use crate::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct Swap<'info> {
    pub user: Signer<'info>,
    #[account(mut, has_one = base_vault, has_one = quote_vault)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(mut)]
    pub base_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub quote_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = pool.base_mint)]
    pub user_base: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = pool.quote_mint)]
    pub user_quote: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Swap>, side: u8, amount_in: u64, min_out: u64) -> Result<()> {
    require!(side <= 1, PoolError::BadSide);
    require!(amount_in > 0, PoolError::ZeroAmount);
    let rb = ctx.accounts.base_vault.amount;
    let rq = ctx.accounts.quote_vault.amount;
    require!(rb > 0 && rq > 0, PoolError::EmptyPool);
    let pool = &ctx.accounts.pool;
    let (r_in, r_out) = if side == 0 { (rq, rb) } else { (rb, rq) };
    let (out, fee) = swap_out(amount_in, r_in, r_out, pool.fee_bps);
    require!(out > 0 && out >= min_out, PoolError::Slippage);
    let tp = ctx.accounts.token_program.to_account_info();
    let (user_in, vault_in, vault_out, user_out) = if side == 0 {
        (
            ctx.accounts.user_quote.to_account_info(),
            ctx.accounts.quote_vault.to_account_info(),
            ctx.accounts.base_vault.to_account_info(),
            ctx.accounts.user_base.to_account_info(),
        )
    } else {
        (
            ctx.accounts.user_base.to_account_info(),
            ctx.accounts.base_vault.to_account_info(),
            ctx.accounts.quote_vault.to_account_info(),
            ctx.accounts.user_quote.to_account_info(),
        )
    };
    token::transfer(
        CpiContext::new(
            tp.clone(),
            Transfer {
                from: user_in,
                to: vault_in,
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount_in,
    )?;
    let seeds: &[&[u8]] = &[
        b"pool",
        pool.base_mint.as_ref(),
        pool.quote_mint.as_ref(),
        &[pool.bump],
    ];
    token::transfer(
        CpiContext::new_with_signer(
            tp,
            Transfer {
                from: vault_out,
                to: user_out,
                authority: ctx.accounts.pool.to_account_info(),
            },
            &[seeds],
        ),
        out,
    )?;
    let (nb, nq) = if side == 0 {
        (rb - out, rq + amount_in)
    } else {
        (rb + amount_in, rq - out)
    };
    let pool_key = ctx.accounts.pool.key();
    ctx.accounts.pool.swaps += 1;
    emit!(Swapped {
        pool: pool_key,
        place: u64::MAX,
        owner: ctx.accounts.user.key(),
        side,
        amount_in,
        amount_out: out,
        fee,
        filled: true,
        reason: 0,
        base_reserve: nb,
        quote_reserve: nq
    });
    Ok(())
}
