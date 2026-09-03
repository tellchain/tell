use crate::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{get_return_data, invoke_signed},
};
use anchor_spl::associated_token::{get_associated_token_address, AssociatedToken};
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

#[event_cpi]
#[derive(Accounts)]
pub struct Execute<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(mut)]
    pub line: Box<Account<'info, Line>>,
    #[account(mut, has_one = line @ EnvelopeError::AccountMismatch,
        constraint = envelope.place == line.next_execute @ EnvelopeError::NotNextInLine)]
    pub envelope: Box<Account<'info, Envelope>>,
    /// CHECK: the envelope's owner, read only (authority of its associated accounts when they are re-created)
    #[account(address = envelope.owner @ EnvelopeError::AccountMismatch)]
    pub owner: UncheckedAccount<'info>,
    /// CHECK: the owner's associated bond-mint account (fixed at seal); re-created when closed
    #[account(mut, address = envelope.bond_source @ EnvelopeError::AccountMismatch)]
    pub bond_source: UncheckedAccount<'info>,
    #[account(mut, address = line.bond_vault)]
    pub bond_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = line.bond_mint)]
    pub bond_mint: Box<Account<'info, Mint>>,
    /// CHECK: PDA of this line
    #[account(seeds = [AUTHORITY_SEED, line.key().as_ref()], bump)]
    pub envelope_authority: UncheckedAccount<'info>,
    /// CHECK: must equal line.consumer
    #[account(address = line.consumer @ EnvelopeError::WrongConsumer)]
    pub consumer_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, Execute<'info>>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let line_key = ctx.accounts.line.key();
    let env_key = ctx.accounts.envelope.key();
    let (env_state, env_deadline, place, owner, bond, cap) = {
        let e = &ctx.accounts.envelope;
        (e.state, e.open_deadline, e.place, e.owner, e.bond, e.cap)
    };
    require!(slot > env_deadline, EnvelopeError::WindowNotOver);
    let auth_bump = ctx.bumps.envelope_authority;
    let auth_seeds: &[&[u8]] = &[AUTHORITY_SEED, line_key.as_ref(), &[auth_bump]];
    let tp = ctx.accounts.token_program.to_account_info();
    let auth_ai = ctx.accounts.envelope_authority.to_account_info();

    if env_state == STATE_SEALED {
        burn_bond(
            &ctx.accounts.bond_mint.to_account_info(),
            &ctx.accounts.bond_vault.to_account_info(),
            &auth_ai,
            &tp,
            auth_seeds,
            bond,
        )?;
        let line = &mut ctx.accounts.line;
        line.skipped += 1;
        line.bonds_burned += bond;
        line.next_execute += 1;
        line.cursor_moved_slot = slot;
        let env = &mut ctx.accounts.envelope;
        env.state = STATE_SKIPPED;
        env.executed_slot = slot;
        emit_cpi!(Skipped {
            line: line_key,
            place,
            owner,
            executed_slot: slot,
            bond_burned: bond
        });
        return Ok(());
    }
    require!(env_state == STATE_OPENED, EnvelopeError::NotOpened);

    let c = OrderContent::try_from_slice(&ctx.accounts.envelope.content)
        .map_err(|_| error!(EnvelopeError::BadContent))?;
    let n = c.escrows.len();
    let rem = ctx.remaining_accounts;
    require!(rem.len() >= 3 * n, EnvelopeError::AccountMismatch);
    for (i, spec) in c.escrows.iter().enumerate() {
        require_keys_eq!(
            rem[3 * i].key(),
            escrow_address(&env_key, i as u8).0,
            EnvelopeError::AccountMismatch
        );
        require_keys_eq!(
            rem[3 * i + 1].key(),
            get_associated_token_address(&owner, &spec.mint),
            EnvelopeError::AccountMismatch
        );
        require_keys_eq!(
            rem[3 * i + 2].key(),
            spec.mint,
            EnvelopeError::AccountMismatch
        );
        require!(
            rem[3 * i].is_writable && rem[3 * i + 1].is_writable,
            EnvelopeError::AccountMismatch
        );
    }
    require_keys_eq!(
        ctx.accounts.consumer_program.key(),
        c.program,
        EnvelopeError::WrongConsumer
    );

    let cranker = ctx.accounts.cranker.to_account_info();
    let deposit = ctx.accounts.envelope.ata_deposit;
    if deposit > 0 {
        let env_ai = ctx.accounts.envelope.to_account_info();
        **env_ai.try_borrow_mut_lamports()? -= deposit;
        **cranker.try_borrow_mut_lamports()? += deposit;
        ctx.accounts.envelope.ata_deposit = 0;
    }
    let mut metas = vec![
        AccountMeta::new_readonly(auth_ai.key(), true),
        AccountMeta::new_readonly(env_key, false),
        AccountMeta::new_readonly(line_key, false),
        AccountMeta::new(cranker.key(), true),
    ];
    let mut infos = vec![
        auth_ai.clone(),
        ctx.accounts.envelope.to_account_info(),
        ctx.accounts.line.to_account_info(),
        cranker.clone(),
    ];
    for i in 0..n {
        metas.push(AccountMeta::new(rem[3 * i].key(), false));
        infos.push(rem[3 * i].clone());
    }
    for ai in rem[3 * n..].iter() {
        metas.push(if ai.is_writable {
            AccountMeta::new(ai.key(), false)
        } else {
            AccountMeta::new_readonly(ai.key(), false)
        });
        infos.push(ai.clone());
    }
    infos.push(ctx.accounts.consumer_program.to_account_info());
    let mut data = on_envelope_discriminator().to_vec();
    (owner, place, cap, c.payload.clone()).serialize(&mut data)?;
    invoke_signed(
        &Instruction {
            program_id: c.program,
            accounts: metas,
            data,
        },
        &infos,
        &[auth_seeds],
    )?;
    let (filled, bond_back, reason) = match get_return_data() {
        Some((pid, d)) if pid == c.program && d.len() >= RESULT_LEN => (d[0] == 1, d[1] == 1, d[2]),
        _ => (false, false, 255),
    };

    let owner_ai = ctx.accounts.owner.to_account_info();
    let sys = ctx.accounts.system_program.to_account_info();
    let ata_prog = ctx.accounts.associated_token_program.to_account_info();
    for i in 0..n {
        let escrow = &rem[3 * i];
        let dest = &rem[3 * i + 1];
        let mint = &rem[3 * i + 2];
        let left = token_amount(escrow)?;
        if left > 0 {
            ensure_ata(dest, &owner_ai, mint, &cranker, &sys, &tp, &ata_prog)?;
            token::transfer(
                CpiContext::new_with_signer(
                    tp.clone(),
                    Transfer {
                        from: escrow.clone(),
                        to: dest.clone(),
                        authority: auth_ai.clone(),
                    },
                    &[auth_seeds],
                ),
                left,
            )?;
        }
        token::close_account(CpiContext::new_with_signer(
            tp.clone(),
            CloseAccount {
                account: escrow.clone(),
                destination: cranker.clone(),
                authority: auth_ai.clone(),
            },
            &[auth_seeds],
        ))?;
    }

    if bond_back {
        ensure_ata(
            &ctx.accounts.bond_source.to_account_info(),
            &owner_ai,
            &ctx.accounts.bond_mint.to_account_info(),
            &cranker,
            &sys,
            &tp,
            &ata_prog,
        )?;
        token::transfer(
            CpiContext::new_with_signer(
                tp.clone(),
                Transfer {
                    from: ctx.accounts.bond_vault.to_account_info(),
                    to: ctx.accounts.bond_source.to_account_info(),
                    authority: auth_ai.clone(),
                },
                &[auth_seeds],
            ),
            bond,
        )?;
    } else {
        burn_bond(
            &ctx.accounts.bond_mint.to_account_info(),
            &ctx.accounts.bond_vault.to_account_info(),
            &auth_ai,
            &tp,
            auth_seeds,
            bond,
        )?;
        ctx.accounts.line.bonds_burned += bond;
    }
    let line = &mut ctx.accounts.line;
    line.executed += 1;
    line.next_execute += 1;
    line.cursor_moved_slot = slot;
    let env = &mut ctx.accounts.envelope;
    env.state = STATE_EXECUTED;
    env.executed_slot = slot;
    env.consumer_ok = filled;
    emit_cpi!(Executed {
        line: line_key,
        place,
        owner,
        executed_slot: slot,
        filled,
        reason,
        bond_returned: if bond_back { bond } else { 0 }
    });
    Ok(())
}
