use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum Order {
    Swap {
        side: u8,
        amount_in: u64,
        min_out: u64,
    },
    AddLiquidity {
        max_base: u64,
        max_quote: u64,
        min_lp: u64,
    },
    RemoveLiquidity {
        lp_amount: u64,
        min_base: u64,
        min_quote: u64,
    },
}
