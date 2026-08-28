use crate::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_spl::associated_token::{self, Create};
use anchor_spl::token::{self, Burn, TokenAccount};

pub fn fingerprint(line: &Pubkey, owner: &Pubkey, content: &[u8], secret: &[u8; 32]) -> [u8; 32] {
    let len = (content.len() as u32).to_le_bytes();
    hashv(&[DOMAIN, line.as_ref(), owner.as_ref(), &len, content, secret]).to_bytes()
}
