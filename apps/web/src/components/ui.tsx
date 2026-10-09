import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Draft", cls: "bg-line text-soft" },
  PENDING_SIGNATURE: { label: "Tanda tangan", cls: "bg-peach text-peach-ink" },
  AWAITING_DISBURSEMENT: { label: "Pencairan", cls: "bg-butter text-butter-ink" },
  ACTIVE: { label: "Aktif", cls: "bg-mint text-mint-ink" },
  OVERDUE: { label: "Terlambat", cls: "bg-rasp text-white" },
  DISPUTED: { label: "Sengketa", cls: "bg-pink text-pink-ink" },
  FROZEN: { label: "Dibekukan", cls: "bg-cyan text-cyan-ink" },
  PAID: { label: "Lunas", cls: "bg-lav text-lav-ink" },
  REJECTED: { label: "Ditolak", cls: "bg-rasp-soft text-pink" },
  CANCELLED: { label: "Dibatalkan", cls: "bg-rasp-soft text-pink" },
};

export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-line text-soft" };
  return <span className={`inline-block whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-semibold tracking-wide ${s.cls}`}>{s.label}</span>;
}

const AV = ["bg-lav text-lav-ink", "bg-mint text-mint-ink", "bg-butter text-butter-ink", "bg-cyan text-cyan-ink", "bg-pink text-pink-ink", "bg-peach text-peach-ink"];

export function Avatar({ name, seed, size = "md" }: { name: string; seed?: string; size?: "sm" | "md" | "lg" }) {
  const initials = name.replace(/^0x/, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
  const h = [...(seed ?? name)].reduce((a, c) => a + c.charCodeAt(0), 0);
  const sz = size === "lg" ? "h-20 w-20 rounded-[22px] text-2xl" : size === "sm" ? "h-9 w-9 rounded-[10px] text-xs" : "h-10 w-10 rounded-xl text-[13px]";
  return <span aria-hidden className={`flex flex-none items-center justify-center font-semibold ${sz} ${AV[h % AV.length]}`}>{initials}</span>;
}

type BtnVariant = "primary" | "secondary" | "danger" | "rasp" | "ghost";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-brand text-white hover:bg-[#8d35ea]",
  secondary: "border border-line2 text-white hover:border-faint",
  danger: "bg-rasp-soft text-pink hover:bg-[#3a1626]",
  rasp: "bg-rasp text-white hover:bg-[#ff1f80]",
  ghost: "text-lav hover:text-white",
};
export const btn = (v: BtnVariant = "primary", extra = "") =>
  `inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BTN[v]} ${extra}`;

export function Button({ variant = "primary", className = "", ...p }: ComponentProps<"button"> & { variant?: BtnVariant }) {
  return <button type="button" {...p} className={btn(variant, className)} />;
}

export function LinkButton({ variant = "primary", className = "", ...p }: ComponentProps<typeof Link> & { variant?: BtnVariant }) {
  return <Link {...p} className={btn(variant, className)} />;
}

export function Card({ className = "", children, ...p }: ComponentProps<"section">) {
  return (
    <section {...p} className={`rounded-[20px] border border-line bg-card p-5 ${className}`}>
      {children}
    </section>
  );
}

export function Chip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-lg px-3 py-1.5 text-xs ${className}`}>{children}</span>;
}

export const input =
  "w-full min-h-[46px] rounded-xl border border-line2 bg-midnight px-3.5 text-[15px] text-white focus:border-brand outline-none";

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
  const cls = { info: "bg-raised text-muted", ok: "bg-[#1e3324] text-mint", error: "bg-rasp-soft text-pink", warn: "bg-[#3a3017] text-butter" }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl px-3.5 py-3 text-sm leading-relaxed ${cls}`}>
      {children}
    </div>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden>
      <rect x="3" y="9" width="18" height="18" rx="7" fill="none" stroke="#7F24DD" strokeWidth="4" />
      <rect x="15" y="9" width="18" height="18" rx="7" fill="none" stroke="#FB006D" strokeWidth="4" />
      <circle cx="18" cy="18" r="3" fill="#F4C842" />
    </svg>
  );
}

export function Spinner() {
  return <span aria-hidden className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />;
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
