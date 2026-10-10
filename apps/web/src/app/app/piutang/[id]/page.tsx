"use client";
import Link from "next/link";
import { use, useState } from "react";
import { keccak256, toUtf8Bytes } from "ethers";
import { Avatar, Button, Card, LinkButton, Notice, Spinner, StatusPill, fmtDate } from "@/components/ui";
import { api, forwardAction, payOnchain, short, signTyped } from "@/lib/client";
import { useApi } from "@/lib/hooks";
import { fmtRp } from "@/lib/money";
import { feeFor, feeLabel } from "@/lib/appFee";
import { amountDue, type AmountDue } from "@/lib/amountDue";
import { txUrl } from "@/lib/chain/config";
import { splitSig } from "@/lib/chain/eip712";
import RevisionModal from "./RevisionModal";
import { useConfirm } from "@/components/Dialog";
import { NoteDetailSkeleton } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";

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
  appFee: { bps: number; spender: string; wallet: string } | null;
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
  const [reviseOpen, setReviseOpen] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const toast = useToast();

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <NoteDetailSkeleton />;
  const { note: n, me, chain } = data;
  const role = me.role;
  const isLive = LIVE.includes(n.status);

  /** Jalankan aksi dengan status sibuk + pesan hasil. Mengembalikan pesan error, atau null bila berhasil. */
  async function run(key: string, fn: () => Promise<{ txHash?: string } | unknown>, okText: string): Promise<string | null> {
    setBusy(key);
    setMsg({ tone: "info", text: "Memproses… konfirmasi di MetaMask bila diminta, lalu tunggu transaksi masuk blok (±15 detik)." });
    try {
      const r = (await fn()) as { txHash?: string } | undefined;
      // Berhasil: pesan "Memproses…" hilang, hasilnya muncul sebagai toast di kanan atas.
      setMsg(null);
      const tx = r?.txHash ? txUrl(r.txHash) : null;
      toast.success(okText, tx ? { link: { href: tx, label: "Lihat transaksi ↗", external: true } } : undefined);
      await refresh();
      return null;
    } catch (e) {
      const err = e as { code?: string | number; message: string };
      const cancelled = err.code === 4001 || err.code === "ACTION_REJECTED";
      const text = cancelled ? "Dibatalkan di MetaMask." : err.message;
      setMsg(null);
      // Aksi dari modal: error ditampilkan di dalam modal (modal menutupi toast), jadi toast tidak perlu.
      if (!document.querySelector("dialog[open]")) {
        if (cancelled) toast.info("Dibatalkan di MetaMask", { description: "Tidak ada yang diubah." });
        else toast.error("Gagal memproses", { description: text });
      }
      return text;
    } finally {
      setBusy(null);
    }
  }

  const action = (body: Record<string, unknown>) => api(`/api/notes/${id}/action`, { method: "POST", json: body });

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
  // Tagihan yang boleh dibayar sekarang (nominal dikunci; server memeriksa ulang angka yang sama).
  const due = chain
    ? amountDue({ installments: n.installments.map((i) => BigInt(i.amount)), scheduledPaid, overdue: BigInt(chain.overdue), lateFee: BigInt(chain.lateFee), lateFeeBps: n.lateFeeBps })
    : null;
  const remaining = chain ? BigInt(chain.remaining) : BigInt(n.totalOwed);
  const paidTotal = BigInt(chain?.paid ?? "0");
  const pct = n.status === "PAID" ? 100 : Number((scheduledPaid * BigInt(100)) / BigInt(n.totalOwed));
  const pending = n.payments.filter((p) => p.status === "PENDING");
  // Permintaan revisi terakhir (riwayat terbaru di depan) untuk memberi tahu bahwa versi ini hasil revisi.
  const lastRevision = n.version > 1 ? n.events.find((e) => e.action === "REQUEST_REVISION") ?? null : null;

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
              <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold tracking-wide ${n.integrity === "VERIFIED" ? "bg-raised text-cyan" : "bg-rasp text-white"}`}>{n.integrity}{n.integrityAt ? ` · ${fmtDate(n.integrityAt, true)}` : ""}</span>
            )}
            <span className="rounded-md bg-raised px-2.5 py-1 text-[11px] font-medium text-soft">{TYPES[n.debtType]} · versi {n.version}</span>
          </div>
          <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.035em] [overflow-wrap:anywhere] sm:text-[34px]">{n.title}</h1>
          <span className="text-sm leading-relaxed text-muted">
            Kamu <strong className="font-semibold text-ink">{role === "creditor" ? "kreditur" : role === "debtor" ? "debitur" : "pengamat"}</strong>
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
            <Button variant="secondary" disabled={!!busy} aria-haspopup="dialog" onClick={() => confirm({
              title: "Ikhlaskan sisa utang?",
              description: <>Sisa <strong className="text-ink">{fmtRp(remaining)}</strong> tidak akan ditagih lagi. Piutang langsung ditandai lunas di blockchain dan <strong className="text-ink">tidak bisa dibatalkan</strong>.</>,
              confirmText: "Ya, ikhlaskan",
              tone: "danger",
              action: () => run("waive", () => forwardAction({ noteId: id, wallet: me.wallet, fn: "markPaid", args: [n.chainNoteId], purpose: "markPaid" }), "Piutang ditandai lunas."),
            })}>Ikhlaskan sisa</Button>
          )}
          {["ACTIVE", "OVERDUE"].includes(n.status) && role && (
            <Button variant="danger" disabled={!!busy} aria-haspopup="dialog" onClick={() => confirm({
              title: "Ajukan sengketa",
              description: "Admin akan meninjau sengketa ini. Hash alasanmu dicatat di blockchain, jadi tulis dengan jelas dan jujur.",
              field: { label: "Alasan sengketa", placeholder: "Contoh: pembayaran cicilan 2 sudah saya transfer tanggal 5 tapi belum dikonfirmasi.", minLength: 10, hint: "Minimal 10 huruf." },
              confirmText: "Ajukan sengketa",
              tone: "danger",
              action: (reason) => run("dispute", () => forwardAction({ noteId: id, wallet: me.wallet, fn: "openDispute", args: [n.chainNoteId, keccak256(toUtf8Bytes(reason))], purpose: "dispute", reason }), "Sengketa diajukan. Admin akan meninjau."),
            })}>Ajukan sengketa</Button>
          )}
          {me.isAdmin && n.status === "DISPUTED" && (
            <Button variant="secondary" disabled={!!busy} aria-haspopup="dialog" onClick={() => confirm({
              title: "Tutup sengketa",
              description: "Ringkasan keputusan dikirim ke kedua pihak dan hash-nya dicatat di blockchain.",
              field: { label: "Ringkasan keputusan admin", placeholder: "Contoh: bukti transfer valid, cicilan 2 dianggap lunas." },
              confirmText: "Tutup sengketa",
              action: (r) => run("close", () => forwardAction({ noteId: id, wallet: me.wallet, fn: "closeDispute", args: [n.chainNoteId, keccak256(toUtf8Bytes(r))], purpose: "closeDispute" }), "Sengketa ditutup."),
            })}>Tutup sengketa (admin)</Button>
          )}
          {me.isAdmin && n.status === "FROZEN" && (
            <Button variant="secondary" disabled={!!busy} aria-haspopup="dialog" onClick={() => confirm({
              title: "Buka pembekuan",
              description: "Pastikan data sudah dipulihkan. Catatan ini dicatat di blockchain.",
              field: { label: "Catatan pemulihan data", placeholder: "Contoh: dokumen dipulihkan dari cadangan, hash cocok lagi." },
              confirmText: "Buka pembekuan",
              action: (r) => run("unfreeze", () => forwardAction({ noteId: id, wallet: me.wallet, fn: "unfreeze", args: [n.chainNoteId, keccak256(toUtf8Bytes(r))], purpose: "unfreeze" }), "Pembekuan dibuka."),
            })}>Buka pembekuan (admin)</Button>
          )}
        </div>
      </header>

      {confirmDialog}

      {msg && (
        <Notice tone={msg.tone}>
          {msg.text}{" "}
          {msg.tx && txUrl(msg.tx) && <a href={txUrl(msg.tx)!} target="_blank" rel="noreferrer" className="underline">Lihat transaksi ↗</a>}
        </Notice>
      )}

      {/* ---------------- banner aksi per status ---------------- */}
      {n.status === "DRAFT" && (
        <Card className="flex flex-col gap-3 border-line2">
          {n.revisionNote && (
            <Notice tone="warn">
              {me.isCreator
                ? <><strong className="font-semibold">{data.other?.name ?? "Pihak lawan"} minta revisi:</strong> “{n.revisionNote}”. Ubah draft lalu kirim ulang sebagai versi {n.version}.</>
                : <>Kamu minta revisi: “{n.revisionNote}”. Menunggu pembuat mengirim versi {n.version}.</>}
            </Notice>
          )}
          {me.isCreator ? (
            <>
              <h2 className="text-lg font-bold">Draft versi {n.version} belum dikirim</h2>
              <p className="text-sm text-muted">Periksa isi, jadwal, dan dokumen. Setelah dikirim, {n.counterpartyWallet ? short(n.counterpartyWallet) : "pihak lawan"} bisa menandatangani, minta revisi, atau menolak.</p>
              {!me.phoneVerified && <Notice tone="warn">Verifikasi nomor HP dulu di <Link href="/app/profil" className="underline">Profil</Link>.</Notice>}
              <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
                <Button disabled={!!busy || !me.phoneVerified} onClick={() => run("send", () => action({ action: "send" }), "Terkirim. Sekarang tanda tangani dari halaman ini.")}>
                  {busy === "send" && <Spinner />} Kirim untuk tanda tangan
                </Button>
                <LinkButton href={`/app/piutang/${id}/ubah`} variant="secondary">Ubah draft</LinkButton>
                <Button variant="danger" disabled={!!busy} aria-haspopup="dialog" onClick={() => confirm({
                  title: "Batalkan draft?",
                  description: "Draft ini ditutup permanen dan tidak bisa dikirim lagi. Kamu perlu membuat surat baru kalau berubah pikiran.",
                  confirmText: "Ya, batalkan draft",
                  cancelText: "Jangan",
                  tone: "danger",
                  action: () => run("cancel", () => action({ action: "cancel" }), "Draft dibatalkan."),
                })}>Batalkan</Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">Pembuat sedang menyiapkan versi {n.version}. Kamu akan diberi tahu lewat chat saat siap ditandatangani.</p>
          )}
        </Card>
      )}

      {n.status === "PENDING_SIGNATURE" && (
        <Card className="flex flex-col gap-4 border-peach/50">
          <h2 className="text-lg font-bold">Menunggu tanda tangan · versi {n.version}</h2>
          {lastRevision && (
            <Notice tone="ok">
              {me.isCreator
                ? <>Versi {n.version} hasil revisi sudah dikirim. Permintaan revisi: “{lastRevision.detail}”</>
                : <>Versi {n.version} sudah direvisi sesuai permintaan: “{lastRevision.detail}”. Cek lagi isi, jadwal, dan dokumen sebelum tanda tangan.</>}
            </Notice>
          )}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3 text-sm">
            <SignState label="Kreditur" who={n.creditor?.name ?? short(n.counterpartyWallet)} done={n.creditorSigned} extra={n.disbursement === "onchain" ? (n.escrowIsCurrent ? "Dana sudah di escrow" : "Setor escrow saat tanda tangan") : undefined} />
            <SignState label="Debitur" who={n.debtor?.name ?? short(n.counterpartyWallet)} done={n.debtorSigned} />
          </div>
          {role && !(role === "creditor" ? n.creditorSigned : n.debtorSigned) && (
            <>
              <p className="text-sm text-muted">
                Kamu akan menandatangani pesan berisi seluruh isi perjanjian (gratis, tanpa gas).
                {role === "creditor" && n.disbursement === "onchain" && <> Sebagai kreditur kamu juga menandatangani <strong className="text-ink">izin setor {fmtRp(n.principal)} ke escrow</strong>; dana baru cair ke debitur setelah dia ikut tanda tangan, dan bisa kamu tarik kapan saja sebelum itu.</>}
              </p>
              {!me.phoneVerified && <Notice tone="warn">Verifikasi nomor HP dulu di <Link href="/app/profil" className="underline">Profil</Link>.</Notice>}
              <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
                <Button disabled={!!busy || !me.phoneVerified} onClick={() => run("sign", signNote, "Tanda tangan tersimpan.")}>
                  {busy === "sign" && <Spinner />} Setuju &amp; tanda tangan
                </Button>
                {!me.isCreator && (
                  <>
                    <Button variant="secondary" disabled={!!busy} aria-haspopup="dialog" onClick={() => setReviseOpen(true)}>Minta revisi</Button>
                    <Button variant="danger" disabled={!!busy} aria-haspopup="dialog" onClick={() => confirm({
                      title: "Tolak surat ini?",
                      description: <>Penolakan bersifat <strong className="text-ink">final</strong>: surat ditutup dan tidak bisa direvisi. Kalau hanya ada yang perlu diubah, pakai <strong className="text-ink">Minta revisi</strong>.</>,
                      field: { label: "Alasan penolakan", placeholder: "Contoh: saya tidak pernah meminjam uang ini.", minLength: 5, hint: "Wajib, minimal 5 huruf. Dikirim ke pembuat surat." },
                      confirmText: "Tolak surat",
                      tone: "danger",
                      action: (r) => run("reject", () => action({ action: "reject", reason: r }), "Surat ditolak."),
                    })}>Tolak</Button>
                  </>
                )}
              </div>
            </>
          )}
          {!me.isCreator && role && (
            <RevisionModal
              open={reviseOpen}
              version={n.version}
              onClose={() => setReviseOpen(false)}
              onSubmit={(reason) => run("revise", () => action({ action: "revise", reason }), "Permintaan revisi terkirim. Surat kembali ke draft untuk diperbaiki pembuat.")}
            />
          )}
          {me.isCreator && (
            <div><Button variant="danger" disabled={!!busy} aria-haspopup="dialog" onClick={() => confirm({
              title: "Batalkan surat ini?",
              description: `Permintaan tanda tangan ditarik dan surat ditutup permanen.${n.disbursement === "onchain" && n.escrowTerms ? " Dana escrow bisa ditarik kreditur setelahnya." : ""}`,
              confirmText: "Ya, batalkan surat",
              cancelText: "Jangan",
              tone: "danger",
              action: () => run("cancel", () => action({ action: "cancel" }), "Surat dibatalkan."),
            })}>Batalkan surat</Button></div>
          )}
        </Card>
      )}

      {n.status === "AWAITING_DISBURSEMENT" && (
        <Card className="flex flex-col gap-3 border-butter/50">
          <h2 className="text-lg font-bold">Menunggu pencairan {fmtRp(n.principal)}</h2>
          {role === "debtor" ? (
            <>
              <p className="text-sm text-muted">Kedua pihak sudah tanda tangan. Setelah kreditur mentransfer pokok, konfirmasi di sini. Bukti digital baru terbit setelah kamu konfirmasi.</p>
              <div><Button disabled={!!busy} onClick={() => run("receipt", signReceipt, "Dana dikonfirmasi. Piutang aktif.")}>{busy === "receipt" && <Spinner />} Dana sudah saya terima</Button></div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">Transfer {fmtRp(n.principal)} ke debitur lewat bank atau tunai, lalu minta debitur mengonfirmasi di aplikasi.</p>
              {role === "creditor" && <div><Button variant="danger" disabled={!!busy} aria-haspopup="dialog" onClick={() => confirm({
                title: "Batalkan sebelum dana dicairkan?",
                description: <>Surat ditutup permanen. Lakukan ini hanya kalau kamu <strong className="text-ink">belum mentransfer</strong> {fmtRp(n.principal)} ke debitur.</>,
                confirmText: "Ya, batalkan",
                cancelText: "Jangan",
                tone: "danger",
                action: () => run("cancel", () => action({ action: "cancel" }), "Surat dibatalkan."),
              })}>Batalkan</Button></div>}
            </>
          )}
        </Card>
      )}

      {(n.status === "REJECTED" || n.status === "CANCELLED") && (
        <Card className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">{n.status === "REJECTED" ? "Surat ditolak" : "Surat dibatalkan"}</h2>
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
                <span className="text-[13px] text-brand-tint">{chain ? "Sisa utang (termasuk bunga keterlambatan)" : "Total yang harus dibayar"}</span>
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
              <Stat k="Bunga keterlambatan" v={n.lateFeeBps ? "2% per bulan" : "Tanpa bunga"} />
              <Stat k="Pencairan" v={n.disbursement === "onchain" ? "Escrow stablecoin" : "Transfer sendiri"} />
              {chain && BigInt(chain.lateFee) > BigInt(0) && <Stat k="Bunga belum dibayar" v={fmtRp(chain.lateFee)} />}
              {chain && BigInt(chain.overdue) > BigInt(0) && <Stat k="Tunggakan" v={fmtRp(chain.overdue)} />}
            </dl>
            {n.collateralNote && <p className="text-[13px] text-brand-tint">Jaminan: {n.collateralNote}</p>}
          </section>

          <Card className="flex flex-col gap-3.5">
            <h2 className="text-lg font-bold">Jadwal cicilan</h2>
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
              <h2 className="text-lg font-bold">Pembayaran</h2>
              {role === "debtor" && ["ACTIVE", "OVERDUE", "DISPUTED"].includes(n.status) && remaining > BigInt(0) && due && due.kind !== "none" && (
                <PayBox
                  disabled={!!busy}
                  loading={busy === "pay"}
                  due={due}
                  overdue={BigInt(chain?.overdue ?? "0")}
                  lateFee={BigInt(chain?.lateFee ?? "0")}
                  remaining={remaining}
                  total={n.installments.length}
                  appFeeBps={data.appFee?.bps ?? 0}
                  onPay={(amount, inst) => run("pay", () => payOnchain({ noteId: id, chainNoteId: n.chainNoteId, wallet: me.wallet, amount, installment: inst, appFee: data.appFee }), data.appFee ? `Pembayaran tercatat di blockchain. Fee aplikasi ${feeLabel(data.appFee.bps)} sudah dipotong.` : "Pembayaran tercatat di blockchain.")}
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
                      <Button variant="secondary" disabled={!!busy} aria-haspopup="dialog" onClick={() => confirm({
                        title: "Tolak bukti transfer?",
                        description: `Bukti transfer ${fmtRp(p.amount)} ditandai ditolak dan debitur diberi tahu lewat chat.`,
                        field: { label: "Alasan menolak", placeholder: "Contoh: dana belum masuk ke rekening BCA saya per hari ini." },
                        confirmText: "Tolak bukti",
                        tone: "danger",
                        action: (r) => run("rejectpay", () => api(`/api/payments/${p.id}`, { method: "POST", json: { action: "reject", reason: r } }), "Bukti transfer ditolak."),
                      })}>Tolak</Button>
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
                {n.payments.length === 0 && <li className="rounded-xl border border-dashed border-line2 px-4 py-5 text-center text-sm text-muted">Belum ada pembayaran.</li>}
              </ul>
            </Card>
          )}
        </div>

        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-5">
          <Card className="flex flex-col gap-3.5">
            <h2 className="font-bold">Pihak</h2>
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
            <h2 className="font-bold">Bukti digital</h2>
            <p className="text-[13px] leading-relaxed text-muted">Hak tagih tercatat sebagai token non-transferable di wallet kreditur dan di-burn saat lunas.</p>
            <dl className="flex flex-col gap-2.5 text-[13px]">
              <div><dt className="text-faint">ID on-chain</dt><dd className="font-mono [overflow-wrap:anywhere]">{short(n.chainNoteId)}</dd></div>
              {n.docHash && <div><dt className="text-faint">Hash dokumen</dt><dd className="font-mono [overflow-wrap:anywhere]">{short(n.docHash)}</dd></div>}
              {n.escrowTx && <div><dt className="text-faint">Setor escrow</dt><dd><a href={txUrl(n.escrowTx) ?? "#"} target="_blank" rel="noreferrer" className="font-mono text-lav">{short(n.escrowTx)} ↗</a></dd></div>}
              {n.activationTx && <div><dt className="text-faint">Aktivasi</dt><dd><a href={txUrl(n.activationTx) ?? "#"} target="_blank" rel="noreferrer" className="font-mono text-lav">{short(n.activationTx)} ↗</a></dd></div>}
            </dl>
          </Card>

          <Card className="flex flex-col gap-2.5">
            <h2 className="font-bold">Dokumen</h2>
            {n.documents.length === 0 && <p className="text-sm text-muted">Tidak ada dokumen.</p>}
            {n.documents.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 text-sm">
                <a href={`/api/files/doc/${d.id}`} target="_blank" rel="noreferrer" className="min-w-0 truncate text-ink underline decoration-line2">{d.name}</a>
                <span className="flex flex-none items-center gap-2 text-xs text-faint">
                  {Math.ceil(d.size / 1024)} KB
                  {n.status === "DRAFT" && me.isCreator && (
                    <button type="button" aria-label={`Hapus ${d.name}`} aria-haspopup="dialog" className="text-pink" onClick={() => confirm({
                      title: "Hapus dokumen?",
                      description: <>“{d.name}” dihapus dari draft ini.</>,
                      confirmText: "Hapus dokumen",
                      tone: "danger",
                      action: () => run("deldoc", () => api(`/api/notes/${id}/documents?doc=${d.id}`, { method: "DELETE" }), "Dokumen dihapus."),
                    })}>Hapus</button>
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
            <h2 className="font-bold">Riwayat</h2>
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
  INTEGRITY_CHECK: "Cek integritas", APP_FEE: "Fee aplikasi dibayar", APP_FEE_FAILED: "Fee aplikasi gagal ditarik",
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
      <span aria-hidden className={`h-3 w-3 flex-none rounded-full ${done ? "bg-mint" : "border-2 border-line2"}`} />
      <div className="flex min-w-0 flex-col">
        <span className="font-medium">{label}: {who}</span>
        <span className="text-xs text-faint">{done ? "Sudah tanda tangan" : "Belum tanda tangan"}{extra ? ` · ${extra}` : ""}</span>
      </div>
    </div>
  );
}

function PayBox(props: {
  disabled: boolean;
  /** Pembayaran dari kotak ini sedang diproses. */
  loading: boolean;
  appFeeBps: number;
  due: AmountDue;
  overdue: bigint;
  lateFee: bigint;
  remaining: bigint;
  /** Jumlah cicilan di jadwal. */
  total: number;
  onPay: (amountUnits: string, installment: number) => void;
}) {
  const { due } = props;
  const late = due.kind === "overdue";
  // Kontrak tidak menarik lebih dari sisa utang; fee aplikasi dihitung dari yang benar-benar terbayar.
  const payUnits = due.amount > props.remaining && !late ? props.remaining : due.amount;
  const fee = feeFor(payUnits, props.appFeeBps);
  const hasNext = due.seq < props.total;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-midnight">
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <span className="text-[13px] text-soft">{late ? "Tagihan tertunggak" : `Tagihan cicilan ke-${due.seq} dari ${props.total}`}</span>
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${late ? "bg-rasp text-white" : "bg-line text-soft"}`}>{late ? "Lewat jatuh tempo" : "Bisa dibayar lebih awal"}</span>
        </div>
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[28px] font-semibold leading-tight tabular-nums">{fmtRp(payUnits)}</span>
          <span className="flex-none text-xs text-faint">IDRX</span>
        </div>
        {late ? (
          <dl className="flex flex-col gap-1.5 rounded-xl border border-line px-3.5 py-3 text-[13px] tabular-nums">
            <div className="flex justify-between gap-4"><dt className="text-muted">Cicilan tertunggak</dt><dd>{fmtRp(props.overdue)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Bunga keterlambatan berjalan</dt><dd>{fmtRp(props.lateFee)}</dd></div>
            {due.buffer > BigInt(0) && (
              <div className="flex justify-between gap-4"><dt className="text-muted">Penyangga bunga 10 menit</dt><dd>{fmtRp(due.buffer)}</dd></div>
            )}
          </dl>
        ) : null}
        <p className="text-xs leading-relaxed text-faint">
          {late
            ? "Bunga keterlambatan terus bertambah setiap hari sampai tunggakan dibayar atau diikhlaskan kreditur. Penyangga dipakai karena bunga dihitung per detik; yang tidak terpakai otomatis masuk ke cicilan berikutnya."
            : `Nominal mengikuti jadwal dan tidak bisa diubah. Tanggal jatuh tempo hanya patokan: kamu boleh bayar sekarang${hasNext ? `, lalu cicilan ke-${due.seq + 1} langsung bisa dibayar kalau mampu` : ""}. Lewat jatuh tempo dikenai bunga keterlambatan.`}
        </p>
      </div>

      <div className="flex flex-col gap-4 border-t border-line bg-card p-4 sm:p-5">
        <dl className="flex flex-col gap-2 text-sm tabular-nums">
          <div className="flex justify-between gap-4"><dt className="text-muted">Pembayaran ke kreditur</dt><dd>{fmtRp(payUnits)}</dd></div>
          {fee > BigInt(0) && (
            <div className="flex justify-between gap-4"><dt className="text-muted">Fee aplikasi {feeLabel(props.appFeeBps)}</dt><dd>{fmtRp(fee)}</dd></div>
          )}
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-t border-dashed border-line2 pt-3">
            <dt className="font-medium">Total dipotong dari saldo IDRX</dt>
            <dd className="text-lg font-semibold">{fmtRp(payUnits + fee)}</dd>
          </div>
        </dl>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex gap-2 text-xs leading-relaxed text-faint sm:max-w-[60%]">
            <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mt-0.5 flex-none"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
            <span>
              {fee > BigInt(0)
                ? `Kamu menandatangani 3 pesan: izin IDRX, izin fee aplikasi ${feeLabel(props.appFeeBps)}, dan perintah bayar. Tanpa biaya gas.`
                : "Kamu menandatangani 2 pesan: izin IDRX dan perintah bayar. Tanpa biaya gas."}
            </span>
          </p>
          <Button disabled={props.disabled} aria-busy={props.loading} onClick={() => props.onPay(due.amount.toString(), due.seq)} className="w-full flex-none sm:w-auto sm:min-w-[180px] disabled:aria-busy:opacity-80">
            {props.loading ? <><Spinner /> Memproses pembayaran…</> : late ? "Bayar tunggakan" : `Bayar cicilan ke-${due.seq}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
