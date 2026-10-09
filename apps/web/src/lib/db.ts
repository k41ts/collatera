import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { prisma?: PrismaClient };

/** Satu instance serverless melayani banyak request sekaligus; connection_limit=1 bikin request antre lalu timeout.
 *  Naikkan batas pool (pooler transaksi Supabase sanggup) kecuali sudah diatur lebih besar lewat env. */
function datasourceUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (Number(u.searchParams.get("connection_limit") ?? "0") < 5) u.searchParams.set("connection_limit", "5");
    if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", "20");
    return u.toString();
  } catch {
    return raw;
  }
}

export const db = g.prisma ?? new PrismaClient({ datasourceUrl: datasourceUrl() });
if (process.env.NODE_ENV !== "production") g.prisma = db;
