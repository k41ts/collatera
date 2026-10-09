"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar, LinkButton, StatusPill, fmtDate, input } from "@/components/ui";
import { fmtRp } from "@/lib/money";
import { useApi, type NoteSummary } from "@/lib/hooks";

const TYPES: Record<string, string> = { personal: "Pribadi", business: "Bisnis", invoice: "Invoice", other: "Lainnya" };
const FILTERS: [string, string, string[]][] = [
  ["all", "Semua", []],
  ["active", "Aktif", ["ACTIVE"]],
  ["overdue", "Terlambat", ["OVERDUE"]],
  ["sign", "Tanda tangan", ["DRAFT", "PENDING_SIGNATURE"]],
  ["disb", "Pencairan", ["AWAITING_DISBURSEMENT"]],
  ["dispute", "Sengketa & beku", ["DISPUTED", "FROZEN"]],
  ["paid", "Lunas", ["PAID"]],
  ["closed", "Ditolak & batal", ["REJECTED", "CANCELLED"]],
];

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
  const inFilter = (n: NoteSummary, key: string) => key === "all" || FILTERS.find((f) => f[0] === key)![2].includes(n.status);
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
          <h1 className="text-[32px] font-semibold tracking-tight">Piutang saya</h1>
        </div>
        <LinkButton href="/app/piutang/baru">+ Buat surat piutang</LinkButton>
      </div>

      <section aria-label="Cari dan filter" className="flex flex-col gap-3.5 rounded-[20px] border border-line bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-[1_1_320px]">
            <label htmlFor="cari" className="sr-only">Cari piutang</label>
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8A8C9A" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input id="cari" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari judul, nama pihak, atau nomor (PC-…)" className={`${input} pl-10 text-sm`} />
          </div>
          <div role="group" aria-label="Peranmu" className="flex gap-1 rounded-xl bg-midnight p-1">
            {(["all", "creditor", "debtor"] as const).map((r) => (
              <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)} className={`min-h-[38px] rounded-[9px] px-3.5 text-[13px] ${role === r ? "bg-brand-soft font-medium text-white" : "text-muted"}`}>
                {{ all: "Semua", creditor: "Kreditur", debtor: "Debitur" }[r]}
              </button>
            ))}
          </div>
          <label htmlFor="urut" className="flex items-center gap-2 text-[13px] text-muted">
            Urutkan
            <select id="urut" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="min-h-11 rounded-xl border border-line2 bg-midnight px-3 text-sm text-white">
              <option value="due">Jatuh tempo terdekat</option>
              <option value="left">Sisa terbesar</option>
              <option value="new">Terbaru diubah</option>
            </select>
          </label>
        </div>
        <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
          {FILTERS.map(([key, label]) => {
            const on = status === key;
            const count = base.filter((n) => inFilter(n, key)).length;
            return (
              <button key={key} type="button" aria-pressed={on} onClick={() => setStatus(key)} className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-[13px] ${on ? "border-brand bg-brand font-medium text-white" : "border-line2 bg-midnight text-soft"}`}>
                {label}
                <span className={`rounded-full px-1.5 text-[11px] font-semibold ${on ? "bg-white/20" : "bg-line text-soft"}`}>{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      <p role="status" className="text-[13px] text-muted">
        {loading ? "Memuat…" : error ? error : `${shown.length} dari ${notes.length} piutang${q.trim() ? ` untuk "${q.trim()}"` : ""}`}
      </p>

      {!loading && shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[20px] border border-dashed border-line2 px-6 py-12 text-center">
          <span className="text-lg font-semibold">{notes.length === 0 ? "Belum ada surat piutang" : "Tidak ada piutang yang cocok"}</span>
          <span className="max-w-[420px] text-sm text-muted">{notes.length === 0 ? "Buat surat piutang pertama kamu." : "Coba kata kunci lain atau hapus filter."}</span>
          {notes.length === 0 ? (
            <LinkButton href="/app/piutang/baru">Buat surat piutang</LinkButton>
          ) : (
            <button type="button" onClick={() => { setQ(""); setRole("all"); setStatus("all"); }} className="min-h-11 rounded-full bg-brand px-5 text-sm font-medium">Hapus semua filter</button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {shown.map((n) => {
            const pct = Number((BigInt(n.paid) * BigInt(100)) / BigInt(n.totalOwed || "1"));
            const urgent = ["OVERDUE", "PENDING_SIGNATURE", "AWAITING_DISBURSEMENT"].includes(n.status);
            const lft = left(n);
            return (
              <Link key={n.id} href={`/app/piutang/${n.id}`} className="flex flex-col gap-3.5 rounded-[20px] border border-line bg-card p-5 text-white no-underline transition-colors hover:border-line2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-faint">{n.code} · {TYPES[n.debtType]}</span>
                  <StatusPill status={n.status} />
                </div>
                <span className="text-lg font-semibold leading-snug">{n.title}</span>
                <div className="flex items-center gap-2.5">
                  <Avatar name={n.party} size="sm" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{n.party}</span>
                    <span className="text-xs text-faint">{n.role === "creditor" ? "Debitur · kamu kreditur" : "Kreditur · kamu debitur"}</span>
                  </span>
                  {n.unread > 0 && <span className="ml-auto rounded-full bg-brand-soft px-2.5 py-1 text-xs text-lav">{n.unread} pesan</span>}
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-faint">Sisa dari {fmtRp(n.totalOwed)}</span>
                    <span className="text-xl font-semibold tabular-nums">{fmtRp(lft > BigInt(0) ? lft : BigInt(0))}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-line">
                    <div className={`h-full rounded-full ${n.status === "PAID" ? "bg-lav" : "bg-tusc"}`} style={{ width: `${n.status === "PAID" ? 100 : pct}%` }} />
                  </div>
                </div>
                <div className="flex justify-between gap-2 border-t border-line pt-3 text-xs">
                  <span className={urgent ? (n.status === "OVERDUE" ? "font-medium text-[#ff7aae]" : "font-medium text-peach") : "text-soft"}>{dueText(n)}</span>
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
    case "DRAFT": return n.isCreator ? "Draft, belum dikirim" : "Draft pihak lawan";
    case "PENDING_SIGNATURE": return n.mySignature ? "Menunggu tanda tangan pihak lain" : "Menunggu tanda tanganmu";
    case "AWAITING_DISBURSEMENT": return n.role === "debtor" ? "Konfirmasi dana sudah diterima" : "Menunggu konfirmasi debitur";
    case "PAID": return "Lunas";
    case "REJECTED": return "Ditolak";
    case "CANCELLED": return "Dibatalkan";
    case "DISPUTED": return "Sengketa ditinjau admin";
    case "FROZEN": return "Dibekukan";
    default: return n.nextDue ? `Jatuh tempo ${fmtDate(n.nextDue)}` : "-";
  }
}
