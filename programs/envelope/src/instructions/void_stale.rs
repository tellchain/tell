use crate::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[event_cpi]
#[derive(Accounts)]
pub struct VoidStale<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(mut)]
    pub line: Box<Account<'info, Line>>,
    #[account(mut, has_one = line @ EnvelopeError::AccountMismatch,
        constraint = envelope.place == line.next_execute @ EnvelopeError::NotNextInLine)]
    pub envelope: Box<Account<'info, Envelope>>,
    #[account(mut, address = line.bond_vault)]
    pub bond_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = line.bond_mint)]
    pub bond_mint: Box<Account<'info, Mint>>,
    /// CHECK: PDA of this line
    #[account(seeds = [AUTHORITY_SEED, line.key().as_ref()], bump)]
    pub envelope_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<VoidStale>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let line_key = ctx.accounts.line.key();
    let (place, owner, bond, deadline, state) = {
        let e = &ctx.accounts.envelope;
        (e.place, e.owner, e.bond, e.open_deadline, e.state)
    };
    require!(
        state == STATE_SEALED || state == STATE_OPENED,
        EnvelopeError::NotOpened
    );
    let since = deadline.max(ctx.accounts.line.cursor_moved_slot);
    require!(
        slot > since.saturating_add(ctx.accounts.line.stale_slots),
        EnvelopeError::NotStale
    );
    let bump = ctx.bumps.envelope_authority;
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, line_key.as_ref(), &[bump]];
    burn_bond(
        &ctx.accounts.bond_mint.to_account_info(),
        &ctx.accounts.bond_vault.to_account_info(),
        &ctx.accounts.envelope_authority.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        seeds,
        bond,
    )?;
    let deposit = ctx.accounts.envelope.ata_deposit;
    if deposit > 0 {
        let env_ai = ctx.accounts.envelope.to_account_info();
        let c = ctx.accounts.cranker.to_account_info();
        **env_ai.try_borrow_mut_lamports()? -= deposit;
        **c.try_borrow_mut_lamports()? += deposit;
        ctx.accounts.envelope.ata_deposit = 0;
    }
    let line = &mut ctx.accounts.line;
    line.bonds_burned += bond;
    line.next_execute += 1;
    line.cursor_moved_slot = slot;
    let env = &mut ctx.accounts.envelope;
    env.state = STATE_VOIDED;
    env.executed_slot = slot;
    emit_cpi!(Voided {
        line: line_key,
        place,
        owner,
        slot,
        bond_burned: bond
    });
    Ok(())
}
