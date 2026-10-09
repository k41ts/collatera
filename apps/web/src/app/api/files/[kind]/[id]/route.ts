import { db } from "@/lib/db";
import { ApiError, handler } from "@/lib/api";
import { canAccess } from "@/lib/notes";

type Ctx = { params: Promise<{ kind: string; id: string }> };

export const GET = handler<Ctx>(async (_req, user, { params }) => {
  const { kind, id } = await params;
  let file: { data: Uint8Array; name: string; mime: string } | null = null;
  if (kind === "doc") {
    const d = await db.document.findUnique({ where: { id }, include: { note: true } });
    if (d && canAccess(d.note, user)) file = { data: d.data, name: d.name, mime: d.mime };
  } else if (kind === "proof") {
    const p = await db.payment.findUnique({ where: { id }, include: { note: true } });
    if (p?.proofData && canAccess(p.note, user)) file = { data: p.proofData, name: p.proofName ?? "bukti", mime: p.proofMime ?? "application/octet-stream" };
  }
  if (!file) throw new ApiError(404, "NOT_FOUND", "File tidak ditemukan.");

  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mime,
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.name)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
