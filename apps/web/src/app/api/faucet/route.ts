// Faucet IDRX uji (testnet): relayer (owner MockIDRX) mint ke wallet user, maks 1x per 24 jam.
import { db } from "@/lib/db";
import { ApiError, handler, ok } from "@/lib/api";
import { relay } from "@/lib/chain/relayer";
import { rupiahToUnits } from "@/lib/money";

const AMOUNT_RP = 10_000_000;

export const POST = handler(async (_req, user) => {
  if (user.lastFaucetAt && Date.now() - user.lastFaucetAt.getTime() < 24 * 3600_000)
    throw new ApiError(429, "RATE_LIMITED", "Faucet hanya bisa diambil sekali per 24 jam.");
  await db.user.update({ where: { id: user.id }, data: { lastFaucetAt: new Date() } });
  try {
    const rc = await relay("Faucet IDRX", (c) => c.idrx.mint.populateTransaction(user.wallet, rupiahToUnits(AMOUNT_RP)));
    return ok({ txHash: rc.hash, amount: AMOUNT_RP });
  } catch (e) {
    await db.user.update({ where: { id: user.id }, data: { lastFaucetAt: user.lastFaucetAt } });
    throw e;
  }
});
