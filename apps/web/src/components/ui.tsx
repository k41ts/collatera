import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

// Tanpa warna: status dibedakan dari bentuk pill (isi hitam = mendesak, outline = menunggu, abu = berjalan/selesai).
export const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Draft", cls: "bg-raised text-muted" },
  PENDING_SIGNATURE: { label: "Tanda tangan", cls: "border-[1.5px] border-ink text-ink" },
  AWAITING_DISBURSEMENT: { label: "Pencairan", cls: "border-[1.5px] border-dashed border-ink text-ink" },
  ACTIVE: { label: "Aktif", cls: "bg-bubble text-ink" },
  OVERDUE: { label: "Terlambat", cls: "bg-ink text-white" },
  DISPUTED: { label: "Sengketa", cls: "bg-[#3a3a3a] text-white" },
  FROZEN: { label: "Dibekukan", cls: "border-[1.5px] border-[#3a3a3a] bg-[#3a3a3a]/10 text-ink" },
  PAID: { label: "Lunas", cls: "bg-raised text-muted" },
  REJECTED: { label: "Ditolak", cls: "bg-raised text-muted line-through" },
  CANCELLED: { label: "Dibatalkan", cls: "bg-raised text-muted line-through" },
};

export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-raised text-muted" };
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${s.cls}`}>{s.label}</span>;
}

const AV = ["bg-ink text-white ring-1 ring-white/40", "bg-bubble text-ink", "bg-[#3a3a3a] text-white", "bg-raised text-ink border border-line2"];

export function Avatar({ name, seed, size = "md" }: { name: string; seed?: string; size?: "sm" | "md" | "lg" }) {
  const initials = name.replace(/^0x/, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
  const h = [...(seed ?? name)].reduce((a, c) => a + c.charCodeAt(0), 0);
  const sz = size === "lg" ? "h-20 w-20 rounded-[22px] text-2xl" : size === "sm" ? "h-9 w-9 rounded-[10px] text-xs" : "h-10 w-10 rounded-xl text-[13px]";
  return <span aria-hidden className={`flex flex-none items-center justify-center font-semibold ${sz} ${AV[h % AV.length]}`}>{initials}</span>;
}

type BtnVariant = "primary" | "secondary" | "danger" | "rasp" | "ghost";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-brand text-white hover:bg-[#2a2a2a]",
  secondary: "border-[1.5px] border-line2 bg-card text-ink hover:border-ink",
  danger: "border-[1.5px] border-ink text-ink hover:bg-ink hover:text-white",
  rasp: "bg-rasp text-white hover:bg-[#2a2a2a]",
  ghost: "text-ink underline-offset-4 hover:underline",
};
export const btn = (v: BtnVariant = "primary", extra = "") =>
  `inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BTN[v]} ${extra}`;

export function Button({ variant = "primary", className = "", ...p }: ComponentProps<"button"> & { variant?: BtnVariant }) {
  return <button type="button" {...p} className={btn(variant, className)} />;
}

export function LinkButton({ variant = "primary", className = "", ...p }: ComponentProps<typeof Link> & { variant?: BtnVariant }) {
  return <Link {...p} className={btn(variant, className)} />;
}

export function Card({ className = "", children, ...p }: ComponentProps<"section">) {
  return (
    <section {...p} className={`rounded-[22px] bg-card p-5 ${className}`}>
      {children}
    </section>
  );
}

export function Chip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-lg px-3 py-1.5 text-xs ${className}`}>{children}</span>;
}

export const input =
  "w-full min-h-[46px] rounded-[14px] border border-line2 bg-[#f6f6f6] px-3.5 text-[15px] text-ink focus:border-ink focus:bg-card outline-none";

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] text-soft">
        {label}
      </label>
      {children}
      {hint && <span className="text-xs text-faint">{hint}</span>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "ok" | "error" | "warn"; children: ReactNode }) {
  const cls = { info: "bg-raised text-muted", ok: "border border-line2 bg-card text-ink", error: "border-[1.5px] border-ink bg-card text-ink", warn: "border-[1.5px] border-dashed border-ink bg-card text-ink" }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl px-3.5 py-3 text-sm leading-relaxed ${cls}`}>
      {children}
    </div>
  );
}

/** Logo Collatera: dua mata rantai miring yang saling mengunci. Mengikuti warna teks (currentColor). */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <path d="M7 17 L24 8.5 L24 26 L7 34.5 Z" stroke="currentColor" strokeWidth="6" strokeLinejoin="round" />
      <path d="M24 22 L41 13.5 L41 31 L24 39.5 Z" stroke="currentColor" strokeWidth="6" strokeLinejoin="round" />
    </svg>
  );
}

export function Spinner() {
  return <span aria-hidden className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />;
}

export const fmtDate = (d: string | Date | null | undefined, withTime = false) =>
  d
    ? new Date(d).toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        day: "numeric",
        month: "short",
        year: "numeric",
        ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
      })
    : "-";
