"use client";
import { useEffect, useState } from "react";
import { Avatar, Button, Card, Field, Spinner, fmtDate, input } from "@/components/ui";
import { api } from "@/lib/client";
import { useApi, type Me } from "@/lib/hooks";
import { fmtRp } from "@/lib/money";
import { ADDR, txUrl } from "@/lib/chain/config";
import { ProfileSkeleton } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";

export default function ProfilePage() {
  const { data, refresh } = useApi<Me>("/api/me");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!data) return;
    setName(data.user.name ?? "");
    setEmail(data.user.email ?? "");
    setPhone(data.user.phone ?? "");
  }, [data]);

  if (!data) return <ProfileSkeleton />;
  const u = data.user;

  async function run(key: string, fn: () => Promise<unknown>, ok: string, tx?: (r: unknown) => string | undefined) {
    setBusy(key);
    try {
      const r = await fn();
      const hash = tx?.(r);
      const link = hash ? txUrl(hash) : null;
      toast.success(ok, link ? { link: { href: link, label: "Lihat transaksi ↗", external: true } } : undefined);
      await refresh();
    } catch (e) {
      toast.error("Gagal menyimpan", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const faucetWait = u.lastFaucetAt ? new Date(u.lastFaucetAt).getTime() + 24 * 3600_000 - Date.now() : 0;
  const toggles: [keyof Me["user"], string, string][] = [
    ["notifyH3", "Pengingat H-3", "Tiga hari sebelum cicilan jatuh tempo"],
    ["notifyH0", "Pengingat hari H", "Pada tanggal jatuh tempo"],
    ["notifyPayment", "Pembayaran masuk", "Saat cicilan dibayar atau bukti transfer dikirim"],
    ["notifyChat", "Pesan chat baru", "Dari pihak di surat piutangmu"],
  ];

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[26px] font-semibold tracking-tight sm:text-[32px]">Profil</h1>

      <section aria-label="Ringkasan akun" className="flex flex-wrap items-center gap-4 rounded-[22px] bg-brand p-5 sm:gap-5 sm:p-6">
        <Avatar name={u.name || u.wallet.slice(2, 4)} seed={u.wallet} size="lg" />
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-2">
          <span className="text-[22px] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] sm:text-[26px]">{u.name || "Belum ada nama"}</span>
          <span className="text-sm text-brand-tint">Bergabung {fmtDate(u.createdAt)} · login dengan wallet</span>
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-lg px-2.5 py-1 text-xs font-medium ${u.phoneVerifiedAt ? "bg-mint text-mint-ink" : "bg-white/20"}`}>{u.phoneVerifiedAt ? "HP terverifikasi" : "HP belum diverifikasi"}</span>
            <span className="rounded-lg bg-white/20 px-2.5 py-1 text-xs font-medium">Sepolia</span>
          </div>
        </div>
        <dl className="grid w-full flex-[1_1_280px] grid-cols-3 gap-2 text-center sm:w-auto sm:gap-3">
          {[["Sebagai kreditur", data.stats.asCreditor], ["Sebagai debitur", data.stats.asDebtor], ["Lunas", data.stats.paid]].map(([k, v]) => (
            <div key={k as string} className="rounded-[14px] bg-black/20 p-2.5 sm:p-3"><dt className="text-[11px] leading-snug text-brand-tint sm:text-xs">{k}</dt><dd className="mt-1 text-xl font-semibold sm:text-[22px]">{v}</dd></div>
          ))}
        </dl>
      </section>


      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-5">
          <Card className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Data diri</h2>
            <form className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-4" onSubmit={(e) => { e.preventDefault(); run("save", () => api("/api/me", { method: "PATCH", json: { name, email } }), "Profil disimpan."); }}>
              <Field label="Nama lengkap" htmlFor="nama" hint="Ditampilkan ke pihak lawan di surat piutang">
                <input id="nama" value={name} onChange={(e) => setName(e.target.value)} className={input} />
              </Field>
              <Field label="Email" htmlFor="email" hint="Untuk pengingat jatuh tempo">
                <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
              </Field>
              <div><Button type="submit" disabled={!!busy} className="w-full sm:w-auto">{busy === "save" && <Spinner />} Simpan</Button></div>
            </form>
          </Card>

          <Card className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Nomor HP</h2>
            <p className="text-sm text-muted">Wajib diverifikasi sebelum membuat atau menandatangani surat piutang. Nomor tidak pernah masuk blockchain.</p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-[1_1_220px]">
                <Field label={u.phoneVerifiedAt ? `Terverifikasi ${fmtDate(u.phoneVerifiedAt)}` : "Nomor HP"} htmlFor="hp">
                  <input id="hp" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812… atau +62812…" className={input} />
                </Field>
              </div>
              <Button variant="secondary" className="w-full sm:w-auto" disabled={!!busy || phone.length < 9} onClick={() => run("otp", async () => {
                const r = await api<{ devCode?: string }>("/api/me/otp", { method: "POST", json: { action: "send", phone } });
                setOtpSent(r.devCode ?? "");
              }, "Kode OTP dikirim.")}>{u.phoneVerifiedAt ? "Ganti nomor" : "Kirim kode OTP"}</Button>
            </div>
            {otpSent !== null && (
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-[1_1_160px]">
                  <Field label="Kode OTP (6 digit)" htmlFor="otp" hint={otpSent ? `Mode development: kodenya ${otpSent}` : "Cek SMS kamu"}>
                    <input id="otp" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className={`${input} tracking-[0.3em]`} />
                  </Field>
                </div>
                <Button className="w-full sm:w-auto" disabled={!!busy || code.length !== 6} onClick={() => run("verify", async () => { await api("/api/me/otp", { method: "POST", json: { action: "verify", code } }); setOtpSent(null); setCode(""); }, "Nomor HP terverifikasi.")}>Verifikasi</Button>
              </div>
            )}
          </Card>

          <Card className="flex flex-col gap-3.5">
            <h2 className="text-lg font-semibold">Wallet</h2>
            <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-midnight p-3.5 sm:p-4">
              <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
                <span className="text-xs text-faint">Alamat wallet login</span>
                <span className="font-mono text-sm [overflow-wrap:anywhere]">{u.wallet}</span>
              </div>
              <Button variant="secondary" className="w-full sm:w-auto" onClick={async () => { try { await navigator.clipboard.writeText(u.wallet); toast.success("Alamat wallet disalin", { description: `${u.wallet.slice(0, 6)}…${u.wallet.slice(-4)}` }); } catch { toast.error("Gagal menyalin alamat", { description: "Salin manual dari teks di atas." }); } }}>Salin alamat</Button>
            </div>
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3 text-[13px]">
              <div><dt className="text-xs text-faint">Saldo IDRX uji</dt><dd className="mt-0.5 font-medium tabular-nums">{fmtRp(data.balance)}</dd></div>
              <div><dt className="text-xs text-faint">Token</dt><dd className="mt-0.5 font-mono text-xs [overflow-wrap:anywhere]">{ADDR.MockIDRX}</dd></div>
              <div><dt className="text-xs text-faint">Biaya jaringan</dt><dd className="mt-0.5 font-medium">Dibayar relayer PiutangChain</dd></div>
            </dl>
            <div className="flex flex-wrap gap-2.5">
              <Button className="w-full sm:w-auto" disabled={!!busy || faucetWait > 0} onClick={() => run("faucet", () => api<{ txHash: string }>("/api/faucet", { method: "POST" }), "Rp10.000.000 IDRX uji masuk ke wallet kamu.", (r) => (r as { txHash: string }).txHash)}>
                {busy === "faucet" && <Spinner />} {faucetWait > 0 ? `Faucet lagi dalam ${Math.ceil(faucetWait / 3600_000)} jam` : "Ambil Rp10.000.000 IDRX uji"}
              </Button>
            </div>
            <p className="text-xs text-faint">IDRX hanya token uji di Sepolia, tidak bernilai. Bukti digital piutang yang kamu pegang sebagai kreditur tersimpan di wallet ini.</p>
          </Card>
        </div>

        <Card className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
          <h2 className="mb-2 text-lg font-semibold">Notifikasi</h2>
          {toggles.map(([key, label, hint]) => {
            const on = !!u[key];
            return (
              <div key={key} className="flex items-center gap-3 border-t border-line py-2.5">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span id={`n-${key}`} className="text-sm font-medium">{label}</span><span className="text-xs text-faint">{hint}</span></span>
                <button type="button" role="switch" aria-checked={on} aria-labelledby={`n-${key}`} disabled={!!busy}
                  onClick={() => run("notif", () => api("/api/me", { method: "PATCH", json: { [key]: !on } }), "Pengaturan notifikasi disimpan.")}
                  className={`relative h-7 w-12 flex-none rounded-full transition-colors ${on ? "bg-brand" : "bg-line2"}`}>
                  <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-[left] ${on ? "left-6" : "left-1"}`} />
                </button>
              </div>
            );
          })}
          <p className="mt-2 text-xs text-faint">Pengiriman email/SMS belum disambung; pengingat saat ini tampil di chat setiap piutang.</p>
        </Card>
      </div>
    </div>
  );
}
