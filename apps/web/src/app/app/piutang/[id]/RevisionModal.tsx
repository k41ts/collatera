"use client";
import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import { Button, Notice, Spinner, input } from "@/components/ui";

const TOPICS = ["Nominal pokok", "Bunga / denda", "Jadwal cicilan", "Cara pencairan", "Dokumen", "Data pihak"];
const MIN = 5;
const MAX = 500;

/** Gabungkan bagian yang dipilih + catatan jadi satu alasan (dikirim ke API, maks 500 huruf). */
const compose = (topics: string[], text: string) => (topics.length ? `${topics.join(", ")}: ${text.trim()}` : text.trim());

/**
 * Modal "Minta revisi" untuk pihak yang diundang.
 * `onSubmit` mengembalikan pesan error (modal tetap terbuka) atau null bila berhasil (modal ditutup).
 */
export default function RevisionModal({
  open,
  version,
  onClose,
  onSubmit,
}: {
  open: boolean;
  version: number;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<string | null>;
}) {
  const [topics, setTopics] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);

  // Kosongkan isian setiap kali modal dibuka lagi.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTopics([]);
      setText("");
      setTouched(false);
      setError(null);
    }
  }

  const reason = compose(topics, text);
  const tooShort = text.trim().length < MIN;
  const tooLong = reason.length > MAX;
  const invalid = tooShort || tooLong;

  const toggle = (t: string) => setTopics((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  async function submit() {
    setTouched(true);
    if (invalid || sending) return;
    setSending(true);
    setError(null);
    const err = await onSubmit(reason);
    setSending(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={sending}
      title="Minta revisi"
      description={`Jelaskan apa yang perlu diubah. Surat kembali ke draft dan tanda tangan versi ${version} dibatalkan, lalu pembuat akan mengirim versi ${version + 1}.`}
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={sending}>Batal</Button>
          <Button type="submit" disabled={sending}>
            {sending && <Spinner />} Kirim permintaan revisi
          </Button>
        </>
      }
    >
      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-2.5 text-[13px] text-soft">Bagian yang perlu diubah (opsional)</legend>
        <div className="flex flex-wrap gap-2">
          {TOPICS.map((t) => {
            const on = topics.includes(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(t)}
                className={`min-h-10 rounded-full border px-3.5 text-[13px] transition-colors ${on ? "border-brand bg-brand font-medium text-white" : "border-line2 text-soft hover:border-faint hover:text-white"}`}
              >
                {t}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="alasan-revisi" className="text-[13px] text-soft">Apa yang perlu diubah?</label>
        <textarea
          id="alasan-revisi"
          data-autofocus
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX}
          aria-invalid={touched && invalid}
          aria-describedby="alasan-revisi-hint"
          placeholder="Contoh: cicilan ke-3 mohon dimundurkan ke 15 Desember karena gajian tanggal 10."
          className={`${input} min-h-[132px] resize-y py-3 leading-relaxed ${touched && invalid ? "border-pink" : ""}`}
        />
        <div id="alasan-revisi-hint" className="flex justify-between gap-3 text-xs">
          <span className={touched && invalid ? "text-pink" : "text-faint"}>
            {touched && tooShort ? `Tulis minimal ${MIN} huruf.` : tooLong ? "Terlalu panjang, kurangi catatan atau bagian yang dipilih." : "Pembuat surat akan melihat catatan ini di halaman surat dan di chat."}
          </span>
          <span className={`flex-none tabular-nums ${tooLong ? "text-pink" : "text-faint"}`}>{reason.length}/{MAX}</span>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
    </Dialog>
  );
}
