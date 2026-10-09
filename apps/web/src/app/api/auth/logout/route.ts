import { handler, ok } from "@/lib/api";
import { destroySession } from "@/lib/session";

export const POST = handler(
  async () => {
    await destroySession();
    return ok();
  },
  { auth: false },
);
