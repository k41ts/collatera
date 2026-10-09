import { ApiError } from "./api";
import { fileHash } from "./hash";

// Batas request body fungsi Vercel 4,5 MB, jadi file maks 4 MB. Isi file disimpan di database (bytea).
export const MAX_UPLOAD = 4 * 1024 * 1024;
const KINDS: { mime: string; ext: string; magic: number[] }[] = [
  { mime: "application/pdf", ext: "pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  { mime: "image/png", ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/jpeg", ext: "jpg", magic: [0xff, 0xd8, 0xff] },
];

/** Baca & validasi file upload: ukuran dan tipe dari magic bytes (bukan dari nama/Content-Type). */
export async function readUploadFile(file: File | null) {
  if (!file || typeof file === "string") throw new ApiError(422, "FILE_INVALID", "Pilih file dulu.");
  if (file.size > MAX_UPLOAD) throw new ApiError(422, "FILE_INVALID", "Ukuran file maksimal 4 MB.");
  const data = new Uint8Array(await file.arrayBuffer());
  const kind = KINDS.find((k) => k.magic.every((b, i) => data[i] === b));
  if (!kind) throw new ApiError(422, "FILE_INVALID", "Hanya PDF, JPG, atau PNG.");
  const name = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || `file.${kind.ext}`;
  return { data, name, mime: kind.mime, size: file.size, hash: fileHash(data) };
}
