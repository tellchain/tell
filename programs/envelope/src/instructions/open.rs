use crate::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke_signed, system_instruction};
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, InitializeAccount3, Mint, Token, Transfer};

#[event_cpi]
#[derive(Accounts)]
pub struct Open<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub line: Box<Account<'info, Line>>,
    #[account(mut, has_one = line @ EnvelopeError::AccountMismatch, has_one = owner @ EnvelopeError::AccountMismatch)]
    pub envelope: Box<Account<'info, Envelope>>,
    /// CHECK: the envelope at place - 1 (checked in the handler when line.ordered_open); any account otherwise
    pub prev_envelope: UncheckedAccount<'info>,
    /// CHECK: PDA of this line
    #[account(seeds = [AUTHORITY_SEED, line.key().as_ref()], bump)]
    pub envelope_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, Open<'info>>,
    content: Vec<u8>,
    secret: [u8; 32],
) -> Result<()> {
    let slot = Clock::get()?.slot;
    let line_key = ctx.accounts.line.key();
    let env_key = ctx.accounts.envelope.key();
    let owner_key = ctx.accounts.owner.key();
    {
        let env = &ctx.accounts.envelope;
        require!(env.state == STATE_SEALED, EnvelopeError::NotSealed);
        require!(slot > env.sealed_slot, EnvelopeError::WindowNotOpen);
        let close = ctx.accounts.line.seal_until_slot;
        require!(close == 0 || slot > close, EnvelopeError::WindowNotOpen);
        require!(slot <= env.open_deadline, EnvelopeError::WindowClosed);
        require!(content.len() <= MAX_CONTENT, EnvelopeError::BadContent);
        require!(
            fingerprint(&line_key, &env.owner, &content, &secret) == env.fingerprint,
            EnvelopeError::FingerprintMismatch
        );
    }
    let c =
        OrderContent::try_from_slice(&content).map_err(|_| error!(EnvelopeError::BadContent))?;
    require!(
        c.version == 1 && !c.payload.is_empty(),
        EnvelopeError::BadContent
    );
    require!(
        c.program == ctx.accounts.line.consumer,
        EnvelopeError::WrongConsumer
    );
    require!(
        c.escrows.len() <= MAX_ESCROWS,
        EnvelopeError::TooManyEscrows
    );

    let place = ctx.accounts.envelope.place;
    if ctx.accounts.line.ordered_open && place > 0 {
        let (expected, _) = Pubkey::find_program_address(
            &[b"envelope", line_key.as_ref(), &(place - 1).to_le_bytes()],
            &crate::ID,
        );
        let prev = &ctx.accounts.prev_envelope;
        require_keys_eq!(prev.key(), expected, EnvelopeError::AccountMismatch);
        let data = prev.try_borrow_data()?;
        let p = Envelope::try_deserialize(&mut &data[..])?;
        require!(
            p.state != STATE_SEALED || slot > p.open_deadline,
            EnvelopeError::PrevNotOpened
        );
    }

    let rem = ctx.remaining_accounts;
    require!(
        rem.len() == 3 * c.escrows.len(),
        EnvelopeError::AccountMismatch
    );
    let rent = Rent::get()?.minimum_balance(TOKEN_ACCOUNT_LEN as usize);
    for (i, spec) in c.escrows.iter().enumerate() {
        let mint = &rem[3 * i];
        let source = &rem[3 * i + 1];
        let escrow = &rem[3 * i + 2];
        require_keys_eq!(mint.key(), spec.mint, EnvelopeError::AccountMismatch);
        require!(mint.owner == &token::ID, EnvelopeError::AccountMismatch);
        require!(spec.mint != NATIVE_MINT, EnvelopeError::NativeMint);
        require_keys_eq!(
            source.key(),
            get_associated_token_address(&owner_key, &spec.mint),
            EnvelopeError::AccountMismatch
        );
        require!(spec.amount > 0, EnvelopeError::BadContent);
        {
            let d = mint.try_borrow_data()?;
            let m = Mint::try_deserialize(&mut &d[..])
                .map_err(|_| error!(EnvelopeError::AccountMismatch))?;
            require!(m.freeze_authority.is_none(), EnvelopeError::FreezableMint);
        }
        let idx = [i as u8];
        let (ek, eb) = escrow_address(&env_key, i as u8);
        require_keys_eq!(escrow.key(), ek, EnvelopeError::AccountMismatch);
        let eseeds: &[&[u8]] = &[b"escrow", env_key.as_ref(), &idx, &[eb]];
        let sys = ctx.accounts.system_program.to_account_info();
        let owner_ai = ctx.accounts.owner.to_account_info();
        if escrow.lamports() == 0 {
            invoke_signed(
                &system_instruction::create_account(
                    &owner_key,
                    &ek,
                    rent,
                    TOKEN_ACCOUNT_LEN,
                    &token::ID,
                ),
                &[owner_ai.clone(), escrow.clone(), sys.clone()],
                &[eseeds],
            )?;
        } else {
            require!(
                escrow.owner == &System::id() && escrow.data_len() == 0,
                EnvelopeError::AccountMismatch
            );
            let need = rent.saturating_sub(escrow.lamports());
            if need > 0 {
                anchor_lang::solana_program::program::invoke(
                    &system_instruction::transfer(&owner_key, &ek, need),
                    &[owner_ai.clone(), escrow.clone(), sys.clone()],
                )?;
            }
            invoke_signed(
                &system_instruction::allocate(&ek, TOKEN_ACCOUNT_LEN),
                &[escrow.clone(), sys.clone()],
                &[eseeds],
            )?;
            invoke_signed(
                &system_instruction::assign(&ek, &token::ID),
                &[escrow.clone(), sys.clone()],
                &[eseeds],
            )?;
        }
        token::initialize_account3(CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            InitializeAccount3 {
                account: escrow.clone(),
                mint: mint.clone(),
                authority: ctx.accounts.envelope_authority.to_account_info(),
            },
        ))?;
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: source.clone(),
                    to: escrow.clone(),
                    authority: owner_ai.clone(),
                },
            ),
            spec.amount,
        )?;
    }

    let deposit = rent * ATA_DEPOSIT_COUNT;
    anchor_lang::solana_program::program::invoke(
        &system_instruction::transfer(&owner_key, &env_key, deposit),
        &[
            ctx.accounts.owner.to_account_info(),
            ctx.accounts.envelope.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;
    let env = &mut ctx.accounts.envelope;
    env.ata_deposit = deposit;
    env.content = content.clone();
    env.state = STATE_OPENED;
    env.opened_slot = slot;
    ctx.accounts.line.opened += 1;
    emit_cpi!(Opened {
        line: line_key,
        place,
        owner: owner_key,
        opened_slot: slot,
        content
    });
    Ok(())
}
