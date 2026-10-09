import { db } from "@/lib/db";
import { ApiError, handler } from "@/lib/api";
import { canAccess } from "@/lib/notes";
import { readUpload } from "@/lib/upload";

type Ctx = { params: Promise<{ kind: string; id: string }> };

export const GET = handler<Ctx>(async (_req, user, { params }) => {
  const { kind, id } = await params;
  let rel: string | null = null;
  let name = "file";
  let mime = "application/octet-stream";
  if (kind === "doc") {
    const d = await db.document.findUnique({ where: { id }, include: { note: true } });
    if (!d || !canAccess(d.note, user)) throw new ApiError(404, "NOT_FOUND", "File tidak ditemukan.");
    ({ path: rel, name, mime } = d);
  } else if (kind === "proof") {
    const p = await db.payment.findUnique({ where: { id }, include: { note: true } });
    if (!p || !p.proofPath || !canAccess(p.note, user)) throw new ApiError(404, "NOT_FOUND", "File tidak ditemukan.");
    rel = p.proofPath;
    name = p.proofName ?? "bukti";
    mime = p.proofPath.endsWith(".pdf") ? "application/pdf" : p.proofPath.endsWith(".png") ? "image/png" : "image/jpeg";
  } else throw new ApiError(404, "NOT_FOUND", "File tidak ditemukan.");

  const buf = readUpload(rel);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="${encodeURIComponent(name)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
