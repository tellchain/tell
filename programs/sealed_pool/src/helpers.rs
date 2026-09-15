use crate::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::set_return_data;
use anchor_spl::token::{self, Burn, Mint, MintTo, TokenAccount, Transfer};
use envelope::OrderContent;

pub(crate) fn read_token(ai: &AccountInfo) -> Option<TokenAccount> {
    if ai.owner != &token::ID || ai.data_len() != TOKEN_ACCOUNT_LEN {
        return None;
    }
    let d = ai.try_borrow_data().ok()?;
    TokenAccount::try_deserialize(&mut &d[..]).ok()
}

pub(crate) fn read_mint(ai: &AccountInfo) -> Option<Mint> {
    if ai.owner != &token::ID {
        return None;
    }
    let d = ai.try_borrow_data().ok()?;
    Mint::try_deserialize(&mut &d[..]).ok()
}

pub(crate) fn verdict(filled: bool, reason: u8) {
    set_return_data(&[filled as u8, filled as u8, reason]);
}
