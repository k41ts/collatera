// Dokumen pendukung: hanya bisa diubah saat DRAFT karena hash-nya masuk docHash yang ditandatangani.
import { db } from "@/lib/db";
import { ApiError, handler, ok } from "@/lib/api";
import { audit, loadNote } from "@/lib/notes";
import { readUploadFile } from "@/lib/upload";

type Ctx = { params: Promise<{ id: string }> };

async function editableNote(id: string, user: Parameters<typeof loadNote>[1]) {
  const n = await loadNote(id, user);
  if (n.creatorId !== user.id) throw new ApiError(403, "FORBIDDEN", "Hanya pembuat draft yang bisa mengubah dokumen.");
  if (n.status !== "DRAFT") throw new ApiError(409, "INVALID_STATUS", "Dokumen hanya bisa diubah saat draft.");
  return n;
}

export const POST = handler<Ctx>(async (req, user, { params }) => {
  const n = await editableNote((await params).id, user);
  if (n.documents.length >= 5) throw new ApiError(422, "TOO_MANY_FILES", "Maksimal 5 dokumen.");
  const form = await req.formData();
  const f = await readUploadFile(form.get("file") as File | null);
  const doc = await db.document.create({ data: { noteId: n.id, name: f.name, mime: f.mime, size: f.size, fileHash: f.hash, data: f.data } });
  await audit(n.id, user.id, "UPLOAD_DOCUMENT", f.name);
  return ok({ id: doc.id }, 201);
});

export const DELETE = handler<Ctx>(async (req, user, { params }) => {
  const n = await editableNote((await params).id, user);
  const docId = new URL(req.url).searchParams.get("doc");
  const doc = n.documents.find((d) => d.id === docId);
  if (!doc) throw new ApiError(404, "NOT_FOUND", "Dokumen tidak ditemukan.");
  await db.document.delete({ where: { id: doc.id } });
  await audit(n.id, user.id, "REMOVE_DOCUMENT", doc.name);
  return ok();
});
