import { z } from "zod";
import { db } from "@/lib/db";
import { handler, ok } from "@/lib/api";
import { reader } from "@/lib/chain/relayer";

export const GET = handler(async (_req, user) => {
  let balance = "0";
  try {
    balance = (await reader().idrx.balanceOf(user.wallet)).toString();
  } catch {
    /* RPC sedang bermasalah: tampilkan 0 */
  }
  const [asCreditor, asDebtor, paid] = await Promise.all([
    db.note.count({ where: { creditorId: user.id } }),
    db.note.count({ where: { debtorId: user.id } }),
    db.note.count({ where: { status: "PAID", OR: [{ creditorId: user.id }, { debtorId: user.id }] } }),
  ]);
  return ok({ user, balance, stats: { asCreditor, asDebtor, paid } });
});

const Patch = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 huruf").max(80).optional(),
  email: z.string().trim().email("Email tidak valid").max(120).optional().or(z.literal("")),
  notifyH3: z.boolean().optional(),
  notifyH0: z.boolean().optional(),
  notifyPayment: z.boolean().optional(),
  notifyChat: z.boolean().optional(),
});

export const PATCH = handler(async (req, user) => {
  const data = Patch.parse(await req.json());
  const updated = await db.user.update({ where: { id: user.id }, data });
  return ok({ user: updated });
});
