use anchor_lang::prelude::*;

pub fn isqrt(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    let mut x = (n as f64).sqrt() as u128;
    while x * x > n {
        x -= 1;
    }
    while (x + 1) * (x + 1) <= n {
        x += 1;
    }
    x
}

pub fn swap_out(amount_in: u64, r_in: u64, r_out: u64, fee_bps: u16) -> (u64, u64) {
    let after = (amount_in as u128) * (10_000 - fee_bps as u128) / 10_000;
    let fee = amount_in as u128 - after;
    if r_in == 0 || r_out == 0 {
        return (0, fee as u64);
    }
    (
        (r_out as u128 * after / (r_in as u128 + after)) as u64,
        fee as u64,
    )
}
