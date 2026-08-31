use crate::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_spl::associated_token::{self, Create};
use anchor_spl::token::{self, Burn, TokenAccount};

pub fn fingerprint(line: &Pubkey, owner: &Pubkey, content: &[u8], secret: &[u8; 32]) -> [u8; 32] {
    let len = (content.len() as u32).to_le_bytes();
    hashv(&[DOMAIN, line.as_ref(), owner.as_ref(), &len, content, secret]).to_bytes()
}

pub fn authority_address(line: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[AUTHORITY_SEED, line.as_ref()], &crate::ID)
}

pub fn escrow_address(envelope: &Pubkey, i: u8) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"escrow", envelope.as_ref(), &[i]], &crate::ID)
}

pub fn on_envelope_discriminator() -> [u8; 8] {
    let h = hashv(&[b"global:on_envelope"]).to_bytes();
    let mut d = [0u8; 8];
    d.copy_from_slice(&h[..8]);
    d
}

pub(crate) fn token_amount(ai: &AccountInfo) -> Result<u64> {
    let d = ai.try_borrow_data()?;
    Ok(TokenAccount::try_deserialize(&mut &d[..])?.amount)
}

#[allow(clippy::too_many_arguments)]
pub fn ensure_ata<'info>(
    ata: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    ata_program: &AccountInfo<'info>,
) -> Result<()> {
    if ata.owner == &token::ID && ata.data_len() == TOKEN_ACCOUNT_LEN as usize {
        return Ok(());
    }
    associated_token::create_idempotent(CpiContext::new(
        ata_program.clone(),
        Create {
            payer: payer.clone(),
            associated_token: ata.clone(),
            authority: owner.clone(),
            mint: mint.clone(),
            system_program: system.clone(),
            token_program: token_program.clone(),
        },
    ))
}
