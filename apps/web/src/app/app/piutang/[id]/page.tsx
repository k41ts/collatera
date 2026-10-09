"use client";
import Link from "next/link";
import { use, useState } from "react";
import { keccak256, toUtf8Bytes } from "ethers";
import { Avatar, Button, Card, Field, LinkButton, Notice, Spinner, StatusPill, fmtDate, input } from "@/components/ui";
import { api, forwardAction, payOnchain, short, signTyped } from "@/lib/client";
import { useApi } from "@/lib/hooks";
import { fmtRp, rupiahToUnits, unitsToRupiah } from "@/lib/money";
import { txUrl } from "@/lib/chain/config";
import { splitSig } from "@/lib/chain/eip712";

type Payment = { id: string; method: string; amount: string; installment: number; status: string; proofName: string | null; rejectReason: string | null; txHash: string | null; createdAt: string };
type Detail = {
  note: {
    id: string; code: string; chainNoteId: string; inviteToken?: string; version: number; status: string; creatorRole: string; title: string;
    debtType: string; principal: string; interestType: string; interestValue: string; totalOwed: string; lateFeeBps: number; disbursement: string;
    collateralNote: string; counterpartyWallet: string | null; rejectReason: string | null; revisionNote: string | null; escrowTx: string | null;
    escrowTerms: Record<string, unknown> | null; escrowIsCurrent: boolean; activationTx: string | null; activatedAt: string | null; docHash: string | null;
    integrity: string; integrityAt: string | null; createdAt: string;
    installments: { seq: number; dueDate: string; amount: string }[];
    documents: { id: string; name: string; size: number; fileHash: string }[];
    payments: Payment[];
    events: { action: string; detail: string; txHash: string | null; createdAt: string }[];
    creditor: { name: string; wallet: string } | null; debtor: { name: string; wallet: string } | null;
    creditorSigned: boolean; debtorSigned: boolean;
  };
  me: { role: "creditor" | "debtor" | null; isCreator: boolean; isAdmin: boolean; wallet: string; phoneVerified: boolean };
  other: { name: string; wallet: string } | null;
  chain: { status: string; remaining: string; paid: string; scheduledPaid: string; lateFee: string; overdue: string; fullyPaid: boolean } | null;
};

const TYPES: Record<string, string> = { personal: "Pinjaman pribadi", business: "Bisnis", invoice: "Invoice", other: "Lainnya" };
const LIVE = ["ACTIVE", "OVERDUE", "DISPUTED", "FROZEN"];

export default function NoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, refresh } = useApi<Detail>(`/api/notes/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "info"; text: string; tx?: string } | null>(null);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-muted">Memuat…</p>;
  const { note: n, me, chain } = data;
  const role = me.role;
  const isLive = LIVE.includes(n.status);

  /** Jalankan aksi dengan status sibuk + pesan hasil. */
  async function run(key: string, fn: () => Promise<{ txHash?: string } | unknown>, okText: string) {
    setBusy(key);
    setMsg({ tone: "info", text: "Memproses… konfirmasi di MetaMask bila diminta, lalu tunggu transaksi masuk blok (±15 detik)." });
    try {
      const r = (await fn()) as { txHash?: string } | undefined;
      setMsg({ tone: "ok", text: okText, tx: r?.txHash });
      await refresh();
    } catch (e) {
      const err = e as { code?: string | number; message: string };
      setMsg({ tone: "error", text: err.code === 4001 || err.code === "ACTION_REJECTED" ? "Dibatalkan di MetaMask." : err.message });
    } finally {
      setBusy(null);
    }
  }

  const action = (body: Record<string, unknown>) => api(`/api/notes/${id}/action`, { method: "POST", json: body });
  const ask = (q: string) => {
    const r = window.prompt(q);
    return r && r.trim() ? r.trim() : null;
  };

  async function signNote() {
    const t = await api<{ domain: Record<string, unknown>; types: never; message: Record<string, unknown>; permit: { domain: Record<string, unknown>; types: never; message: Record<string, unknown> } | null; balance: string | null }>(`/api/notes/${id}/sign?kind=note`);
    if (t.permit && t.balance !== null && BigInt(t.balance) < BigInt(n.principal))
      throw new Error(`Saldo IDRX kamu ${fmtRp(t.balance)}, kurang dari pokok ${fmtRp(n.principal)}. Ambil dulu dari faucet di halaman Profil.`);
    const signature = await signTyped(t, me.wallet);
    let permit;
    if (t.permit) {
      const ps = await signTyped(t.permit, me.wallet);
      permit = { deadline: String(t.permit.message.deadline), ...splitSig(ps) };
    }
    return api<{ status: string; txHash?: string }>(`/api/notes/${id}/sign`, { method: "POST", json: { kind: "note", signature, permit } });
  }

  async function signReceipt() {
    const t = await api<{ domain: Record<string, unknown>; types: never; message: { noteHash: string; proofHash: string; amount: string; nonce: string; deadline: number } }>(`/api/notes/${id}/sign?kind=receipt`);
    const signature = await signTyped(t, me.wallet);
    return api(`/api/notes/${id}/sign`, { method: "POST", json: { kind: "receipt", signature, message: t.message } });
  }

  // ---- angka dari kontrak ----
  const scheduledPaid = BigInt(chain?.scheduledPaid ?? "0");
  let cum = BigInt(0);
  const now = Date.now();
  const rows = n.installments.map((i) => {
    const start = cum;
    cum += BigInt(i.amount);
    const paidPart = scheduledPaid >= cum ? BigInt(i.amount) : scheduledPaid > start ? scheduledPaid - start : BigInt(0);
    const due = new Date(i.dueDate).getTime() - 7 * 3600_000;
    const status = n.status === "PAID" || paidPart === BigInt(i.amount) ? "Lunas" : !isLive ? "-" : due < now ? "Terlambat" : paidPart > BigInt(0) ? "Sebagian" : "Belum jatuh tempo";
    return { ...i, paidPart, status };
  });
  const nextUnpaid = rows.find((r) => r.status !== "Lunas");
  const remaining = chain ? BigInt(chain.remaining) : BigInt(n.totalOwed);
  const paidTotal = BigInt(chain?.paid ?? "0");
  const pct = n.status === "PAID" ? 100 : Number((scheduledPaid * BigInt(100)) / BigInt(n.totalOwed));
  const pending = n.payments.filter((p) => p.status === "PENDING");

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6">
      <nav aria-label="Breadcrumb" className="flex gap-2 text-[13px] text-faint">
        <Link href="/app/piutang" className="text-soft no-underline">Piutang saya</Link>
        <span aria-hidden>/</span>
        <span>{n.code}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4 sm:gap-5">
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex flex-wrap gap-2">
            <StatusPill status={n.status} />
            {n.integrity !== "UNCHECKED" && (
              <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold tracking-wide ${n.integrity === "VERIFIED" ? "bg-[#13303a] text-cyan" : "bg-rasp text-white"}`}>{n.integrity}{n.integrityAt ? ` · ${fmtDate(n.integrityAt, true)}` : ""}</span>
            )}
            <span className="rounded-md bg-raised px-2.5 py-1 text-[11px] font-medium text-soft">{TYPES[n.debtType]} · versi {n.version}</span>
          </div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] sm:text-[34px]">{n.title}</h1>
          <span className="text-sm leading-relaxed text-muted">
            Kamu <strong className="font-semibold text-white">{role === "creditor" ? "kreditur" : role === "debtor" ? "debitur" : "pengamat"}</strong>
            {data.other ? ` · ${data.other.name} ${role === "creditor" ? "debitur" : "kreditur"}` : n.counterpartyWallet ? ` · menunggu ${short(n.counterpartyWallet)} bergabung` : ""}
            {n.activatedAt ? ` · aktif sejak ${fmtDate(n.activatedAt)}` : ` · dibuat ${fmtDate(n.createdAt)}`}
          </span>
        </div>
        <div className="flex w-full flex-wrap gap-2.5 max-sm:[&>*]:flex-[1_1_40%] sm:w-auto">
          <LinkButton href={`/app/chat?note=${n.id}`}>Chat{data.other ? ` dengan ${data.other.name.split(" ")[0]}` : ""}</LinkButton>
          {isLive && (
            <Button variant="secondary" disabled={!!busy} onClick={() => run("integrity", () => api(`/api/notes/${id}/integrity`, { method: "POST" }), "Cek integritas selesai.")}>
              {busy === "integrity" && <Spinner />} Cek integritas
            </Button>
          )}
          {["ACTIVE", "OVERDUE"].includes(n.status) && role === "creditor" && (
            <Button variant="secondary" disabled={!!busy} onClick={() => {
              if (!window.confirm(`Ikhlaskan sisa utang ${fmtRp(remaining)}? Piutang langsung ditandai lunas dan tidak bisa dibatalkan.`)) return;
              run("waive", () => forwardAction({ noteId: id, wallet: me.wallet, fn: "markPaid", args: [n.chainNoteId], purpose: "markPaid" }), "Piutang ditandai lunas.");
            }}>Ikhlaskan sisa</Button>
          )}
          {["ACTIVE", "OVERDUE"].includes(n.status) && role && (
            <Button variant="danger" disabled={!!busy} onClick={() => {
              const reason = ask("Jelaskan alasan sengketa (min. 10 huruf):");
              if (!reason) return;
              run("dispute", () => forwardAction({ noteId: id, wallet: me.wallet, fn: "openDispute", args: [n.chainNoteId, keccak256(toUtf8Bytes(reason))], purpose: "dispute", reason }), "Sengketa diajukan. Admin akan meninjau.");
            }}>Ajukan sengketa</Button>
          )}
          {me.isAdmin && n.status === "DISPUTED" && (
            <Button variant="secondary" disabled={!!busy} onClick={() => {
              const r = ask("Ringkasan keputusan admin:");
              if (!r) return;
              run("close", () => forwardAction({ noteId: id, wallet: me.wallet, fn: "closeDispute", args: [n.chainNoteId, keccak256(toUtf8Bytes(r))], purpose: "closeDispute" }), "Sengketa ditutup.");
            }}>Tutup sengketa (admin)</Button>
          )}
          {me.isAdmin && n.status === "FROZEN" && (
            <Button variant="secondary" disabled={!!busy} onClick={() => {
              const r = ask("Catatan pemulihan data:");
              if (!r) return;
              run("unfreeze", () => forwardAction({ noteId: id, wallet: me.wallet, fn: "unfreeze", args: [n.chainNoteId, keccak256(toUtf8Bytes(r))], purpose: "unfreeze" }), "Pembekuan dibuka.");
            }}>Buka pembekuan (admin)</Button>
          )}
        </div>
      </header>

      {msg && (
        <Notice tone={msg.tone}>
          {msg.text}{" "}
          {msg.tx && txUrl(msg.tx) && <a href={txUrl(msg.tx)!} target="_blank" rel="noreferrer" className="underline">Lihat transaksi ↗</a>}
        </Notice>
      )}

      {/* ---------------- banner aksi per status ---------------- */}
      {n.status === "DRAFT" && (
        <Card className="flex flex-col gap-3 border-line2">
          {n.revisionNote && <Notice tone="warn">Revisi diminta: “{n.revisionNote}”</Notice>}
          {me.isCreator ? (
            <>
              <h2 className="text-lg font-semibold">Draft versi {n.version} belum dikirim</h2>
              <p className="text-sm text-muted">Periksa isi, jadwal, dan dokumen. Setelah dikirim, {n.counterpartyWallet ? short(n.counterpartyWallet) : "pihak lawan"} bisa menandatangani, minta revisi, atau menolak.</p>
              {!me.phoneVerified && <Notice tone="warn">Verifikasi nomor HP dulu di <Link href="/app/profil" className="underline">Profil</Link>.</Notice>}
              <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
                <Button disabled={!!busy || !me.phoneVerified} onClick={() => run("send", () => action({ action: "send" }), "Terkirim. Sekarang tanda tangani dari halaman ini.")}>
                  {busy === "send" && <Spinner />} Kirim untuk tanda tangan
                </Button>
                <LinkButton href={`/app/piutang/${id}/ubah`} variant="secondary">Ubah draft</LinkButton>
                <Button variant="danger" disabled={!!busy} onClick={() => window.confirm("Batalkan draft ini?") && run("cancel", () => action({ action: "cancel" }), "Draft dibatalkan.")}>Batalkan</Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">Pembuat sedang menyiapkan versi {n.version}. Kamu akan diberi tahu lewat chat saat siap ditandatangani.</p>
          )}
        </Card>
      )}

      {n.status === "PENDING_SIGNATURE" && (
        <Card className="flex flex-col gap-4 border-peach/50">
          <h2 className="text-lg font-semibold">Menunggu tanda tangan · versi {n.version}</h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3 text-sm">
            <SignState label="Kreditur" who={n.creditor?.name ?? short(n.counterpartyWallet)} done={n.creditorSigned} extra={n.disbursement === "onchain" ? (n.escrowIsCurrent ? "Dana sudah di escrow" : "Setor escrow saat tanda tangan") : undefined} />
            <SignState label="Debitur" who={n.debtor?.name ?? short(n.counterpartyWallet)} done={n.debtorSigned} />
          </div>
          {role && !(role === "creditor" ? n.creditorSigned : n.debtorSigned) && (
            <>
              <p className="text-sm text-muted">
                Kamu akan menandatangani pesan berisi seluruh isi perjanjian (gratis, tanpa gas).
                {role === "creditor" && n.disbursement === "onchain" && <> Sebagai kreditur kamu juga menandatangani <strong className="text-white">izin setor {fmtRp(n.principal)} ke escrow</strong>; dana baru cair ke debitur setelah dia ikut tanda tangan, dan bisa kamu tarik kapan saja sebelum itu.</>}
              </p>
              {!me.phoneVerified && <Notice tone="warn">Verifikasi nomor HP dulu di <Link href="/app/profil" className="underline">Profil</Link>.</Notice>}
              <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
                <Button disabled={!!busy || !me.phoneVerified} onClick={() => run("sign", signNote, "Tanda tangan tersimpan.")}>
                  {busy === "sign" && <Spinner />} Setuju &amp; tanda tangan
                </Button>
                {!me.isCreator && (
                  <>
                    <Button variant="secondary" disabled={!!busy} onClick={() => { const r = ask("Apa yang perlu diubah?"); if (r) run("revise", () => action({ action: "revise", reason: r }), "Permintaan revisi terkirim."); }}>Minta revisi</Button>
                    <Button variant="danger" disabled={!!busy} onClick={() => { const r = ask("Alasan penolakan (wajib, final):"); if (r) run("reject", () => action({ action: "reject", reason: r }), "Surat ditolak."); }}>Tolak</Button>
                  </>
                )}
              </div>
            </>
          )}
          {me.isCreator && (
            <div><Button variant="danger" disabled={!!busy} onClick={() => window.confirm("Batalkan surat ini?") && run("cancel", () => action({ action: "cancel" }), "Surat dibatalkan.")}>Batalkan surat</Button></div>
          )}
        </Card>
      )}

      {n.status === "AWAITING_DISBURSEMENT" && (
        <Card className="flex flex-col gap-3 border-butter/50">
          <h2 className="text-lg font-semibold">Menunggu pencairan {fmtRp(n.principal)}</h2>
          {role === "debtor" ? (
            <>
              <p className="text-sm text-muted">Kedua pihak sudah tanda tangan. Setelah kreditur mentransfer pokok, konfirmasi di sini. Bukti digital baru terbit setelah kamu konfirmasi.</p>
              <div><Button disabled={!!busy} onClick={() => run("receipt", signReceipt, "Dana dikonfirmasi. Piutang aktif.")}>{busy === "receipt" && <Spinner />} Dana sudah saya terima</Button></div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">Transfer {fmtRp(n.principal)} ke debitur lewat bank atau tunai, lalu minta debitur mengonfirmasi di aplikasi.</p>
              {role === "creditor" && <div><Button variant="danger" disabled={!!busy} onClick={() => window.confirm("Batalkan sebelum dana dicairkan?") && run("cancel", () => action({ action: "cancel" }), "Surat dibatalkan.")}>Batalkan</Button></div>}
            </>
          )}
        </Card>
      )}

      {(n.status === "REJECTED" || n.status === "CANCELLED") && (
        <Card className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{n.status === "REJECTED" ? "Surat ditolak" : "Surat dibatalkan"}</h2>
          {n.rejectReason && <p className="text-sm text-muted">Alasan: “{n.rejectReason}”</p>}
        </Card>
      )}

      {n.escrowTerms && role === "creditor" && !n.escrowIsCurrent && (
        <Notice tone="warn">
          Dana escrow {fmtRp(String(n.escrowTerms.principal))} dari versi sebelumnya masih tertahan.{" "}
          <button type="button" className="font-semibold underline" disabled={!!busy} onClick={() => run("refund", () => forwardAction({ noteId: id, wallet: me.wallet, fn: "refundEscrow", args: [n.escrowTerms], purpose: "refund" }), "Dana escrow kembali ke wallet kamu.")}>
            Tarik dana escrow
          </button>
        </Notice>
      )}

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
          <section aria-label="Ringkasan" className="flex flex-col gap-5 rounded-[22px] bg-brand p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] text-brand-tint">{chain ? "Sisa utang (termasuk denda berjalan)" : "Total yang harus dibayar"}</span>
                <span className="text-[32px] font-semibold leading-tight tracking-tight tabular-nums [overflow-wrap:anywhere] sm:text-[44px]">{fmtRp(n.status === "PAID" ? "0" : chain ? remaining : n.totalOwed)}</span>
              </div>
              {chain && <span className="text-[13px] text-brand-tint tabular-nums">Terbayar {fmtRp(paidTotal)} dari {fmtRp(n.totalOwed)}</span>}
            </div>
            <div role="progressbar" aria-label="Progres pelunasan" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2.5 overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-tusc" style={{ width: `${pct}%` }} />
            </div>
            <dl className="grid grid-cols-2 gap-4 text-[13px] sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
              <Stat k="Pokok" v={fmtRp(n.principal)} />
              <Stat k="Bunga" v={n.interestType === "none" ? "Tanpa bunga" : n.interestType === "percent" ? `${n.interestValue}%` : `Rp${Number(n.interestValue).toLocaleString("id-ID")}`} />
              <Stat k="Denda terlambat" v={n.lateFeeBps ? "2% per bulan" : "Tanpa denda"} />
              <Stat k="Pencairan" v={n.disbursement === "onchain" ? "Escrow stablecoin" : "Transfer sendiri"} />
              {chain && BigInt(chain.lateFee) > BigInt(0) && <Stat k="Denda belum dibayar" v={fmtRp(chain.lateFee)} />}
              {chain && BigInt(chain.overdue) > BigInt(0) && <Stat k="Tunggakan" v={fmtRp(chain.overdue)} />}
            </dl>
            {n.collateralNote && <p className="text-[13px] text-brand-tint">Jaminan: {n.collateralNote}</p>}
          </section>

          <Card className="flex flex-col gap-3.5">
            <h2 className="text-lg font-semibold">Jadwal cicilan</h2>
            {/* Layar kecil: kartu per cicilan */}
            <ol className="flex flex-col sm:hidden">
              {rows.map((r) => (
                <li key={r.seq} className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium">Cicilan {r.seq} dari {rows.length}</span>
                    <span className="text-xs text-faint tabular-nums">{fmtDate(r.dueDate)}</span>
                  </span>
                  <span className="flex flex-none flex-col items-end gap-1">
                    <span className="text-sm font-semibold tabular-nums">{fmtRp(r.amount)}</span>
                    <InstallmentPill status={r.status} />
                  </span>
                </li>
              ))}
            </ol>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-faint">
                    <th className="px-3 py-2 font-medium">Cicilan</th><th className="px-3 py-2 font-medium">Jatuh tempo</th>
                    <th className="px-3 py-2 text-right font-medium">Nominal</th><th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.seq} className="border-t border-line">
                      <td className="p-3">{r.seq} dari {rows.length}</td>
                      <td className="p-3 text-soft tabular-nums">{fmtDate(r.dueDate)}</td>
                      <td className="p-3 text-right tabular-nums">{fmtRp(r.amount)}</td>
                      <td className="p-3"><InstallmentPill status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {(isLive || n.status === "PAID") && (
            <Card id="pembayaran" className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Pembayaran</h2>
              {role === "debtor" && ["ACTIVE", "OVERDUE", "DISPUTED"].includes(n.status) && remaining > BigInt(0) && (
                <PayBox
                  disabled={!!busy}
                  allowOffchain={n.status !== "DISPUTED"}
                  suggested={chain && BigInt(chain.overdue) > BigInt(0) ? BigInt(chain.overdue) + BigInt(chain.lateFee) : nextUnpaid ? BigInt(nextUnpaid.amount) - nextUnpaid.paidPart : remaining}
                  remaining={remaining}
                  installment={nextUnpaid?.seq ?? 1}
                  onOnchain={(amount, inst) => run("pay", () => payOnchain({ noteId: id, chainNoteId: n.chainNoteId, wallet: me.wallet, amount, installment: inst }), "Pembayaran tercatat di blockchain.")}
                  onOffchain={(fd) => run("proof", () => api(`/api/notes/${id}/payments`, { method: "POST", body: fd }), "Bukti transfer terkirim. Menunggu konfirmasi kreditur.")}
                />
              )}
              {pending.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-4 rounded-2xl border border-dashed border-butter p-3.5 sm:p-4">
                  <a href={`/api/files/proof/${p.id}`} target="_blank" rel="noreferrer" className="flex h-[96px] w-[80px] items-center justify-center rounded-[10px] bg-line p-2 text-center text-[11px] text-faint underline">{p.proofName ?? "bukti"}</a>
                  <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1.5">
                    <span className="self-start rounded-md bg-butter px-2 py-1 text-[11px] font-semibold text-butter-ink">{role === "creditor" ? "MENUNGGU KONFIRMASIMU" : "MENUNGGU KREDITUR"}</span>
                    <span className="font-medium">Transfer {fmtRp(p.amount)}{p.installment ? ` untuk cicilan ${p.installment}` : ""}</span>
                    <span className="text-[13px] text-muted">Dikirim {fmtDate(p.createdAt, true)}. {role === "creditor" ? "Cek mutasi rekeningmu dulu sebelum konfirmasi." : ""}</span>
                  </div>
                  {role === "creditor" && (
                    <div className="flex w-full flex-wrap gap-2.5 max-sm:[&>*]:flex-1 sm:w-auto">
                      <Button variant="secondary" disabled={!!busy} onClick={() => { const r = ask("Alasan menolak bukti ini:"); if (r) run("rejectpay", () => api(`/api/payments/${p.id}`, { method: "POST", json: { action: "reject", reason: r } }), "Bukti transfer ditolak."); }}>Tolak</Button>
                      <Button disabled={!!busy || n.status !== "ACTIVE" && n.status !== "OVERDUE"} onClick={() => run("confirm", async () => {
                        const t = await api<{ domain: Record<string, unknown>; types: never; message: Record<string, unknown> }>(`/api/payments/${p.id}`);
                        const signature = await signTyped(t, me.wallet);
                        return api(`/api/payments/${p.id}`, { method: "POST", json: { action: "confirm", signature, message: t.message } });
                      }, "Pembayaran dikonfirmasi.")}>{busy === "confirm" && <Spinner />} Konfirmasi &amp; tanda tangan</Button>
                    </div>
                  )}
                </div>
              ))}
              <ul className="flex flex-col">
                {n.payments.filter((p) => p.status !== "PENDING").map((p) => (
                  <li key={p.id} className="flex flex-wrap justify-between gap-3 border-t border-line py-3.5">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="text-sm font-medium">
                        {p.method === "onchain" ? "Stablecoin (on-chain)" : "Transfer bank"}
                        {p.installment ? ` · cicilan ${p.installment}` : ""} · {p.status === "CONFIRMED" ? "tercatat" : "ditolak"}
                      </span>
                      <span className="text-xs text-faint [overflow-wrap:anywhere]">
                        {fmtDate(p.createdAt, true)}
                        {p.txHash && <> · <a href={txUrl(p.txHash) ?? "#"} target="_blank" rel="noreferrer" className="text-lav">tx {short(p.txHash)}</a></>}
                        {p.rejectReason && ` · "${p.rejectReason}"`}
                      </span>
                    </div>
                    <span className={`font-semibold tabular-nums ${p.status === "REJECTED" ? "text-faint line-through" : ""}`}>{fmtRp(p.amount)}</span>
                  </li>
                ))}
                {n.payments.length === 0 && <li className="text-sm text-muted">Belum ada pembayaran.</li>}
              </ul>
            </Card>
          )}
        </div>

        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-5">
          <Card className="flex flex-col gap-3.5">
            <h2 className="font-semibold">Pihak</h2>
            {[["Kreditur", n.creditor], ["Debitur", n.debtor]].map(([label, p]) => {
              const party = p as Detail["note"]["creditor"];
              const w = party?.wallet ?? ((label === "Kreditur") === (n.creatorRole === "creditor") ? null : n.counterpartyWallet);
              return (
                <div key={label as string} className="flex items-center gap-3">
                  <Avatar name={party?.name ?? "?"} seed={w ?? ""} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{party?.name ?? "Belum bergabung"}{w && w.toLowerCase() === me.wallet.toLowerCase() ? " (kamu)" : ""}</span>
                    <span className="text-xs text-faint">{label as string} · {short(w)}</span>
                  </div>
                </div>
              );
            })}
          </Card>

          <Card className="flex flex-col gap-3">
            <h2 className="font-semibold">Bukti digital</h2>
            <p className="text-[13px] leading-relaxed text-muted">Hak tagih tercatat sebagai token non-transferable di wallet kreditur dan di-burn saat lunas.</p>
            <dl className="flex flex-col gap-2.5 text-[13px]">
              <div><dt className="text-faint">ID on-chain</dt><dd className="font-mono [overflow-wrap:anywhere]">{short(n.chainNoteId)}</dd></div>
              {n.docHash && <div><dt className="text-faint">Hash dokumen</dt><dd className="font-mono [overflow-wrap:anywhere]">{short(n.docHash)}</dd></div>}
              {n.escrowTx && <div><dt className="text-faint">Setor escrow</dt><dd><a href={txUrl(n.escrowTx) ?? "#"} target="_blank" rel="noreferrer" className="font-mono text-lav">{short(n.escrowTx)} ↗</a></dd></div>}
              {n.activationTx && <div><dt className="text-faint">Aktivasi</dt><dd><a href={txUrl(n.activationTx) ?? "#"} target="_blank" rel="noreferrer" className="font-mono text-lav">{short(n.activationTx)} ↗</a></dd></div>}
            </dl>
          </Card>

          <Card className="flex flex-col gap-2.5">
            <h2 className="font-semibold">Dokumen</h2>
            {n.documents.length === 0 && <p className="text-sm text-muted">Tidak ada dokumen.</p>}
            {n.documents.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 text-sm">
                <a href={`/api/files/doc/${d.id}`} target="_blank" rel="noreferrer" className="min-w-0 truncate text-white underline decoration-line2">{d.name}</a>
                <span className="flex flex-none items-center gap-2 text-xs text-faint">
                  {Math.ceil(d.size / 1024)} KB
                  {n.status === "DRAFT" && me.isCreator && (
                    <button type="button" aria-label={`Hapus ${d.name}`} className="text-pink" onClick={() => run("deldoc", () => api(`/api/notes/${id}/documents?doc=${d.id}`, { method: "DELETE" }), "Dokumen dihapus.")}>Hapus</button>
                  )}
                </span>
              </div>
            ))}
            {n.status === "DRAFT" && me.isCreator && (
              <label className="mt-1 cursor-pointer text-[13px] font-medium text-lav">
                + Tambah dokumen
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="sr-only" onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const fd = new FormData();
                  fd.append("file", f);
                  run("adddoc", () => api(`/api/notes/${id}/documents`, { method: "POST", body: fd }), "Dokumen ditambahkan.");
                }} />
              </label>
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <h2 className="font-semibold">Riwayat</h2>
            <ol className="flex flex-col gap-3 text-[13px]">
              {n.events.map((e, i) => (
                <li key={i} className="flex gap-2.5">
                  <span aria-hidden className="mt-1.5 h-2.5 w-2.5 flex-none rounded-full bg-lav" />
                  <div className="flex flex-col gap-0.5">
                    <span>{EVENT[e.action] ?? e.action}{e.detail ? ` · ${e.detail}` : ""}</span>
                    <span className="text-xs text-faint">
                      {fmtDate(e.createdAt, true)}
                      {e.txHash && <> · <a href={txUrl(e.txHash) ?? "#"} target="_blank" rel="noreferrer" className="text-lav">tx ↗</a></>}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </div>
  );
}

const EVENT: Record<string, string> = {
  CREATE_DRAFT: "Draft dibuat", EDIT_DRAFT: "Draft diubah", UPLOAD_DOCUMENT: "Dokumen ditambahkan", REMOVE_DOCUMENT: "Dokumen dihapus",
  SEND_FOR_SIGNATURE: "Dikirim untuk tanda tangan", SIGN: "Ditandatangani", DEPOSIT_ESCROW: "Dana disetor ke escrow",
  ACTIVATE_ONCHAIN: "Aktif, escrow cair", ACTIVATE_OFFCHAIN: "Aktif, dana dikonfirmasi debitur", REJECT: "Ditolak", CANCEL: "Dibatalkan",
  REQUEST_REVISION: "Revisi diminta", PAY: "Pembayaran on-chain", UPLOAD_PAYMENT_PROOF: "Bukti transfer dikirim",
  CONFIRM_PAYMENT: "Pembayaran dikonfirmasi", REJECT_PAYMENT: "Bukti transfer ditolak", DISPUTE: "Sengketa diajukan",
  MARKPAID: "Sisa diikhlaskan", REFUND: "Escrow ditarik", CLOSEDISPUTE: "Sengketa ditutup", UNFREEZE: "Pembekuan dibuka",
  INTEGRITY_CHECK: "Cek integritas",
};

function InstallmentPill({ status }: { status: string }) {
  const cls = status === "Lunas" ? "bg-lav text-lav-ink" : status === "Terlambat" ? "bg-rasp text-white" : status === "Sebagian" ? "bg-butter text-butter-ink" : "bg-line text-soft";
  return <span className={`whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-semibold ${cls}`}>{status}</span>;
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-brand-tint">{k}</dt>
      <dd className="mt-1 text-[15px] font-semibold [overflow-wrap:anywhere]">{v}</dd>
    </div>
  );
}

function SignState({ label, who, done, extra }: { label: string; who: string; done: boolean; extra?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-midnight p-3.5">
      <span aria-hidden className={`h-3 w-3 flex-none rounded-full ${done ? "bg-mint" : "border-2 border-[#4a4d5c]"}`} />
      <div className="flex min-w-0 flex-col">
        <span className="font-medium">{label}: {who}</span>
        <span className="text-xs text-faint">{done ? "Sudah tanda tangan" : "Belum tanda tangan"}{extra ? ` · ${extra}` : ""}</span>
      </div>
    </div>
  );
}

function PayBox(props: {
  disabled: boolean;
  allowOffchain: boolean;
  suggested: bigint;
  remaining: bigint;
  installment: number;
  onOnchain: (amountUnits: string, installment: number) => void;
  onOffchain: (fd: FormData) => void;
}) {
  const [method, setMethod] = useState<"onchain" | "offchain">("onchain");
  const [amount, setAmount] = useState(unitsToRupiah(props.suggested > BigInt(0) ? props.suggested : props.remaining).toString());
  const [file, setFile] = useState<File | null>(null);
  const units = (() => { try { return BigInt(rupiahToUnits(amount)); } catch { return BigInt(0); } })();
  return (
    <div className="flex flex-col gap-3.5 rounded-2xl bg-midnight p-3.5 sm:p-4">
      <div role="group" aria-label="Cara bayar" className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {(["onchain", "offchain"] as const).filter((m) => m === "onchain" || props.allowOffchain).map((m) => (
          <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)} className={`min-h-11 rounded-2xl border px-4 py-2 text-left text-[13px] sm:min-h-10 sm:rounded-full sm:py-0 sm:text-center ${method === m ? "border-brand bg-brand font-medium" : "border-line2 text-soft"}`}>
            {m === "onchain" ? "Bayar dengan IDRX (langsung tercatat)" : "Sudah transfer bank (upload bukti)"}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-[1_1_200px]">
          <Field label="Nominal (Rp)" htmlFor="bayar" hint={`Sisa utang ${fmtRp(props.remaining)}. Kelebihan bayar on-chain otomatis dipotong.`}>
            <input id="bayar" inputMode="numeric" value={Number(amount || 0).toLocaleString("id-ID")} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} className={`${input} tabular-nums`} />
          </Field>
        </div>
        {method === "offchain" && (
          <div className="min-w-0 flex-[1_1_200px]">
            <Field label="Bukti transfer" htmlFor="bukti" hint="PDF/JPG/PNG maks 10 MB">
              <input id="bukti" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-soft file:mr-3 file:rounded-full file:border-0 file:bg-brand-soft file:px-4 file:py-2 file:text-lav" />
            </Field>
          </div>
        )}
        <Button
          disabled={props.disabled || units <= BigInt(0) || (method === "offchain" && (!file || units > props.remaining))}
          onClick={() => {
            if (method === "onchain") return props.onOnchain(units.toString(), props.installment);
            const fd = new FormData();
            fd.append("amount", amount);
            fd.append("installment", String(props.installment));
            fd.append("proof", file!);
            props.onOffchain(fd);
          }}
        >
          {method === "onchain" ? "Bayar sekarang" : "Kirim bukti"}
        </Button>
      </div>
      <p className="text-xs text-faint">{method === "onchain" ? "Kamu menandatangani 2 pesan (izin IDRX + perintah bayar). Tanpa gas." : "Pembayaran tercatat setelah kreditur mengonfirmasi bukti."}</p>
    </div>
  );
}
