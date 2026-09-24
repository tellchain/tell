use crate::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::set_return_data;
use anchor_spl::token::{self, TokenAccount};

pub(crate) fn read_token(ai: &AccountInfo) -> Option<TokenAccount> {
    if ai.owner != &token::ID || ai.data_len() != TOKEN_ACCOUNT_LEN {
        return None;
    }
    let d = ai.try_borrow_data().ok()?;
    TokenAccount::try_deserialize(&mut &d[..]).ok()
}

pub(crate) fn verdict(reason: u8) {
    let filled = reason == REASON_OK;
    let back = filled || reason == REASON_OUTBID;
    set_return_data(&[filled as u8, back as u8, reason]);
}
