use crate::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub registrar: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = registrar)]
    pub config: Box<Account<'info, Config>>,
    pub base_mint: Box<Account<'info, Mint>>,
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(init, payer = registrar, space = 8 + Pool::INIT_SPACE,
        seeds = [b"pool", base_mint.key().as_ref(), quote_mint.key().as_ref()], bump)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(init, payer = registrar, seeds = [b"vault", pool.key().as_ref(), base_mint.key().as_ref()], bump,
        token::mint = base_mint, token::authority = pool)]
    pub base_vault: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = registrar, seeds = [b"vault", pool.key().as_ref(), quote_mint.key().as_ref()], bump,
        token::mint = quote_mint, token::authority = pool)]
    pub quote_vault: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = registrar, seeds = [b"lp", pool.key().as_ref()], bump, mint::decimals = 6, mint::authority = pool)]
    pub lp_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = base_mint, token::authority = registrar)]
    pub registrar_base: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, token::authority = registrar)]
    pub registrar_quote: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreatePool>,
    base_amount: u64,
    quote_amount: u64,
    opener: Pubkey,
    opener_label: [u8; 32],
) -> Result<()> {
    require!(base_amount > 0 && quote_amount > 0, PoolError::ZeroAmount);
    require_keys_neq!(
        ctx.accounts.base_mint.key(),
        ctx.accounts.quote_mint.key(),
        PoolError::SameMint
    );
    require!(
        ctx.accounts.base_mint.freeze_authority.is_none()
            && ctx.accounts.quote_mint.freeze_authority.is_none(),
        PoolError::FreezableMint
    );
    let slot = Clock::get()?.slot;
    let pool = &mut ctx.accounts.pool;
    pool.base_mint = ctx.accounts.base_mint.key();
    pool.quote_mint = ctx.accounts.quote_mint.key();
    pool.base_vault = ctx.accounts.base_vault.key();
    pool.quote_vault = ctx.accounts.quote_vault.key();
    pool.lp_mint = ctx.accounts.lp_mint.key();
    pool.line = Pubkey::default();
    pool.fee_bps = FEE_BPS;
    pool.opener = opener;
    pool.opener_label = opener_label;
    pool.created_slot = slot;
    pool.lp_locked = isqrt(base_amount as u128 * quote_amount as u128) as u64;
    pool.bump = ctx.bumps.pool;
    let tp = ctx.accounts.token_program.to_account_info();
    token::transfer(
        CpiContext::new(
            tp.clone(),
            Transfer {
                from: ctx.accounts.registrar_base.to_account_info(),
                to: ctx.accounts.base_vault.to_account_info(),
                authority: ctx.accounts.registrar.to_account_info(),
            },
        ),
        base_amount,
    )?;
    token::transfer(
        CpiContext::new(
            tp,
            Transfer {
                from: ctx.accounts.registrar_quote.to_account_info(),
                to: ctx.accounts.quote_vault.to_account_info(),
                authority: ctx.accounts.registrar.to_account_info(),
            },
        ),
        quote_amount,
    )?;
    emit!(PoolCreated {
        pool: pool.key(),
        base_mint: pool.base_mint,
        quote_mint: pool.quote_mint,
        line: Pubkey::default(),
        opener,
        opener_label,
        base_amount,
        quote_amount,
        slot,
    });
    Ok(())
}
