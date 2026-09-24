use crate::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use envelope::program::Envelope as EnvelopeProgram;

#[derive(Accounts)]
#[instruction(lot_id: u64)]
pub struct ListLot<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    pub lot_mint: Box<Account<'info, Mint>>,
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(init, payer = seller, space = 8 + Lot::INIT_SPACE, seeds = [b"lot", seller.key().as_ref(), &lot_id.to_le_bytes()], bump)]
    pub lot: Box<Account<'info, Lot>>,
    #[account(init, payer = seller, seeds = [b"lot_vault", lot.key().as_ref()], bump, token::mint = lot_mint, token::authority = lot)]
    pub lot_vault: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = seller, seeds = [b"bid_vault", lot.key().as_ref()], bump, token::mint = quote_mint, token::authority = lot)]
    pub bid_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = lot_mint, token::authority = seller)]
    pub seller_lot: Box<Account<'info, TokenAccount>>,
    /// CHECK: created by envelope.create_line
    #[account(mut)]
    pub line: UncheckedAccount<'info>,
    /// CHECK: created by envelope.create_line
    #[account(mut)]
    pub bond_vault: UncheckedAccount<'info>,
    /// CHECK: checked by the envelope program
    pub envelope_authority: UncheckedAccount<'info>,
    /// CHECK: checked by the envelope program
    pub envelope_event_authority: UncheckedAccount<'info>,
    pub envelope_program: Program<'info, EnvelopeProgram>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<ListLot>,
    lot_id: u64,
    lot_amount: u64,
    reserve: u64,
    close_slot: u64,
    reveal_window: u64,
    bond_bps: u16,
    min_bond: u64,
    stale_slots: u64,
) -> Result<()> {
    require!(lot_amount > 0, AuctionError::ZeroAmount);
    require!(
        ctx.accounts.lot_mint.freeze_authority.is_none()
            && ctx.accounts.quote_mint.freeze_authority.is_none(),
        AuctionError::FreezableMint
    );
    require!(
        ctx.accounts.lot_mint.key() != envelope::NATIVE_MINT
            && ctx.accounts.quote_mint.key() != envelope::NATIVE_MINT,
        AuctionError::FreezableMint
    );
    let slot = Clock::get()?.slot;
    require!(close_slot > slot, AuctionError::BadClose);
    let lot_key = ctx.accounts.lot.key();
    let (line_key, _) = Pubkey::find_program_address(&[b"line", lot_key.as_ref()], &envelope::ID);
    require_keys_eq!(
        ctx.accounts.line.key(),
        line_key,
        AuctionError::AccountMismatch
    );
    let seller = ctx.accounts.seller.key();
    {
        let lot = &mut ctx.accounts.lot;
        lot.seller = seller;
        lot.lot_id = lot_id;
        lot.lot_mint = ctx.accounts.lot_mint.key();
        lot.lot_amount = lot_amount;
        lot.lot_vault = ctx.accounts.lot_vault.key();
        lot.quote_mint = ctx.accounts.quote_mint.key();
        lot.bid_vault = ctx.accounts.bid_vault.key();
        lot.reserve = reserve;
        lot.close_slot = close_slot;
        lot.reveal_window = reveal_window;
        lot.line = line_key;
        lot.state = LOT_OPEN;
        lot.bump = ctx.bumps.lot;
    }
    let tp = ctx.accounts.token_program.to_account_info();
    token::transfer(
        CpiContext::new(
            tp.clone(),
            Transfer {
                from: ctx.accounts.seller_lot.to_account_info(),
                to: ctx.accounts.lot_vault.to_account_info(),
                authority: ctx.accounts.seller.to_account_info(),
            },
        ),
        lot_amount,
    )?;
    ctx.accounts.lot.exit(&crate::ID)?;
    let id = lot_id.to_le_bytes();
    let bump = ctx.accounts.lot.bump;
    let seeds: &[&[u8]] = &[b"lot", seller.as_ref(), &id, &[bump]];
    envelope::cpi::create_line(
        CpiContext::new_with_signer(
            ctx.accounts.envelope_program.to_account_info(),
            envelope::cpi::accounts::CreateLine {
                payer: ctx.accounts.seller.to_account_info(),
                market: ctx.accounts.lot.to_account_info(),
                line: ctx.accounts.line.to_account_info(),
                bond_mint: ctx.accounts.quote_mint.to_account_info(),
                bond_vault: ctx.accounts.bond_vault.to_account_info(),
                envelope_authority: ctx.accounts.envelope_authority.to_account_info(),
                token_program: tp,
                system_program: ctx.accounts.system_program.to_account_info(),
                event_authority: ctx.accounts.envelope_event_authority.to_account_info(),
                program: ctx.accounts.envelope_program.to_account_info(),
            },
            &[seeds],
        ),
        reveal_window,
        bond_bps,
        min_bond,
        stale_slots,
        close_slot,
        false,
    )?;
    emit!(LotListed {
        lot: lot_key,
        seller,
        lot_mint: ctx.accounts.lot_mint.key(),
        lot_amount,
        reserve,
        close_slot,
        reveal_window,
        line: line_key
    });
    Ok(())
}
