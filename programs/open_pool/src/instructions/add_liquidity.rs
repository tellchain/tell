use crate::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct Liquidity<'info> {
    pub user: Signer<'info>,
    #[account(mut, has_one = base_vault, has_one = quote_vault, has_one = lp_mint)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(mut)]
    pub base_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub quote_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub lp_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = pool.base_mint)]
    pub user_base: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = pool.quote_mint)]
    pub user_quote: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = lp_mint)]
    pub user_lp: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Liquidity>, max_base: u64, max_quote: u64, min_lp: u64) -> Result<()> {
    require!(max_base > 0 && max_quote > 0, PoolError::ZeroAmount);
    let rb = ctx.accounts.base_vault.amount as u128;
    let rq = ctx.accounts.quote_vault.amount as u128;
    require!(rb > 0 && rq > 0, PoolError::EmptyPool);
    let pool = &ctx.accounts.pool;
    let supply = ctx.accounts.lp_mint.supply as u128 + pool.lp_locked as u128;
    let lp = (max_base as u128 * supply / rb).min(max_quote as u128 * supply / rq);
    let base_used = ((lp * rb + supply - 1) / supply) as u64;
    let quote_used = ((lp * rq + supply - 1) / supply) as u64;
    require!(
        lp > 0 && lp as u64 >= min_lp && base_used <= max_base && quote_used <= max_quote,
        PoolError::Slippage
    );
    let tp = ctx.accounts.token_program.to_account_info();
    let user = ctx.accounts.user.to_account_info();
    token::transfer(
        CpiContext::new(
            tp.clone(),
            Transfer {
                from: ctx.accounts.user_base.to_account_info(),
                to: ctx.accounts.base_vault.to_account_info(),
                authority: user.clone(),
            },
        ),
        base_used,
    )?;
    token::transfer(
        CpiContext::new(
            tp.clone(),
            Transfer {
                from: ctx.accounts.user_quote.to_account_info(),
                to: ctx.accounts.quote_vault.to_account_info(),
                authority: user,
            },
        ),
        quote_used,
    )?;
    let seeds: &[&[u8]] = &[
        b"pool",
        pool.base_mint.as_ref(),
        pool.quote_mint.as_ref(),
        &[pool.bump],
    ];
    token::mint_to(
        CpiContext::new_with_signer(
            tp,
            MintTo {
                mint: ctx.accounts.lp_mint.to_account_info(),
                to: ctx.accounts.user_lp.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            &[seeds],
        ),
        lp as u64,
    )?;
    emit!(LiquidityAdded {
        pool: ctx.accounts.pool.key(),
        place: u64::MAX,
        owner: ctx.accounts.user.key(),
        base: base_used,
        quote: quote_used,
        lp: lp as u64,
        filled: true,
        reason: 0
    });
    Ok(())
}
