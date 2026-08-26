use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct EscrowSpec {
    pub mint: Pubkey,
    pub amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct OrderContent {
    pub version: u8,
    pub program: Pubkey,
    pub payload: Vec<u8>,
    pub escrows: Vec<EscrowSpec>,
}
