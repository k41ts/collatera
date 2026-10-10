"use client";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, Notice, Spinner, input } from "./ui";

/**
 * Modal dasar memakai <dialog> bawaan browser: fokus terkunci di dalam modal, Escape & klik backdrop menutup,
 * fokus kembali ke tombol pemicu, dan scroll halaman dikunci. Di layar kecil tampil sebagai bottom sheet.
 * Elemen dengan atribut `data-autofocus` difokus pertama kali saat dibuka.
 */
export function Dialog({
  open,
  onClose,
  busy = false,
  title,
  description,
  children,
  footer,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  /** Saat true, modal tidak bisa ditutup (sedang memproses). */
  busy?: boolean;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
  onSubmit: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!open) {
      if (d.open) d.close();
      return;
    }
    if (!d.open) d.showModal();
    d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
      if (d.open) d.close();
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      className="m-auto box-border w-[min(520px,calc(100vw-2rem))] max-w-none overflow-visible bg-transparent p-0 text-white backdrop:bg-black/70 backdrop:backdrop-blur-[2px] max-sm:mb-0 max-sm:w-full max-sm:max-h-[92dvh]"
    >
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="flex max-h-[min(720px,calc(100dvh-2rem))] flex-col gap-5 overflow-y-auto overscroll-contain rounded-[22px] border border-line bg-card p-5 shadow-[0_20px_80px_rgba(0,0,0,0.6)] sm:p-6 max-sm:max-h-[92dvh] max-sm:rounded-b-none max-sm:border-b-0 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        >
          <span aria-hidden className="mx-auto -mt-2 h-1 w-10 flex-none rounded-full bg-line2 sm:hidden" />
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <h2 id={titleId} className="text-xl font-semibold tracking-tight">{title}</h2>
              {description && <div id={descId} className="text-sm leading-relaxed text-muted [overflow-wrap:anywhere]">{description}</div>}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Tutup"
              className="-mr-2 -mt-1 flex h-11 w-11 flex-none items-center justify-center rounded-xl text-soft hover:bg-raised hover:text-white disabled:opacity-50"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          {children}
          <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">{footer}</div>
        </form>
      )}
    </dialog>
  );
}

export type ConfirmRequest = {
  title: string;
  description?: ReactNode;
  confirmText: string;
  cancelText?: string;
  tone?: "primary" | "danger";
  /** Jika diisi, modal meminta teks (alasan/catatan) sebelum konfirmasi. */
  field?: { label: string; placeholder?: string; hint?: string; minLength?: number; maxLength?: number };
  /** Dijalankan saat konfirmasi. Kembalikan pesan error agar modal tetap terbuka, atau null bila berhasil. */
  action: (value: string) => Promise<string | null>;
};

/**
 * Pengganti window.confirm / window.prompt.
 *   const [confirm, confirmDialog] = useConfirm();
 *   confirm({ title, confirmText, action: () => run(...) });  // render {confirmDialog} sekali di halaman
 */
export function useConfirm() {
  const [req, setReq] = useState<(ConfirmRequest & { key: number }) | null>(null);
  const open = useCallback((r: ConfirmRequest) => setReq({ ...r, key: Date.now() }), []);
  const element = <ConfirmDialog key={req?.key ?? 0} req={req} onClose={() => setReq(null)} />;
  return [open, element] as const;
}

function ConfirmDialog({ req, onClose }: { req: ConfirmRequest | null; onClose: () => void }) {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const f = req?.field;
  const min = f?.minLength ?? (f ? 1 : 0);
  const max = f?.maxLength ?? 500;
  const invalid = !!f && (value.trim().length < min || value.trim().length > max);

  async function submit() {
    if (!req) return;
    setTouched(true);
    if (invalid || busy) return;
    setBusy(true);
    setError(null);
    const err = await req.action(value.trim());
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Dialog
      open={!!req}
      onClose={onClose}
      busy={busy}
      title={req?.title}
      description={req?.description}
      onSubmit={submit}
      footer={
        <>
          {/* Tanpa isian, fokus awal di "Batal" supaya Enter tidak langsung menjalankan aksi berbahaya. */}
          <Button variant="secondary" onClick={onClose} disabled={busy} data-autofocus={f ? undefined : true}>{req?.cancelText ?? "Batal"}</Button>
          <Button type="submit" variant={req?.tone === "danger" ? "rasp" : "primary"} disabled={busy}>
            {busy && <Spinner />} {req?.confirmText}
          </Button>
        </>
      }
    >
      {f && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fieldId} className="text-[13px] text-soft">{f.label}</label>
          <textarea
            id={fieldId}
            data-autofocus
            rows={4}
            value={value}
            maxLength={max}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={touched && invalid}
            aria-describedby={`${fieldId}-hint`}
            placeholder={f.placeholder}
            className={`${input} min-h-[112px] resize-y py-3 leading-relaxed ${touched && invalid ? "border-pink" : ""}`}
          />
          <div id={`${fieldId}-hint`} className="flex justify-between gap-3 text-xs">
            <span className={touched && invalid ? "text-pink" : "text-faint"}>{touched && invalid ? `Tulis minimal ${min} huruf.` : f.hint ?? ""}</span>
            <span className="flex-none tabular-nums text-faint">{value.trim().length}/{max}</span>
          </div>
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </Dialog>
  );
}
