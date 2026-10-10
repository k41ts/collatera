"use client";
import Link from "next/link";
import { LinkButton, StatusPill, fmtDate } from "@/components/ui";
import { fmtRp } from "@/lib/money";
import { ActionCardSkeleton, Loading, NoteRowsSkeleton, TileSkeleton } from "@/components/Skeleton";
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
  const toRevise = notes.filter((n) => n.revision === "requested");
  const toConfirm = notes.filter((n) => n.status === "AWAITING_DISBURSEMENT" && n.role === "debtor");
  const actions = toRevise.length + toSign.length + toConfirm.length;
  const name = me?.user.name?.split(" ")[0];

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-faint">{new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" })}</span>
          <h1 className="text-[26px] font-extrabold tracking-[-0.035em] sm:text-[32px]">Halo{name ? `, ${name}` : ""}</h1>
        </div>
        <LinkButton href="/app/piutang/baru" className="max-sm:hidden">+ Buat surat piutang</LinkButton>
      </div>

      {me && !me.user.phoneVerifiedAt && (
        <Link href="/app/profil" className="rounded-2xl border border-butter/40 bg-raised px-4 py-3 text-sm leading-relaxed text-butter no-underline">
          Verifikasi nomor HP dulu sebelum membuat atau menandatangani surat piutang → <span className="underline">ke Profil</span>
        </Link>
      )}

      {loading ? (
        <Loading label="Memuat ringkasan…" className="grid grid-cols-2 gap-3 sm:gap-3.5 xl:grid-cols-4">
          <TileSkeleton wide big />
          <TileSkeleton wide />
          <TileSkeleton />
          <TileSkeleton />
        </Loading>
      ) : (
      <div className="grid grid-cols-2 gap-3 sm:gap-3.5 xl:grid-cols-4">
        <Tile wide big title="Piutang aktif (kamu kreditur)" value={fmtRp(sum(asCreditor))} sub={`${asCreditor.length} piutang · ${asCreditor.filter((n) => n.status === "OVERDUE").length} terlambat`} />
        <Tile wide title="Utang kamu (debitur)" value={fmtRp(sum(asDebtor))} sub={`${asDebtor.length} piutang`} />
        <Tile title="Jatuh tempo 7 hari ke depan" value={String(dueSoon.length)} sub="cicilan" />
        <Tile alert={actions > 0} title="Perlu tindakanmu" value={String(actions)} sub={`${toSign.length} tanda tangan · ${toConfirm.length} konfirmasi dana`} />
      </div>
      )}

      <div className="flex flex-wrap items-start gap-5">
        <section aria-labelledby="judul-daftar" className="flex min-w-0 flex-[999_1_560px] flex-col gap-4 rounded-[20px] border border-line bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 sm:justify-start">
            <h2 id="judul-daftar" className="text-lg font-bold">Surat piutang terbaru</h2>
            <Link href="/app/piutang" className="text-[13px] font-medium text-lav">Lihat semua →</Link>
          </div>
          {loading ? (
            <NoteRowsSkeleton />
          ) : notes.length === 0 ? (
            <div className="flex flex-col items-start gap-3 py-6">
              <p className="text-sm text-muted">Belum ada surat piutang. Buat yang pertama, atau minta pihak lawan mengundang wallet kamu.</p>
              <LinkButton href="/app/piutang/baru">Buat surat piutang</LinkButton>
            </div>
          ) : (
            <>
            {/* Layar kecil: daftar kartu */}
            <ul className="-mx-1 flex flex-col md:hidden">
              {notes.slice(0, 6).map((n) => (
                <li key={n.id} className="border-t border-line first:border-t-0">
                  <Link href={`/app/piutang/${n.id}`} className="flex flex-col gap-2 rounded-xl px-1 py-3.5 text-ink no-underline active:bg-raised">
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block font-medium leading-snug [overflow-wrap:anywhere]">{n.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-faint">{n.code} · {n.party}</span>
                      </span>
                      <StatusPill status={n.status} />
                    </span>
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px]">
                      <span className="text-soft">
                        {n.role === "creditor" ? "Kreditur" : n.role === "debtor" ? "Debitur" : "-"}
                        {n.nextDue && LIVE.includes(n.status) ? ` · jatuh tempo ${fmtDate(n.nextDue)}` : ""}
                      </span>
                      <span className="ml-auto min-w-0 text-right font-semibold tabular-nums [overflow-wrap:anywhere]">{fmtRp(left(n) > BigInt(0) ? left(n) : BigInt(0))}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-sm">
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
                        <Link href={`/app/piutang/${n.id}`} className="font-medium text-ink no-underline [overflow-wrap:anywhere] hover:text-lav">{n.title}</Link>
                        <div className="mt-0.5 text-xs text-faint [overflow-wrap:anywhere]">{n.code} · {n.party}</div>
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
            </>
          )}
        </section>

        <section aria-labelledby="judul-tindakan" className="flex min-w-0 flex-[1_1_300px] flex-col gap-3">
          <h2 id="judul-tindakan" className="text-lg font-bold">Perlu tindakan</h2>
          {loading && (
            <Loading label="Memuat tindakan…" className="flex flex-col gap-3">
              <ActionCardSkeleton />
              <ActionCardSkeleton />
            </Loading>
          )}
          {!loading && actions === 0 && <p className="rounded-2xl border border-line bg-card p-4 text-sm text-muted">Tidak ada yang perlu kamu lakukan sekarang.</p>}
          {toRevise.map((n) => (
            <ActionCard key={n.id} href={`/app/piutang/${n.id}/ubah`} tag="REVISI DIMINTA" tagCls="bg-butter text-butter-ink" title={n.title} sub={`${n.party}: “${n.revisionNote}”`} cta="Perbaiki draft →" />
          ))}
          {toSign.map((n) => (
            <ActionCard key={n.id} href={`/app/piutang/${n.id}`} tag={n.revision === "done" ? `SUDAH DIREVISI · VERSI ${n.version}` : "TANDA TANGAN"} tagCls={n.revision === "done" ? "bg-mint text-mint-ink" : "bg-pink text-pink-ink"} title={`${n.title} · ${fmtRp(n.totalOwed)}`} sub={`${n.party} · versi ${n.version} · kamu ${n.role === "creditor" ? "kreditur" : "debitur"}`} cta="Review & tanda tangan →" />
          ))}
          {toConfirm.map((n) => (
            <ActionCard key={n.id} href={`/app/piutang/${n.id}`} tag="KONFIRMASI DANA" tagCls="bg-butter text-butter-ink" title={`Sudah terima ${fmtRp(n.principal)}?`} sub={`${n.title} · dari ${n.party}`} cta="Konfirmasi terima dana →" />
          ))}
        </section>
      </div>
    </div>
  );
}

function Tile({ title, value, sub, big, alert, wide }: { title: string; value: string; sub: string; big?: boolean; alert?: boolean; wide?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-2 rounded-[18px] p-4 sm:gap-2.5 sm:p-5 ${wide ? "col-span-2 sm:col-span-1" : ""} ${big ? "bg-brand" : `border bg-card ${alert ? "border-rasp" : "border-line"}`}`}>
      <span className={`text-[13px] leading-snug ${big ? "text-brand-tint" : alert ? "text-pink" : "text-muted"}`}>{title}</span>
      <span className="text-[24px] font-semibold leading-tight tabular-nums [overflow-wrap:anywhere] sm:text-[clamp(20px,2.4vw,28px)]">{value}</span>
      <span className={`text-xs ${big ? "text-brand-tint" : "text-muted"}`}>{sub}</span>
    </div>
  );
}

function ActionCard({ href, tag, tagCls, title, sub, cta }: { href: string; tag: string; tagCls: string; title: string; sub: string; cta: string }) {
  return (
    <Link href={href} className="flex flex-col gap-2 rounded-2xl border border-line bg-card p-4 text-ink no-underline hover:border-line2">
      <span className={`self-start rounded-md px-2 py-1 text-[11px] font-semibold ${tagCls}`}>{tag}</span>
      <span className="text-sm font-medium [overflow-wrap:anywhere]">{title}</span>
      <span className="text-xs text-muted [overflow-wrap:anywhere]">{sub}</span>
      <span className="text-[13px] font-medium text-lav">{cta}</span>
    </Link>
  );
}
