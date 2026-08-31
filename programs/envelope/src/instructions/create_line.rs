use crate::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

#[event_cpi]
#[derive(Accounts)]
pub struct CreateLine<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub market: Signer<'info>,
    #[account(init, payer = payer, space = 8 + Line::INIT_SPACE, seeds = [b"line", market.key().as_ref()], bump)]
    pub line: Box<Account<'info, Line>>,
    pub bond_mint: Box<Account<'info, Mint>>,
    #[account(init, payer = payer, seeds = [b"bond_vault", line.key().as_ref()], bump,
        token::mint = bond_mint, token::authority = envelope_authority)]
    pub bond_vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: PDA of this line, signs for its vaults and its consumer
    #[account(seeds = [AUTHORITY_SEED, line.key().as_ref()], bump)]
    pub envelope_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateLine>,
    open_window: u64,
    bond_bps: u16,
    min_bond: u64,
    stale_slots: u64,
    seal_until_slot: u64,
    ordered_open: bool,
) -> Result<()> {
    require!(
        open_window >= 1 && open_window <= MAX_WINDOW,
        EnvelopeError::BadParams
    );
    require!(bond_bps <= 10_000 && min_bond > 0, EnvelopeError::BadParams);
    require!(
        stale_slots >= MIN_STALE_SLOTS && stale_slots <= MAX_STALE_SLOTS,
        EnvelopeError::BadParams
    );
    require!(
        ctx.accounts.bond_mint.key() != NATIVE_MINT,
        EnvelopeError::NativeMint
    );
    let consumer = *ctx.accounts.market.to_account_info().owner;
    require!(consumer != System::id(), EnvelopeError::BadParams);
    require!(
        ctx.accounts.bond_mint.freeze_authority.is_none(),
        EnvelopeError::FreezableMint
    );
    let line = &mut ctx.accounts.line;
    line.market = ctx.accounts.market.key();
    line.consumer = consumer;
    line.bond_mint = ctx.accounts.bond_mint.key();
    line.bond_vault = ctx.accounts.bond_vault.key();
    line.bond_bps = bond_bps;
    line.min_bond = min_bond;
    line.stale_slots = stale_slots;
    line.open_window = open_window;
    line.seal_until_slot = seal_until_slot;
    line.ordered_open = ordered_open;
    line.cursor_moved_slot = Clock::get()?.slot;
    line.bump = ctx.bumps.line;
    emit_cpi!(LineCreated {
        line: line.key(),
        market: line.market,
        consumer,
        bond_mint: line.bond_mint,
        bond_bps,
        min_bond,
        stale_slots,
        open_window,
        seal_until_slot,
        ordered_open,
    });
    Ok(())
}
