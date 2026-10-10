"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Logo, Notice, Spinner, btn } from "@/components/ui";
import { isMobileDevice, loginWithWallet, metamaskDeepLink, waitForWallet } from "@/lib/client";
import { useToast } from "@/components/Toast";

function LoginInner() {
  const router = useRouter();
  const toast = useToast();
  const next = useSearchParams().get("next");
  const [busy, setBusy] = useState(false);
  // "checking" sampai kita tahu ada wallet atau tidak (di aplikasi MetaMask, wallet bisa disuntik sedikit terlambat).
  const [env, setEnv] = useState<"checking" | "wallet" | "mobile" | "desktop">("checking");
  const [deepLink, setDeepLink] = useState("");

  useEffect(() => {
    let alive = true;
    waitForWallet().then((ok) => {
      if (!alive) return;
      setEnv(ok ? "wallet" : isMobileDevice() ? "mobile" : "desktop");
      setDeepLink(metamaskDeepLink());
    });
    return () => {
      alive = false;
    };
  }, []);

  async function login() {
    setBusy(true);
    try {
      await loginWithWallet();
      toast.success("Berhasil masuk", { description: "Selamat datang di PiutangChain." });
      router.push(next && next.startsWith("/") ? next : "/app");
      router.refresh();
    } catch (e) {
      const msg = (e as { code?: string | number; message: string });
      if (msg.code === 4001 || msg.code === "ACTION_REJECTED") toast.info("Login dibatalkan", { description: "Tanda tangan login ditolak di MetaMask." });
      else toast.error("Gagal masuk", { description: msg.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-[440px] flex-col gap-6 rounded-[24px] border border-line bg-card p-6 sm:p-8">
        <Link href="/" className="flex items-center gap-2.5 text-white no-underline">
          <Logo />
          <span className="text-lg font-semibold">piutangchain</span>
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Masuk</h1>
          <p className="text-sm leading-relaxed text-muted">
            Masuk dengan wallet di jaringan <strong className="font-semibold text-white">Sepolia</strong>. Kamu akan diminta menandatangani pesan login. Tanda tangan ini <strong className="font-semibold text-white">gratis</strong> dan tidak membuat transaksi.
          </p>
        </div>
        {env === "checking" && (
          <Button disabled className="min-h-[52px]">
            <Spinner /> Mencari wallet…
          </Button>
        )}

        {/* Laptop dengan ekstensi MetaMask, atau HP yang sudah membuka situs ini dari dalam aplikasi MetaMask. */}
        {env === "wallet" && (
          <Button onClick={login} disabled={busy} className="min-h-[52px]">
            {busy && <Spinner />} {busy ? "Menunggu MetaMask…" : "Masuk dengan MetaMask"}
          </Button>
        )}

        {/* HP di browser biasa (Chrome/Safari): tidak ada wallet, jadi buka situs ini di browser dalam aplikasi MetaMask. */}
        {env === "mobile" && (
          <div className="flex flex-col gap-3">
            <a href={deepLink} className={btn("primary", "min-h-[52px] gap-2.5 text-[15px] no-underline")}>
              <WalletIcon /> Buka di aplikasi MetaMask
            </a>
            <ol className="flex flex-col gap-2 rounded-2xl bg-midnight p-4 text-[13px] leading-relaxed text-soft">
              {[
                "Tombol di atas membuka PiutangChain di browser dalam aplikasi MetaMask.",
                <>Tekan <strong className="font-semibold text-white">Masuk dengan MetaMask</strong>, lalu setujui permintaan tanda tangan di aplikasi.</>,
                "Selanjutnya pakai PiutangChain dari browser MetaMask itu agar bisa tanda tangan dan bayar.",
              ].map((t, i) => (
                <li key={i} className="flex gap-2.5">
                  <span aria-hidden className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-lav">{i + 1}</span>
                  <span>{t}</span>
                </li>
              ))}
            </ol>
            <p className="text-[13px] text-muted">
              Belum punya aplikasinya?{" "}
              <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className="font-medium text-lav underline">Unduh MetaMask</a>{" "}
              untuk Android atau iPhone, lalu tekan tombol di atas lagi.
            </p>
          </div>
        )}

        {env === "desktop" && (
          <Notice tone="warn">
            MetaMask belum terpasang di browser ini. Pasang ekstensinya dari{" "}
            <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className="underline">metamask.io</a>, lalu muat ulang halaman.
          </Notice>
        )}
        <p className="text-xs leading-relaxed text-faint">Login email/Google (embedded wallet) menyusul. Belum punya Sepolia ETH tidak masalah: semua transaksi dibayar relayer.</p>
      </div>
    </div>
  );
}

function WalletIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1" />
      <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2z" />
      <circle cx="16.5" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
