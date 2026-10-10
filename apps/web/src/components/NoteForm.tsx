"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { isAddress } from "ethers";
import { Button, Field, Spinner, input } from "./ui";
import { api } from "@/lib/client";
import { fmtRpWhole } from "@/lib/money";
import { useToast } from "./Toast";

export type NoteFormValues = {
  role: "creditor" | "debtor";
  title: string;
  debtType: "personal" | "business" | "invoice" | "other";
  principal: string;
  interestType: "none" | "percent" | "flat";
  interestValue: string;
  installmentCount: number;
  firstDue: string;
  lateFee: boolean;
  disbursement: "onchain" | "offchain";
  collateralNote: string;
  counterpartyWallet: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export function defaultValues(): NoteFormValues {
  const d = new Date(Date.now() + 30 * 86400_000);
  return {
    role: "creditor",
    title: "",
    debtType: "personal",
    principal: "",
    interestType: "none",
    interestValue: "0",
    installmentCount: 4,
    firstDue: d.toISOString().slice(0, 10),
    lateFee: true,
    disbursement: "onchain",
    collateralNote: "",
    counterpartyWallet: "",
  };
}

export default function NoteForm({ initial, noteId }: { initial?: NoteFormValues; noteId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState<NoteFormValues>(() => initial ?? defaultValues());
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof NoteFormValues>(k: K, val: NoteFormValues[K]) => setV((p) => ({ ...p, [k]: val }));

  const principal = BigInt(v.principal.replace(/\D/g, "") || "0");
  const total = useMemo(() => {
    if (v.interestType === "percent") return principal + (principal * BigInt(Math.round(Number(v.interestValue || 0) * 100))) / BigInt(10000);
    if (v.interestType === "flat") return principal + BigInt(v.interestValue.replace(/\D/g, "") || "0");
    return principal;
  }, [principal, v.interestType, v.interestValue]);
  const schedule = useMemo(() => {
    const n = v.installmentCount;
    const base = total / BigInt(n);
    const first = new Date(v.firstDue + "T00:00:00Z");
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, first.getUTCDate()));
      return { label: `Cicilan ${i + 1}`, due: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, amount: i === n - 1 ? total - base * BigInt(n - 1) : base };
    });
  }, [total, v.installmentCount, v.firstDue]);

  const walletOk = isAddress(v.counterpartyWallet.trim());
  // Saat mengubah draft, wallet pihak lawan sudah terkunci (server juga menolak perubahan).
  const walletLocked = !!noteId && !!initial?.counterpartyWallet;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!walletOk) {
      toast.error("Alamat wallet tidak valid", { description: "Isi alamat wallet pihak lawan dengan format 0x… (42 karakter)." });
      document.getElementById("wallet")?.focus();
      return;
    }
    setBusy(true);
    try {
      const body = { ...v, principal: v.principal.replace(/\D/g, ""), interestValue: v.interestType === "flat" ? v.interestValue.replace(/\D/g, "") || "0" : v.interestValue || "0", counterpartyWallet: v.counterpartyWallet.trim() };
      const id = noteId
        ? (await api<{ id: string }>(`/api/notes/${noteId}`, { method: "PATCH", json: body })).id
        : (await api<{ id: string }>("/api/notes", { method: "POST", json: body })).id;
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        await api(`/api/notes/${id}/documents`, { method: "POST", body: fd });
      }
      toast.success(noteId ? "Perubahan draft disimpan" : "Draft berhasil disimpan", {
        description: files.length
          ? `${files.length} dokumen ikut diunggah. Cek lagi lalu kirim untuk tanda tangan.`
          : "Cek lagi isinya, lalu kirim untuk tanda tangan.",
      });
      router.push(`/app/piutang/${id}`);
      router.refresh();
    } catch (err) {
      toast.error(noteId ? "Perubahan draft gagal disimpan" : "Draft gagal disimpan", { description: (err as Error).message });
      setBusy(false);
    }
  }

  // <legend> bawaan browser digambar menumpang di garis border atas kartu; float + w-full menjadikannya judul di dalam kartu.
  const legend = "float-left col-span-full w-full p-0 text-base font-semibold";
  const card = (on: boolean) => `flex flex-col items-start gap-1.5 rounded-2xl border-[1.5px] p-4 text-left ${on ? "border-brand bg-brand-soft" : "border-line2 bg-midnight"}`;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:items-start xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-5">
        {!noteId && (
          <fieldset className="flex flex-col gap-4 rounded-[20px] border border-line bg-card p-4 sm:p-5">
            <legend className={legend}>Peranmu</legend>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
              {([["creditor", "Saya kreditur", "Saya meminjamkan uang atau punya tagihan."], ["debtor", "Saya debitur", "Saya mengajukan utang ke pihak lain."]] as const).map(([k, t, b]) => (
                <button key={k} type="button" aria-pressed={v.role === k} onClick={() => set("role", k)} className={card(v.role === k)}>
                  <span className="font-semibold">{t}</span>
                  <span className="text-[13px] text-soft">{b}</span>
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-4 rounded-[20px] border border-line bg-card p-4 sm:p-5">
          <legend className={legend}>Isi perjanjian</legend>
          <div className="col-span-full">
            <Field label="Judul" htmlFor="judul">
              <input id="judul" required value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="Mis. Pinjaman renovasi warung" className={input} />
            </Field>
          </div>
          <Field label="Jenis utang" htmlFor="jenis">
            <select id="jenis" value={v.debtType} onChange={(e) => set("debtType", e.target.value as NoteFormValues["debtType"])} className={input}>
              <option value="personal">Pinjaman pribadi</option>
              <option value="business">Bisnis</option>
              <option value="invoice">Invoice</option>
              <option value="other">Lainnya</option>
            </select>
          </Field>
          <Field label="Nominal pokok (Rp)" htmlFor="pokok">
            <input id="pokok" required inputMode="numeric" value={v.principal ? Number(v.principal.replace(/\D/g, "")).toLocaleString("id-ID") : ""} onChange={(e) => set("principal", e.target.value.replace(/\D/g, "").slice(0, 13))} placeholder="5.000.000" className={`${input} tabular-nums`} />
          </Field>
          <Field label="Bunga / fee" htmlFor="bunga">
            <select id="bunga" value={v.interestType} onChange={(e) => set("interestType", e.target.value as NoteFormValues["interestType"])} className={input}>
              <option value="none">Tanpa bunga</option>
              <option value="percent">Persen dari pokok</option>
              <option value="flat">Nominal tetap (Rp)</option>
            </select>
          </Field>
          {v.interestType !== "none" && (
            <Field label={v.interestType === "percent" ? "Bunga (%)" : "Fee (Rp)"} htmlFor="nilai-bunga">
              <input id="nilai-bunga" inputMode="decimal" value={v.interestValue} onChange={(e) => set("interestValue", e.target.value.replace(v.interestType === "percent" ? /[^\d.]/g : /\D/g, ""))} className={input} />
            </Field>
          )}
          <Field label="Jatuh tempo cicilan pertama" htmlFor="mulai">
            <input id="mulai" type="date" required value={v.firstDue} min={new Date(Date.now() + 86400_000).toISOString().slice(0, 10)} onChange={(e) => set("firstDue", e.target.value)} className={input} />
          </Field>
          <div className="col-span-full flex flex-col gap-2">
            <span id="label-cicilan" className="text-[13px] text-soft">Jumlah cicilan (bulanan)</span>
            <div role="group" aria-labelledby="label-cicilan" className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 6, 12].map((n) => (
                <button key={n} type="button" aria-pressed={v.installmentCount === n} onClick={() => set("installmentCount", n)} className={`min-h-11 min-w-14 flex-[1_1_auto] rounded-xl border px-4 text-sm sm:flex-none ${v.installmentCount === n ? "border-brand bg-brand font-semibold" : "border-line2 bg-midnight text-soft"}`}>
                  {n === 1 ? "Sekali lunas" : `${n}x`}
                </button>
              ))}
            </div>
          </div>
          <label className="col-span-full flex cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" checked={v.lateFee} onChange={(e) => set("lateFee", e.target.checked)} className="mt-0.5 h-5 w-5 accent-brand" />
            <span>Berlakukan denda terlambat <strong className="font-semibold">2% per bulan</strong> dari cicilan yang terlambat<br /><span className="text-[13px] text-faint">Dihitung kontrak per detik, tidak berbunga, berhenti saat sengketa atau beku.</span></span>
          </label>
          <div className="col-span-full">
            <Field label="Catatan jaminan (opsional)" htmlFor="jaminan">
              <textarea id="jaminan" rows={2} value={v.collateralNote} onChange={(e) => set("collateralNote", e.target.value)} className={`${input} py-3`} />
            </Field>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-4 rounded-[20px] border border-line bg-card p-4 sm:p-5">
          <legend className={legend}>Dokumen pendukung</legend>
          <label htmlFor="dokumen" className="relative flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border-[1.5px] border-dashed border-line2 bg-raised p-5 text-center sm:p-6">
            <span className="text-sm font-medium">Upload kuitansi, invoice, atau kontrak</span>
            <span className="text-xs text-faint">PDF, JPG, atau PNG · maks 10 MB per file · maks 5 file</span>
            <input id="dokumen" type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="sr-only" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} />
          </label>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((f) => <span key={f.name} className="max-w-full rounded-[10px] bg-brand-soft px-3 py-2 text-[13px] text-lav [overflow-wrap:anywhere]">{f.name} · {Math.ceil(f.size / 1024)} KB</span>)}
            </div>
          )}
          <p className="text-xs text-faint">Hash setiap file ikut dikunci di blockchain. File yang diganti setelah tanda tangan akan terdeteksi.</p>
        </fieldset>

        <fieldset className="flex flex-col gap-4 rounded-[20px] border border-line bg-card p-4 sm:p-5">
          <legend className={legend}>Pencairan dana</legend>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
            {([["onchain", "Escrow stablecoin (IDRX)", "Kreditur setor saat tanda tangan, dana cair otomatis ke debitur saat aktif."], ["offchain", "Transfer sendiri", "Kreditur transfer bank atau tunai, debitur mengonfirmasi terima dana."]] as const).map(([k, t, b]) => (
              <button key={k} type="button" aria-pressed={v.disbursement === k} onClick={() => set("disbursement", k)} className={card(v.disbursement === k)}>
                <span className="font-semibold">{t}</span>
                <span className="text-[13px] text-soft">{b}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-[20px] border border-line bg-card p-4 sm:p-5">
          <legend className={legend}>Pihak lawan</legend>
          <Field
            label={`Alamat wallet ${v.role === "creditor" ? "debitur" : "kreditur"}`}
            htmlFor="wallet"
            hint={walletLocked ? "Wallet pihak lawan tidak bisa diubah setelah draft dibuat. Kalau alamatnya salah, batalkan draft ini lalu buat surat baru." : "Pihak lawan masuk dengan wallet ini untuk melihat dan menandatangani surat."}
          >
            <div className="relative">
              <input
                id="wallet"
                required
                disabled={walletLocked}
                value={v.counterpartyWallet}
                onChange={(e) => set("counterpartyWallet", e.target.value)}
                placeholder="0x…"
                className={`${input} font-mono text-sm [overflow-wrap:anywhere] ${walletLocked ? "cursor-not-allowed border-line bg-raised pr-11 text-soft" : ""} ${!walletLocked && v.counterpartyWallet && !walletOk ? "border-rasp" : ""}`}
              />
              {walletLocked && (
                <svg className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-faint" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
              )}
            </div>
          </Field>
        </fieldset>
      </div>

      {/* Layar lebar: ringkasan menempel di kanan selama halaman di-scroll; tombol simpan di sini hanya di desktop (≥ 1280px). */}
      <aside className="flex min-w-0 flex-[1_1_340px] flex-col gap-4 lg:sticky lg:top-6">
        <section aria-label="Ringkasan draft" className="flex flex-col gap-4 rounded-[22px] bg-brand p-4 sm:p-5">
          <span className="self-start rounded-md bg-white/20 px-2.5 py-1 text-[11px] font-semibold tracking-wider">{noteId ? "UBAH DRAFT" : "DRAFT BARU"}</span>
          <span className="text-xl font-semibold leading-snug [overflow-wrap:anywhere]">{v.title.trim() || "Tanpa judul"}</span>
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] text-brand-tint">Total yang harus dibayar debitur</span>
            <span className="text-[28px] font-semibold leading-tight tabular-nums [overflow-wrap:anywhere] sm:text-[32px]">{fmtRpWhole(total)}</span>
          </div>
          <ol className="flex max-h-[320px] flex-col gap-1.5 overflow-y-auto text-[13px]">
            {schedule.map((s) => (
              <li key={s.label} className="flex justify-between gap-3 rounded-[10px] bg-black/20 px-3 py-2 tabular-nums">
                <span>{s.label} · {s.due}</span>
                <span className="font-semibold">{fmtRpWhole(s.amount)}</span>
              </li>
            ))}
          </ol>
          <span className="text-xs text-brand-tint">{v.lateFee ? "Denda 2% per bulan dari cicilan yang terlambat." : "Tanpa denda keterlambatan."}</span>
        </section>
        <Button type="submit" variant="rasp" disabled={busy} className="min-h-[52px] flex-none font-semibold max-xl:hidden">
          {busy && <Spinner />} {noteId ? "Simpan perubahan" : "Simpan draft"}
        </Button>
        <p className="flex-none text-xs leading-relaxed text-faint">Draft belum mengikat. Setelah disimpan, cek lagi lalu klik <strong className="text-soft">Kirim untuk tanda tangan</strong>. Piutang baru aktif setelah kedua pihak tanda tangan.</p>
      </aside>

      {/* HP & tablet (< 1280px): satu-satunya tombol simpan ada di footer yang menempel di bawah layar. */}
      <div className="sticky bottom-0 z-20 -mx-4 -mb-12 flex items-center gap-3 border-t border-line bg-board/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-board/80 sm:-mx-6 sm:px-6 lg:col-span-full lg:-mx-10 lg:px-10 xl:hidden">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[11px] text-faint">Total dibayar debitur</span>
          <span className="truncate text-base font-semibold tabular-nums">{fmtRpWhole(total)}</span>
        </span>
        <Button type="submit" variant="rasp" disabled={busy} className="min-h-12 flex-none px-6 font-semibold">
          {busy && <Spinner />} {noteId ? "Simpan perubahan" : "Simpan draft"}
        </Button>
      </div>
    </form>
  );
}
