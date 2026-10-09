"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Logo, Notice, Spinner } from "@/components/ui";
import { hasWallet, loginWithWallet } from "@/lib/client";

function LoginInner() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletPresent, setWalletPresent] = useState(true);

  useEffect(() => {
    setWalletPresent(hasWallet());
  }, []);

  async function login() {
    setBusy(true);
    setError(null);
    try {
      await loginWithWallet();
      router.push(next && next.startsWith("/") ? next : "/app");
      router.refresh();
    } catch (e) {
      const msg = (e as { code?: string | number; message: string });
      setError(msg.code === 4001 || msg.code === "ACTION_REJECTED" ? "Tanda tangan login dibatalkan." : msg.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-[440px] flex-col gap-6 rounded-[24px] border border-line bg-card p-8">
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
        {walletPresent ? (
          <Button onClick={login} disabled={busy} className="min-h-[52px]">
            {busy && <Spinner />} {busy ? "Menunggu MetaMask…" : "Masuk dengan MetaMask"}
          </Button>
        ) : (
          <Notice tone="warn">
            MetaMask belum terpasang di browser ini. Pasang dari{" "}
            <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className="underline">metamask.io</a>, lalu muat ulang halaman.
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <p className="text-xs leading-relaxed text-faint">Login email/Google (embedded wallet) menyusul. Belum punya Sepolia ETH tidak masalah: semua transaksi dibayar relayer.</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
