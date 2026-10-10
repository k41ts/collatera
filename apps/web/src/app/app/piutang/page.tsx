"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar, LinkButton, StatusPill, fmtDate, input } from "@/components/ui";
import { fmtRp } from "@/lib/money";
import { useApi, type NoteSummary } from "@/lib/hooks";
import { NoteGridSkeleton, Sk } from "@/components/Skeleton";

const TYPES: Record<string, string> = { personal: "Pribadi", business: "Bisnis", invoice: "Invoice", other: "Lainnya" };
const FILTERS: [string, string, string[]][] = [
  ["all", "Semua", []],
  ["active", "Aktif", ["ACTIVE"]],
  ["overdue", "Terlambat", ["OVERDUE"]],
  ["sign", "Tanda tangan", ["DRAFT", "PENDING_SIGNATURE"]],
  ["disb", "Pencairan", ["AWAITING_DISBURSEMENT"]],
  ["frozen", "Dibekukan", ["FROZEN"]],
  ["paid", "Lunas", ["PAID"]],
  ["closed", "Ditolak & batal", ["REJECTED", "CANCELLED"]],
];
const REVISION: Record<NonNullable<NoteSummary["revision"]>, { label: string; cls: string; text: (n: NoteSummary) => string }> = {
  requested: { label: "REVISI DIMINTA", cls: "border-butter/50 bg-raised/70 text-butter", text: (n) => `${n.party} minta revisi: “${n.revisionNote}”` },
  in_progress: { label: "SEDANG DIREVISI", cls: "border-line2 bg-raised text-soft", text: (n) => `Kamu minta revisi: “${n.revisionNote}”. Menunggu ${n.party} mengirim versi ${n.version}.` },
  done: { label: "SUDAH DIREVISI", cls: "border-mint/40 bg-raised/70 text-mint", text: (n) => `${n.party} sudah mengirim versi ${n.version} hasil revisi. Cek lalu tanda tangani.` },
};

export default function NotesPage() {
  const { data, loading, error } = useApi<{ notes: NoteSummary[] }>("/api/notes");
  const [q, setQ] = useState("");
  const [role, setRole] = useState<"all" | "creditor" | "debtor">("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<"due" | "left" | "new">("due");
  const notes = useMemo(() => data?.notes ?? [], [data]);

  const left = (n: NoteSummary) => BigInt(n.totalOwed) - BigInt(n.paid);
  const base = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return notes.filter(
      (n) => (role === "all" || n.role === role) && (!qq || `${n.title} ${n.party} ${n.code} ${TYPES[n.debtType]}`.toLowerCase().includes(qq)),
    );
  }, [notes, q, role]);
  const inFilter = (n: NoteSummary, key: string) =>
    key === "all" || (key === "revision" ? !!n.revision : FILTERS.find((f) => f[0] === key)![2].includes(n.status));
  const filters: [string, string, string[]][] = notes.some((n) => n.revision) ? [FILTERS[0], ["revision", "Revisi", []], ...FILTERS.slice(1)] : FILTERS;
  const shown = useMemo(
    () =>
      base
        .filter((n) => inFilter(n, status))
        .sort((a, b) => {
          if (sort === "left") return Number(left(b) - left(a));
          if (sort === "new") return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          const da = a.nextDue && !["PAID", "REJECTED", "CANCELLED"].includes(a.status) ? new Date(a.nextDue).getTime() : Infinity;
          const db = b.nextDue && !["PAID", "REJECTED", "CANCELLED"].includes(b.status) ? new Date(b.nextDue).getTime() : Infinity;
          return da - db;
        }),
    [base, status, sort],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-faint">Semua surat piutang kamu, sebagai kreditur maupun debitur</span>
          <h1 className="text-[26px] font-extrabold tracking-[-0.035em] sm:text-[32px]">Piutang saya</h1>
        </div>
        <LinkButton href="/app/piutang/baru" className="max-sm:hidden">+ Buat surat piutang</LinkButton>
      </div>

      <section aria-label="Cari dan filter" className="flex min-w-0 flex-col gap-3.5 rounded-[20px] border border-line bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-[1_1_320px]">
            <label htmlFor="cari" className="sr-only">Cari piutang</label>
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8A8C9A" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input id="cari" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari judul, nama pihak, atau nomor (CL-…)" className={`${input} pl-10 text-sm`} />
          </div>
          <div role="group" aria-label="Peranmu" className="flex flex-[1_1_auto] gap-1 rounded-xl bg-midnight p-1 sm:flex-none">
            {(["all", "creditor", "debtor"] as const).map((r) => (
              <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)} className={`min-h-[38px] flex-1 rounded-[9px] px-3.5 text-[13px] sm:flex-none ${role === r ? "bg-brand font-medium text-white" : "text-muted"}`}>
                {{ all: "Semua", creditor: "Kreditur", debtor: "Debitur" }[r]}
              </button>
            ))}
          </div>
          <label htmlFor="urut" className="flex flex-[1_1_auto] items-center gap-2 text-[13px] text-muted sm:flex-none">
            Urutkan
            <select id="urut" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-line2 bg-midnight px-3 text-sm text-ink sm:flex-none">
              <option value="due">Jatuh tempo terdekat</option>
              <option value="left">Sisa terbesar</option>
              <option value="new">Terbaru diubah</option>
            </select>
          </label>
        </div>
        <div role="group" aria-label="Status" className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 no-scrollbar [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
          {filters.map(([key, label]) => {
            const on = status === key;
            const count = base.filter((n) => inFilter(n, key)).length;
            return (
              <button key={key} type="button" aria-pressed={on} onClick={() => setStatus(key)} className={`inline-flex min-h-10 flex-none items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-[13px] ${on ? "border-brand bg-brand font-medium text-white" : "border-line2 bg-midnight text-soft"}`}>
                {label}
                <span className={`rounded-full px-1.5 text-[11px] font-semibold ${on ? "bg-white/20" : "bg-line text-soft"}`}>{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      {loading ? (
        <Sk className="h-3.5 w-28" />
      ) : (
        <p role="status" className="text-[13px] text-muted">
          {error ? error : `${shown.length} dari ${notes.length} piutang${q.trim() ? ` untuk "${q.trim()}"` : ""}`}
        </p>
      )}

      {loading ? (
        <NoteGridSkeleton />
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[20px] border border-dashed border-line2 px-5 py-10 text-center sm:px-6 sm:py-12">
          <span className="text-lg font-semibold">{notes.length === 0 ? "Belum ada surat piutang" : "Tidak ada piutang yang cocok"}</span>
          <span className="max-w-[420px] text-sm text-muted">{notes.length === 0 ? "Buat surat piutang pertama kamu." : "Coba kata kunci lain atau hapus filter."}</span>
          {notes.length === 0 ? (
            <LinkButton href="/app/piutang/baru">Buat surat piutang</LinkButton>
          ) : (
            <button type="button" onClick={() => { setQ(""); setRole("all"); setStatus("all"); }} className="min-h-11 rounded-full bg-brand px-5 text-sm font-medium">Hapus semua filter</button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4">
          {shown.map((n) => {
            const pct = Number((BigInt(n.paid) * BigInt(100)) / BigInt(n.totalOwed || "1"));
            const urgent = ["OVERDUE", "PENDING_SIGNATURE", "AWAITING_DISBURSEMENT"].includes(n.status) || n.revision === "requested";
            const lft = left(n);
            return (
              <Link key={n.id} href={`/app/piutang/${n.id}`} className="flex min-w-0 flex-col gap-3.5 rounded-[20px] border border-line bg-card p-4 text-ink sm:p-5 no-underline transition-colors hover:border-line2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-faint">{n.code} · {TYPES[n.debtType]}</span>
                  <StatusPill status={n.status} />
                </div>
                <span className="text-lg font-semibold leading-snug [overflow-wrap:anywhere]">{n.title}</span>
                {n.revision && (
                  <div className={`flex flex-col gap-1 rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${REVISION[n.revision].cls}`}>
                    <span className="text-[11px] font-semibold tracking-wide">{REVISION[n.revision].label}</span>
                    <span className="line-clamp-2 text-soft [overflow-wrap:anywhere]">{REVISION[n.revision].text(n)}</span>
                  </div>
                )}
                <div className="flex items-center gap-2.5">
                  <Avatar name={n.party} size="sm" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{n.party}</span>
                    <span className="text-xs text-faint">{n.role === "creditor" ? "Debitur · kamu kreditur" : "Kreditur · kamu debitur"}</span>
                  </span>
                  {n.unread > 0 && <span className="ml-auto rounded-full bg-brand-soft px-2.5 py-1 text-xs text-lav">{n.unread} pesan</span>}
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="min-w-0 text-xs text-faint [overflow-wrap:anywhere]">Sisa dari {fmtRp(n.totalOwed)}</span>
                    <span className="ml-auto min-w-0 text-right text-xl font-semibold leading-tight tabular-nums [overflow-wrap:anywhere]">{fmtRp(lft > BigInt(0) ? lft : BigInt(0))}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-line">
                    <div className={`h-full rounded-full ${n.status === "PAID" ? "bg-faint" : "bg-brand"}`} style={{ width: `${n.status === "PAID" ? 100 : pct}%` }} />
                  </div>
                </div>
                <div className="flex flex-wrap justify-between gap-x-2 gap-y-1 border-t border-line pt-3 text-xs">
                  <span className={urgent ? (n.status === "OVERDUE" ? "font-medium text-ink" : "font-medium text-peach") : "text-soft"}>{dueText(n)}</span>
                  <span className="text-faint">{n.paidInstallments} dari {n.installmentCount} cicilan</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function dueText(n: NoteSummary) {
  switch (n.status) {
    case "DRAFT": return n.revision === "requested" ? "Perbaiki draft lalu kirim ulang" : n.isCreator ? "Draft, belum dikirim" : n.revision ? "Pembuat sedang merevisi" : "Draft pihak lawan";
    case "PENDING_SIGNATURE": return n.mySignature ? "Menunggu tanda tangan pihak lain" : n.revision === "done" ? `Versi ${n.version} menunggu tanda tanganmu` : "Menunggu tanda tanganmu";
    case "AWAITING_DISBURSEMENT": return n.role === "debtor" ? "Konfirmasi dana sudah diterima" : "Menunggu konfirmasi debitur";
    case "PAID": return "Lunas";
    case "REJECTED": return "Ditolak";
    case "CANCELLED": return "Dibatalkan";
    case "FROZEN": return "Dibekukan";
    default: return n.nextDue ? `Jatuh tempo ${fmtDate(n.nextDue)}` : "-";
  }
}
