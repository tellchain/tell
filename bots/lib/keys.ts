import { Keypair } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import bots from "../bots.json" with { type: "json" };
import type { BotRole } from "./config.js";

export async function keyFor(role: BotRole, n: 1 | 2 = 1): Promise<Keypair> {
  const name = n === 1 ? role : `${role}-${n}`;
  const dir = process.env.BOTS_KEY_DIR;
  if (!dir) throw new Error("BOTS_KEY_DIR is not set");
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(dir, `tell-chain-${name}.json`), "utf8"))));
  const listed = (bots as Record<string, unknown>)[role] as string[] | undefined;
  if (!listed?.includes(kp.publicKey.toBase58())) throw new Error(`key for ${role} is not listed in bots.json`);
  return kp;
}

export const BOT_PUBKEYS: Record<string, string[]> = Object.fromEntries(
  Object.entries(bots as Record<string, unknown>).filter(([k]) => k !== "note") as [string, string[]][],
);
export const isBot = (pk: string) => Object.values(BOT_PUBKEYS).some((l) => l.includes(pk));
