"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Button, Notice, Spinner, input } from "@/components/ui";

const TOPICS = ["Nominal pokok", "Bunga / denda", "Jadwal cicilan", "Cara pencairan", "Dokumen", "Data pihak"];
const MIN = 5;
const MAX = 500;

/** Gabungkan bagian yang dipilih + catatan jadi satu alasan (dikirim ke API, maks 500 huruf). */
const compose = (topics: string[], text: string) => (topics.length ? `${topics.join(", ")}: ${text.trim()}` : text.trim());

/**
 * Modal "Minta revisi" untuk pihak yang diundang. Pakai <dialog> bawaan browser: fokus terkunci di dalam modal,
 * Escape menutup, dan fokus kembali ke tombol pemicu. Di layar kecil tampil sebagai bottom sheet.
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
  const ref = useRef<HTMLDialogElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const descId = useId();
  const [topics, setTopics] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sinkronkan prop `open` dengan dialog, kosongkan isian setiap kali dibuka, dan kunci scroll halaman.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!open) {
      if (d.open) d.close();
      return;
    }
    setTopics([]);
    setText("");
    setTouched(false);
    setError(null);
    if (!d.open) d.showModal();
    textRef.current?.focus();
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
    };
  }, [open]);

  const reason = compose(topics, text);
  const tooShort = text.trim().length < MIN;
  const tooLong = reason.length > MAX;
  const invalid = tooShort || tooLong;

  const toggle = (t: string) => setTopics((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descId}
      // Escape: jangan tutup saat permintaan sedang dikirim.
      onCancel={(e) => {
        e.preventDefault();
        if (!sending) onClose();
      }}
      // Klik di luar kotak (area backdrop) menutup modal.
      onClick={(e) => {
        if (e.target === e.currentTarget && !sending) onClose();
      }}
      className="m-auto box-border w-[min(560px,calc(100vw-2rem))] max-w-none overflow-visible bg-transparent p-0 text-white backdrop:bg-black/70 backdrop:backdrop-blur-[2px] max-sm:mb-0 max-sm:w-full max-sm:max-h-[92dvh]"
    >
      <form
        onSubmit={submit}
        className="flex max-h-[min(720px,calc(100dvh-2rem))] flex-col gap-5 overflow-y-auto overscroll-contain rounded-[22px] border border-line bg-card p-5 shadow-[0_20px_80px_rgba(0,0,0,0.6)] sm:p-6 max-sm:max-h-[92dvh] max-sm:rounded-b-none max-sm:border-b-0 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        <span aria-hidden className="mx-auto -mt-2 h-1 w-10 flex-none rounded-full bg-line2 sm:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 id={titleId} className="text-xl font-semibold tracking-tight">Minta revisi</h2>
            <p id={descId} className="text-sm leading-relaxed text-muted">
              Jelaskan apa yang perlu diubah. Surat kembali ke draft dan tanda tangan versi {version} dibatalkan, lalu pembuat akan mengirim versi {version + 1}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            aria-label="Tutup"
            className="-mr-2 -mt-1 flex h-11 w-11 flex-none items-center justify-center rounded-xl text-soft hover:bg-raised hover:text-white disabled:opacity-50"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

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
            ref={textRef}
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setTouched(true)}
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

        <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={sending}>Batal</Button>
          <Button type="submit" disabled={sending || (touched && invalid)}>
            {sending && <Spinner />} Kirim permintaan revisi
          </Button>
        </div>
      </form>
    </dialog>
  );
}
