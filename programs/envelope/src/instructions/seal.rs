use crate::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[event_cpi]
#[derive(Accounts)]
pub struct Seal<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub line: Box<Account<'info, Line>>,
    #[account(init, payer = owner, space = Envelope::SPACE,
        seeds = [b"envelope", line.key().as_ref(), &line.next_place.to_le_bytes()], bump)]
    pub envelope: Box<Account<'info, Envelope>>,
    #[account(mut, token::mint = bond_mint, token::authority = owner,
        address = get_associated_token_address(&owner.key(), &bond_mint.key()) @ EnvelopeError::BondSourceNotAta)]
    pub bond_source: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = line.bond_vault)]
    pub bond_vault: Box<Account<'info, TokenAccount>>,
    #[account(address = line.bond_mint)]
    pub bond_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Seal>, fingerprint: [u8; 32], cap: u64) -> Result<()> {
    require!(cap > 0, EnvelopeError::CapZero);
    let slot = Clock::get()?.slot;
    let line = &mut ctx.accounts.line;
    require!(
        line.seal_until_slot == 0 || slot <= line.seal_until_slot,
        EnvelopeError::SealingClosed
    );
    let bond = (((cap as u128 * line.bond_bps as u128 + 9_999) / 10_000) as u64).max(line.min_bond);
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.bond_source.to_account_info(),
                to: ctx.accounts.bond_vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        bond,
    )?;
    let place = line.next_place;
    let mut deadline = if line.seal_until_slot != 0 {
        line.seal_until_slot + line.open_window
    } else {
        slot + line.open_window
    };
    if line.ordered_open && place > 0 {
        deadline = deadline.max(line.last_open_deadline + 1);
    }
    line.last_open_deadline = deadline;
    line.next_place += 1;
    line.sealed += 1;
    let line_key = line.key();
    let env = &mut ctx.accounts.envelope;
    env.line = line_key;
    env.place = place;
    env.owner = ctx.accounts.owner.key();
    env.fingerprint = fingerprint;
    env.cap = cap;
    env.bond = bond;
    env.bond_source = ctx.accounts.bond_source.key();
    env.sealed_slot = slot;
    env.open_deadline = deadline;
    env.state = STATE_SEALED;
    env.content = Vec::new();
    env.bump = ctx.bumps.envelope;
    emit_cpi!(Sealed {
        line: line_key,
        place,
        owner: env.owner,
        fingerprint,
        cap,
        bond,
        sealed_slot: slot,
        open_deadline: deadline
    });
    Ok(())
}
