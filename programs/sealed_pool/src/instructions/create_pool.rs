use crate::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use envelope::program::Envelope as EnvelopeProgram;

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
    #[account(init, payer = registrar, seeds = [b"lp", pool.key().as_ref()], bump,
        mint::decimals = 6, mint::authority = pool)]
    pub lp_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = base_mint, token::authority = registrar)]
    pub registrar_base: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, token::authority = registrar)]
    pub registrar_quote: Box<Account<'info, TokenAccount>>,
    /// CHECK: created by envelope.create_line (PDA ["line", pool] of the envelope program)
    #[account(mut)]
    pub line: UncheckedAccount<'info>,
    /// CHECK: created by envelope.create_line
    #[account(mut)]
    pub bond_vault: UncheckedAccount<'info>,
    /// CHECK: the envelope authority PDA, checked by the envelope program
    pub envelope_authority: UncheckedAccount<'info>,
    /// CHECK: the envelope program's event authority, checked by the envelope program
    pub envelope_event_authority: UncheckedAccount<'info>,
    pub envelope_program: Program<'info, EnvelopeProgram>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<CreatePool>,
    open_window: u64,
    bond_bps: u16,
    min_bond: u64,
    stale_slots: u64,
    base_amount: u64,
    quote_amount: u64,
    opener: Pubkey,
    opener_label: [u8; 32],
    ordered_open: bool,
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
    require!(
        ctx.accounts.base_mint.key() != envelope::NATIVE_MINT
            && ctx.accounts.quote_mint.key() != envelope::NATIVE_MINT,
        PoolError::FreezableMint
    );
    let pool_key = ctx.accounts.pool.key();
    let base_key = ctx.accounts.base_mint.key();
    let quote_key = ctx.accounts.quote_mint.key();
    let (line_key, _) = Pubkey::find_program_address(&[b"line", pool_key.as_ref()], &envelope::ID);
    require_keys_eq!(
        ctx.accounts.line.key(),
        line_key,
        PoolError::AccountMismatch
    );
    let slot = Clock::get()?.slot;
    {
        let pool = &mut ctx.accounts.pool;
        pool.base_mint = base_key;
        pool.quote_mint = quote_key;
        pool.base_vault = ctx.accounts.base_vault.key();
        pool.quote_vault = ctx.accounts.quote_vault.key();
        pool.lp_mint = ctx.accounts.lp_mint.key();
        pool.line = line_key;
        pool.fee_bps = FEE_BPS;
        pool.opener = opener;
        pool.opener_label = opener_label;
        pool.created_slot = slot;
        pool.lp_locked = isqrt(base_amount as u128 * quote_amount as u128) as u64;
        pool.reserve_base = base_amount;
        pool.reserve_quote = quote_amount;
        pool.bump = ctx.bumps.pool;
    }
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
            tp.clone(),
            Transfer {
                from: ctx.accounts.registrar_quote.to_account_info(),
                to: ctx.accounts.quote_vault.to_account_info(),
                authority: ctx.accounts.registrar.to_account_info(),
            },
        ),
        quote_amount,
    )?;
    ctx.accounts.pool.exit(&crate::ID)?;
    let bump = ctx.accounts.pool.bump;
    let seeds: &[&[u8]] = &[b"pool", base_key.as_ref(), quote_key.as_ref(), &[bump]];
    envelope::cpi::create_line(
        CpiContext::new_with_signer(
            ctx.accounts.envelope_program.to_account_info(),
            envelope::cpi::accounts::CreateLine {
                payer: ctx.accounts.registrar.to_account_info(),
                market: ctx.accounts.pool.to_account_info(),
                line: ctx.accounts.line.to_account_info(),
                bond_mint: ctx.accounts.quote_mint.to_account_info(),
                bond_vault: ctx.accounts.bond_vault.to_account_info(),
                envelope_authority: ctx.accounts.envelope_authority.to_account_info(),
                token_program: tp.clone(),
                system_program: ctx.accounts.system_program.to_account_info(),
                event_authority: ctx.accounts.envelope_event_authority.to_account_info(),
                program: ctx.accounts.envelope_program.to_account_info(),
            },
            &[seeds],
        ),
        open_window,
        bond_bps,
        min_bond,
        stale_slots,
        0,
        ordered_open,
    )?;
    emit!(PoolCreated {
        pool: pool_key,
        base_mint: base_key,
        quote_mint: quote_key,
        line: line_key,
        opener,
        opener_label,
        base_amount,
        quote_amount,
        slot
    });
    Ok(())
}
