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
