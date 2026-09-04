use crate::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct ReclaimEscrow<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(has_one = owner @ EnvelopeError::AccountMismatch)]
    pub envelope: Box<Account<'info, Envelope>>,
    #[account(mut, token::authority = envelope_authority)]
    pub escrow: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = escrow.mint)]
    pub destination: Box<Account<'info, TokenAccount>>,
    /// CHECK: PDA of the envelope's line
    #[account(seeds = [AUTHORITY_SEED, envelope.line.as_ref()], bump)]
    pub envelope_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ReclaimEscrow>, index: u8) -> Result<()> {
    let env = &ctx.accounts.envelope;
    require!(
        env.state == STATE_VOIDED || env.state == STATE_EXECUTED,
        EnvelopeError::NotOpened
    );
    let (ek, _) = escrow_address(&env.key(), index);
    require_keys_eq!(
        ctx.accounts.escrow.key(),
        ek,
        EnvelopeError::AccountMismatch
    );
    let line_key = env.line;
    let bump = ctx.bumps.envelope_authority;
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, line_key.as_ref(), &[bump]];
    let amount = ctx.accounts.escrow.amount;
    let tp = ctx.accounts.token_program.to_account_info();
    if amount > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                tp.clone(),
                Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.envelope_authority.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
    }
    token::close_account(CpiContext::new_with_signer(
        tp,
        CloseAccount {
            account: ctx.accounts.escrow.to_account_info(),
            destination: ctx.accounts.owner.to_account_info(),
            authority: ctx.accounts.envelope_authority.to_account_info(),
        },
        &[seeds],
    ))?;
    Ok(())
}
