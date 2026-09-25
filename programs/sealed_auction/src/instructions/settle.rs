use crate::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::{get_associated_token_address, AssociatedToken};
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use envelope::Line;

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, has_one = line, has_one = lot_vault, has_one = bid_vault, has_one = lot_mint, has_one = quote_mint, has_one = seller)]
    pub lot: Box<Account<'info, Lot>>,
    pub line: Box<Account<'info, Line>>,
    #[account(mut)]
    pub lot_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub bid_vault: Box<Account<'info, TokenAccount>>,
    pub lot_mint: Box<Account<'info, Mint>>,
    pub quote_mint: Box<Account<'info, Mint>>,
    /// CHECK: the seller (lot.seller)
    pub seller: UncheckedAccount<'info>,
    /// CHECK: the seller's associated quote account, re-created if closed
    #[account(mut, address = get_associated_token_address(&lot.seller, &lot.quote_mint) @ AuctionError::AccountMismatch)]
    pub seller_quote: UncheckedAccount<'info>,
    /// CHECK: the seller's associated lot-mint account, re-created if closed
    #[account(mut, address = get_associated_token_address(&lot.seller, &lot.lot_mint) @ AuctionError::AccountMismatch)]
    pub seller_lot: UncheckedAccount<'info>,
    /// CHECK: the best bidder (lot.best_bidder)
    #[account(address = lot.best_bidder @ AuctionError::AccountMismatch)]
    pub winner: UncheckedAccount<'info>,
    /// CHECK: the best bidder's associated lot-mint account, re-created if closed
    #[account(mut, address = get_associated_token_address(&lot.best_bidder, &lot.lot_mint) @ AuctionError::AccountMismatch)]
    pub winner_receive: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Settle>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let lot = &ctx.accounts.lot;
    let line = &ctx.accounts.line;
    require!(lot.state == LOT_OPEN, AuctionError::Settled);
    require!(
        slot > lot.close_slot + lot.reveal_window,
        AuctionError::NotClosed
    );
    require!(
        line.next_execute == line.next_place,
        AuctionError::BidsPending
    );
    let id = lot.lot_id.to_le_bytes();
    let seeds: &[&[u8]] = &[b"lot", lot.seller.as_ref(), &id, &[lot.bump]];
    let tp = ctx.accounts.token_program.to_account_info();
    let lot_ai = ctx.accounts.lot.to_account_info();
    let lot_key = ctx.accounts.lot.key();
    let (best, amount, winner, place) = (
        lot.best_bid,
        lot.lot_amount,
        lot.best_bidder,
        lot.best_place,
    );
    let payer = ctx.accounts.payer.to_account_info();
    let sys = ctx.accounts.system_program.to_account_info();
    let ata = ctx.accounts.associated_token_program.to_account_info();
    if best > 0 {
        envelope::ensure_ata(
            &ctx.accounts.seller_quote,
            &ctx.accounts.seller,
            &ctx.accounts.quote_mint.to_account_info(),
            &payer,
            &sys,
            &tp,
            &ata,
        )?;
        envelope::ensure_ata(
            &ctx.accounts.winner_receive,
            &ctx.accounts.winner,
            &ctx.accounts.lot_mint.to_account_info(),
            &payer,
            &sys,
            &tp,
            &ata,
        )?;
        token::transfer(
            CpiContext::new_with_signer(
                tp.clone(),
                Transfer {
                    from: ctx.accounts.bid_vault.to_account_info(),
                    to: ctx.accounts.seller_quote.to_account_info(),
                    authority: lot_ai.clone(),
                },
                &[seeds],
            ),
            best,
        )?;
        token::transfer(
            CpiContext::new_with_signer(
                tp,
                Transfer {
                    from: ctx.accounts.lot_vault.to_account_info(),
                    to: ctx.accounts.winner_receive.to_account_info(),
                    authority: lot_ai,
                },
                &[seeds],
            ),
            amount,
        )?;
        ctx.accounts.lot.state = LOT_SETTLED;
        emit!(LotSettled {
            lot: lot_key,
            winner,
            price: best,
            place,
            slot
        });
    } else {
        envelope::ensure_ata(
            &ctx.accounts.seller_lot,
            &ctx.accounts.seller,
            &ctx.accounts.lot_mint.to_account_info(),
            &payer,
            &sys,
            &tp,
            &ata,
        )?;
        token::transfer(
            CpiContext::new_with_signer(
                tp,
                Transfer {
                    from: ctx.accounts.lot_vault.to_account_info(),
                    to: ctx.accounts.seller_lot.to_account_info(),
                    authority: lot_ai,
                },
                &[seeds],
            ),
            amount,
        )?;
        ctx.accounts.lot.state = LOT_NO_BID;
        emit!(LotNoBid { lot: lot_key, slot });
    }
    Ok(())
}
