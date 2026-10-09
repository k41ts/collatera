"use client";
import Link from "next/link";
import { LinkButton, StatusPill, fmtDate } from "@/components/ui";
import { fmtRp } from "@/lib/money";
import { needsMySignature, useApi, type Me, type NoteSummary } from "@/lib/hooks";

const LIVE = ["ACTIVE", "OVERDUE", "DISPUTED", "FROZEN"];

export default function Dashboard() {
  const { data, loading } = useApi<{ notes: NoteSummary[] }>("/api/notes");
  const { data: me } = useApi<Me>("/api/me");
  const notes = data?.notes ?? [];
  const left = (n: NoteSummary) => BigInt(n.totalOwed) - BigInt(n.paid);
  const sum = (xs: NoteSummary[]) => xs.reduce((s, n) => s + (left(n) > BigInt(0) ? left(n) : BigInt(0)), BigInt(0));
  const asCreditor = notes.filter((n) => n.role === "creditor" && LIVE.includes(n.status));
  const asDebtor = notes.filter((n) => n.role === "debtor" && LIVE.includes(n.status));
  const week = Date.now() + 7 * 86400_000;
  const dueSoon = notes.filter((n) => LIVE.includes(n.status) && n.nextDue && new Date(n.nextDue).getTime() <= week);
  const toSign = notes.filter(needsMySignature);
  const toConfirm = notes.filter((n) => n.status === "AWAITING_DISBURSEMENT" && n.role === "debtor");
  const actions = toSign.length + toConfirm.length;
  const name = me?.user.name?.split(" ")[0];

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-faint">{new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" })}</span>
          <h1 className="text-[32px] font-semibold tracking-tight">Halo{name ? `, ${name}` : ""}</h1>
        </div>
        <LinkButton href="/app/piutang/baru">+ Buat surat piutang</LinkButton>
      </div>

      {me && !me.user.phoneVerifiedAt && (
        <Link href="/app/profil" className="rounded-2xl border border-butter/40 bg-[#3a3017] px-4 py-3 text-sm text-butter no-underline">
          Verifikasi nomor HP dulu sebelum membuat atau menandatangani surat piutang → <span className="underline">ke Profil</span>
        </Link>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3.5">
        <Tile big title="Piutang aktif (kamu kreditur)" value={fmtRp(sum(asCreditor))} sub={`${asCreditor.length} piutang · ${asCreditor.filter((n) => n.status === "OVERDUE").length} terlambat`} />
        <Tile title="Utang kamu (debitur)" value={fmtRp(sum(asDebtor))} sub={`${asDebtor.length} piutang`} />
        <Tile title="Jatuh tempo 7 hari ke depan" value={String(dueSoon.length)} sub="cicilan" />
        <Tile alert={actions > 0} title="Perlu tindakanmu" value={String(actions)} sub={`${toSign.length} tanda tangan · ${toConfirm.length} konfirmasi dana`} />
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <section aria-labelledby="judul-daftar" className="flex min-w-0 flex-[999_1_560px] flex-col gap-4 rounded-[20px] border border-line bg-card p-5">
          <div className="flex items-baseline gap-3">
            <h2 id="judul-daftar" className="text-lg font-semibold">Surat piutang terbaru</h2>
            <Link href="/app/piutang" className="text-[13px] font-medium text-lav">Lihat semua →</Link>
          </div>
          {loading ? (
            <p className="text-sm text-muted">Memuat…</p>
          ) : notes.length === 0 ? (
            <div className="flex flex-col items-start gap-3 py-6">
              <p className="text-sm text-muted">Belum ada surat piutang. Buat yang pertama, atau minta pihak lawan mengundang wallet kamu.</p>
              <LinkButton href="/app/piutang/baru">Buat surat piutang</LinkButton>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-faint">
                    <th className="px-3 py-2.5 font-medium">Piutang</th>
                    <th className="px-3 py-2.5 font-medium">Peranmu</th>
                    <th className="px-3 py-2.5 text-right font-medium">Sisa</th>
                    <th className="px-3 py-2.5 font-medium">Jatuh tempo berikutnya</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {notes.slice(0, 6).map((n) => (
                    <tr key={n.id} className="border-t border-line">
                      <td className="px-3 py-3.5">
                        <Link href={`/app/piutang/${n.id}`} className="font-medium text-white no-underline hover:text-lav">{n.title}</Link>
                        <div className="mt-0.5 text-xs text-faint">{n.code} · {n.party}</div>
                      </td>
                      <td className="px-3 py-3.5 text-soft">{n.role === "creditor" ? "Kreditur" : n.role === "debtor" ? "Debitur" : "-"}</td>
                      <td className="px-3 py-3.5 text-right tabular-nums">{fmtRp(left(n) > BigInt(0) ? left(n) : BigInt(0))}</td>
                      <td className="px-3 py-3.5 text-soft tabular-nums">{n.nextDue && LIVE.includes(n.status) ? fmtDate(n.nextDue) : "-"}</td>
                      <td className="px-3 py-3.5"><StatusPill status={n.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="judul-tindakan" className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
          <h2 id="judul-tindakan" className="text-lg font-semibold">Perlu tindakan</h2>
          {actions === 0 && <p className="rounded-2xl border border-line bg-card p-4 text-sm text-muted">Tidak ada yang perlu kamu lakukan sekarang.</p>}
          {toSign.map((n) => (
            <ActionCard key={n.id} href={`/app/piutang/${n.id}`} tag="TANDA TANGAN" tagCls="bg-pink text-pink-ink" title={`${n.title} · ${fmtRp(n.totalOwed)}`} sub={`${n.party} · versi ${n.version} · kamu ${n.role === "creditor" ? "kreditur" : "debitur"}`} cta="Review & tanda tangan →" />
          ))}
          {toConfirm.map((n) => (
            <ActionCard key={n.id} href={`/app/piutang/${n.id}`} tag="KONFIRMASI DANA" tagCls="bg-butter text-butter-ink" title={`Sudah terima ${fmtRp(n.principal)}?`} sub={`${n.title} · dari ${n.party}`} cta="Konfirmasi terima dana →" />
          ))}
        </section>
      </div>
    </div>
  );
}

function Tile({ title, value, sub, big, alert }: { title: string; value: string; sub: string; big?: boolean; alert?: boolean }) {
  return (
    <div className={`flex flex-col gap-2.5 rounded-[18px] p-5 ${big ? "bg-brand" : `border bg-card ${alert ? "border-rasp" : "border-line"}`}`}>
      <span className={`text-[13px] ${big ? "text-brand-tint" : alert ? "text-pink" : "text-muted"}`}>{title}</span>
      <span className="text-[28px] font-semibold tabular-nums">{value}</span>
      <span className={`text-xs ${big ? "text-brand-tint" : "text-muted"}`}>{sub}</span>
    </div>
  );
}

function ActionCard({ href, tag, tagCls, title, sub, cta }: { href: string; tag: string; tagCls: string; title: string; sub: string; cta: string }) {
  return (
    <Link href={href} className="flex flex-col gap-2 rounded-2xl border border-line bg-card p-4 text-white no-underline hover:border-line2">
      <span className={`self-start rounded-md px-2 py-1 text-[11px] font-semibold ${tagCls}`}>{tag}</span>
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-muted">{sub}</span>
      <span className="text-[13px] font-medium text-lav">{cta}</span>
    </Link>
  );
}
