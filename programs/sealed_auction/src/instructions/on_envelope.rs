use crate::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::{get_associated_token_address, ID as ATA_ID};
use anchor_spl::token::{self, Transfer};
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
        AuctionError::NotEnvelope
    );
    let env = &ctx.accounts.envelope;
    require!(
        env.state == STATE_OPENED && env.place == place && env.owner == owner,
        AuctionError::NotEnvelope
    );
    require_keys_eq!(env.line, line_key, AuctionError::NotEnvelope);
    require_keys_eq!(
        ctx.accounts.line.consumer,
        crate::ID,
        AuctionError::NotEnvelope
    );
    let env_key = env.key();
    let c = OrderContent::try_from_slice(&env.content)
        .map_err(|_| error!(AuctionError::NotEnvelope))?;
    let n = c.escrows.len();
    let rem = ctx.remaining_accounts;
    require!(rem.len() >= n + 10, AuctionError::AccountMismatch);
    for i in 0..n {
        require_keys_eq!(
            rem[i].key(),
            envelope::escrow_address(&env_key, i as u8).0,
            AuctionError::AccountMismatch
        );
        require!(rem[i].is_writable, AuctionError::AccountMismatch);
    }
    let a = &rem[n..];
    let w = |ai: &AccountInfo, key: Pubkey| -> Result<()> {
        require_keys_eq!(ai.key(), key, AuctionError::AccountMismatch);
        require!(ai.is_writable, AuctionError::AccountMismatch);
        Ok(())
    };
    require_keys_eq!(
        a[0].key(),
        ctx.accounts.line.market,
        AuctionError::AccountMismatch
    );
    require!(
        a[0].owner == &crate::ID && a[0].is_writable,
        AuctionError::AccountMismatch
    );
    let mut lot: Account<'info, Lot> = Account::try_from(&a[0])?;
    w(&a[1], lot.bid_vault)?;
    require_keys_eq!(a[2].key(), lot.quote_mint, AuctionError::AccountMismatch);
    require_keys_eq!(a[3].key(), owner, AuctionError::AccountMismatch);
    w(&a[4], get_associated_token_address(&owner, &lot.quote_mint))?;
    require_keys_eq!(a[5].key(), lot.best_bidder, AuctionError::AccountMismatch);
    w(
        &a[6],
        get_associated_token_address(&lot.best_bidder, &lot.quote_mint),
    )?;
    require_keys_eq!(a[7].key(), token::ID, AuctionError::AccountMismatch);
    require_keys_eq!(a[8].key(), ATA_ID, AuctionError::AccountMismatch);
    require_keys_eq!(a[9].key(), System::id(), AuctionError::AccountMismatch);
    let lot_key = a[0].key();
    let done = |reason: u8, amount: u64| -> Result<()> {
        emit!(BidExecuted {
            lot: lot_key,
            place,
            bidder: owner,
            amount,
            best: reason == REASON_OK,
            reason
        });
        verdict(reason);
        Ok(())
    };
    let amount = match Order::try_from_slice(&payload) {
        Ok(Order::Bid { amount }) => amount,
        Err(_) => return done(REASON_BAD_PAYLOAD, 0),
    };
    if lot.state != LOT_OPEN {
        return done(REASON_ACCOUNTS, amount);
    }
    lot.bids_executed += 1;
    let esc = if n == 1 && c.escrows[0].mint == lot.quote_mint {
        read_token(&rem[0]).map(|t| t.amount).unwrap_or(0)
    } else {
        0
    };
    let reason = if n != 1 || c.escrows[0].mint != lot.quote_mint {
        REASON_ACCOUNTS
    } else if amount == 0 {
        REASON_ZERO
    } else if amount > esc {
        REASON_ACCOUNTS
    } else if amount > cap {
        REASON_CAP
    } else if amount < lot.reserve {
        REASON_BELOW_RESERVE
    } else if lot.best_bid > 0 && amount <= lot.best_bid {
        REASON_OUTBID
    } else {
        REASON_OK
    };
    if reason != REASON_OK {
        lot.exit(&crate::ID)?;
        return done(reason, amount);
    }
    let tp = a[7].clone();
    token::transfer(
        CpiContext::new(
            tp.clone(),
            Transfer {
                from: rem[0].clone(),
                to: a[1].clone(),
                authority: ctx.accounts.envelope_authority.to_account_info(),
            },
        ),
        amount,
    )?;
    if lot.best_bid > 0 {
        envelope::ensure_ata(
            &a[6],
            &a[5],
            &a[2],
            &ctx.accounts.cranker.to_account_info(),
            &a[9],
            &a[7],
            &a[8],
        )?;
        let id = lot.lot_id.to_le_bytes();
        let seeds: &[&[u8]] = &[b"lot", lot.seller.as_ref(), &id, &[lot.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                tp,
                Transfer {
                    from: a[1].clone(),
                    to: a[6].clone(),
                    authority: a[0].clone(),
                },
                &[seeds],
            ),
            lot.best_bid,
        )?;
    }
    lot.best_bid = amount;
    lot.best_bidder = owner;
    lot.best_place = place;
    lot.exit(&crate::ID)?;
    done(REASON_OK, amount)
}
