use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub registrar: Pubkey,
    pub bump: u8,
}
