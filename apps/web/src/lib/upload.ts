import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApiError } from "./api";
import { fileHash } from "./hash";
import { uploadsDir } from "./notes";

const MAX = 10 * 1024 * 1024;
const KINDS: { mime: string; ext: string; magic: number[] }[] = [
  { mime: "application/pdf", ext: "pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  { mime: "image/png", ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/jpeg", ext: "jpg", magic: [0xff, 0xd8, 0xff] },
];

/** Simpan file upload setelah cek ukuran & tipe dari magic bytes (bukan dari nama/Content-Type). */
export async function saveUpload(file: File | null, folder: string) {
  if (!file || typeof file === "string") throw new ApiError(422, "FILE_INVALID", "Pilih file dulu.");
  if (file.size > MAX) throw new ApiError(422, "FILE_INVALID", "Ukuran file maksimal 10 MB.");
  const buf = new Uint8Array(await file.arrayBuffer());
  const kind = KINDS.find((k) => k.magic.every((b, i) => buf[i] === b));
  if (!kind) throw new ApiError(422, "FILE_INVALID", "Hanya PDF, JPG, atau PNG.");
  const rel = path.join(folder, `${randomUUID()}.${kind.ext}`);
  const abs = path.join(uploadsDir(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  const name = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || `file.${kind.ext}`;
  return { rel, name, mime: kind.mime, size: file.size, hash: fileHash(buf) };
}

export function readUpload(rel: string) {
  const abs = path.join(uploadsDir(), rel);
  if (!abs.startsWith(uploadsDir()) || !fs.existsSync(abs)) throw new ApiError(404, "NOT_FOUND", "File tidak ditemukan.");
  return fs.readFileSync(abs);
}
