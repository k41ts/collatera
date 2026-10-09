"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar, StatusPill, fmtDate, input } from "@/components/ui";
import { fmtRp } from "@/lib/money";
import { needsMySignature, useApi, type NoteSummary } from "@/lib/hooks";

type Tab = "mine" | "waiting" | "done";
const tabOf = (n: NoteSummary): Tab | null => {
  if (needsMySignature(n)) return "mine";
  if (n.status === "AWAITING_DISBURSEMENT" && n.role === "debtor") return "mine";
  if (n.status === "PENDING_SIGNATURE" || n.status === "AWAITING_DISBURSEMENT") return "waiting";
  if (["ACTIVE", "OVERDUE", "DISPUTED", "FROZEN", "PAID", "REJECTED", "CANCELLED"].includes(n.status)) return "done";
  return null;
};

const HINT: Record<Tab, string> = {
  mine: "Baca isi dan dokumennya dulu. Tanda tangan gratis dan baru mengikat setelah kedua pihak tanda tangan.",
  waiting: "Kamu sudah tanda tangan. Selama pihak lain belum tanda tangan, kreditur masih bisa menarik dana escrow.",
  done: "Surat yang sudah aktif, lunas, ditolak, atau dibatalkan.",
};

export default function SignListPage() {
  const { data, loading } = useApi<{ notes: NoteSummary[] }>("/api/notes");
  const [tab, setTab] = useState<Tab>("mine");
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return (data?.notes ?? []).filter((n) => !qq || `${n.title} ${n.party} ${n.code}`.toLowerCase().includes(qq));
  }, [data, q]);
  const cards = matches.filter((n) => tabOf(n) === tab);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-faint">Surat piutang yang perlu atau sudah kamu tanda tangani</span>
        <h1 className="text-[32px] font-semibold tracking-tight">Tanda tangan</h1>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Kelompok surat" className="flex flex-wrap gap-1 rounded-[14px] border border-line bg-card p-1">
          {([["mine", "Perlu tindakanmu"], ["waiting", "Menunggu pihak lain"], ["done", "Selesai"]] as const).map(([k, l]) => {
            const on = tab === k;
            const count = matches.filter((n) => tabOf(n) === k).length;
            return (
              <button key={k} type="button" role="tab" aria-selected={on} onClick={() => setTab(k)} className={`inline-flex min-h-10 items-center gap-2 rounded-[10px] px-3.5 text-[13px] ${on ? "bg-brand font-medium text-white" : "text-muted"}`}>
                {l}
                <span className={`rounded-full px-1.5 text-[11px] font-semibold ${k === "mine" && count ? "bg-rasp text-white" : on ? "bg-white/20" : "bg-line text-soft"}`}>{count}</span>
              </button>
            );
          })}
        </div>
        <div className="relative min-w-0 flex-[0_1_360px]">
          <label htmlFor="cari-surat" className="sr-only">Cari surat</label>
          <input id="cari-surat" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari judul atau nama pihak" className={`${input} bg-card text-sm`} />
        </div>
      </div>
      <p className="max-w-[760px] text-sm text-muted">{HINT[tab]}</p>

      {loading ? (
        <p className="text-muted">Memuat…</p>
      ) : cards.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-[20px] border border-dashed border-line2 px-6 py-12 text-center">
          <span className="text-lg font-semibold">Tidak ada surat di sini</span>
          <span className="text-sm text-muted">Coba tab lain atau kata kunci lain.</span>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4">
          {cards.map((n) => {
            const mine = tab === "mine";
            const receipt = n.status === "AWAITING_DISBURSEMENT";
            return (
              <Link key={n.id} href={`/app/piutang/${n.id}`} className={`flex flex-col gap-3.5 rounded-[20px] border bg-card p-5 text-white no-underline ${mine ? "border-rasp/70" : "border-line"} hover:border-line2`}>
                <div className="flex items-center gap-2.5">
                  <Avatar name={n.party} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{headline(n)}</span>
                    <span className="text-xs text-faint">{n.code} · versi {n.version}</span>
                  </span>
                  <StatusPill status={n.status} />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-lg font-semibold leading-snug">{n.title}</span>
                  <span className="text-[13px] text-muted">Peranmu: <strong className="font-semibold text-white">{n.role === "creditor" ? "Kreditur (pemberi utang)" : "Debitur (penerima utang)"}</strong></span>
                </div>
                <dl className="grid grid-cols-2 gap-3 rounded-[14px] bg-midnight p-3.5 text-[13px]">
                  <div><dt className="text-xs text-faint">Total</dt><dd className="mt-0.5 text-base font-semibold tabular-nums">{fmtRp(n.totalOwed)}</dd></div>
                  <div><dt className="text-xs text-faint">Cicilan</dt><dd className="mt-0.5 font-medium">{n.installmentCount === 1 ? "Sekali lunas" : `${n.installmentCount}×`}{n.nextDue ? `, mulai ${fmtDate(n.nextDue)}` : ""}</dd></div>
                  <div><dt className="text-xs text-faint">Pencairan</dt><dd className="mt-0.5 font-medium">{n.disbursement === "onchain" ? "Escrow stablecoin" : "Transfer sendiri"}</dd></div>
                  <div><dt className="text-xs text-faint">Denda terlambat</dt><dd className="mt-0.5 font-medium">{n.lateFeeBps ? "2% per bulan" : "Tanpa denda"}</dd></div>
                </dl>
                <span className={`flex min-h-[46px] items-center justify-center rounded-full px-3 text-center text-sm font-medium ${mine ? "bg-brand text-white" : "border border-line2 text-lav"}`}>
                  {mine ? (receipt ? "Konfirmasi dana diterima →" : "Review & tanda tangan →") : "Lihat surat →"}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function headline(n: NoteSummary) {
  if (n.status === "AWAITING_DISBURSEMENT") return n.role === "debtor" ? `${n.party} akan mentransfer pokok` : `Menunggu ${n.party} konfirmasi dana`;
  if (n.status === "PENDING_SIGNATURE") return n.mySignature ? `Menunggu tanda tangan ${n.party}` : n.isCreator ? "Draft kamu siap ditandatangani" : `${n.party} mengundangmu`;
  if (n.status === "REJECTED") return "Ditolak";
  if (n.status === "CANCELLED") return "Dibatalkan";
  return `Ditandatangani berdua · ${n.party}`;
}
