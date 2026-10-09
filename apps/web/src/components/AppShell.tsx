"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Avatar, Logo } from "./ui";
import { api } from "@/lib/client";
import { needsMySignature, useApi, type NoteSummary } from "@/lib/hooks";

const I = {
  dash: <path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z" />,
  notes: <><path d="M7 3h8l4 4v14H7z" /><path d="M11 12h5M11 16h5" /></>,
  sign: <><path d="M3 17c3-4 5 2 8-2s4-6 7-3" /><path d="M3 21h18" /></>,
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  plus: <path d="M12 5v14M5 12h14" />,
};

export default function AppShell({ wallet, name, children }: { wallet: string; name: string | null; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { data } = useApi<{ notes: NoteSummary[] }>("/api/notes", 15000);
  const notes = data?.notes ?? [];
  const toSign = notes.filter(needsMySignature).length;
  const unread = notes.reduce((s, n) => s + n.unread, 0);
  const display = name || `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;

  const items: { href: string; label: string; icon: ReactNode; badge?: number; badgeCls?: string; exact?: boolean }[] = [
    { href: "/app", label: "Dashboard", icon: I.dash, exact: true },
    { href: "/app/piutang", label: "Piutang saya", icon: I.notes },
    { href: "/app/tanda-tangan", label: "Tanda tangan", icon: I.sign, badge: toSign, badgeCls: "bg-rasp text-white" },
    { href: "/app/chat", label: "Chat", icon: I.chat, badge: unread, badgeCls: "bg-brand-soft text-lav" },
    { href: "/app/piutang/baru", label: "Buat surat piutang", icon: I.plus, exact: true },
  ];
  const isActive = (href: string, exact?: boolean) =>
    exact ? path === href : path === href || (path.startsWith(href + "/") && !items.some((i) => i.exact && path === i.href));

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-wrap">
      <aside className="box-border flex max-w-full flex-[1_1_240px] flex-col gap-7 border-r border-[#24262f] bg-board px-4 py-6 md:sticky md:top-0 md:h-screen md:max-w-[280px]">
        <Link href="/" className="flex items-center gap-2.5 px-2 text-white no-underline">
          <Logo />
          <span className="text-lg font-semibold">piutangchain</span>
        </Link>
        <nav aria-label="Menu aplikasi" className="flex flex-col gap-1 text-sm">
          {items.map((it) => {
            const active = isActive(it.href, it.exact);
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-[10px] px-3 no-underline transition-colors ${
                  active ? "bg-brand font-medium text-white" : "text-soft hover:bg-raised hover:text-white"
                }`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {it.icon}
                </svg>
                {it.label}
                {!!it.badge && <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${active ? "bg-white/20 text-white" : it.badgeCls}`}>{it.badge}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-2">
          <Link
            href="/app/profil"
            aria-current={path === "/app/profil" ? "page" : undefined}
            className={`flex items-center gap-3 rounded-[14px] p-3 no-underline ${path === "/app/profil" ? "bg-brand" : "bg-raised hover:bg-[#262938]"}`}
          >
            <Avatar name={name || wallet.slice(2, 4)} seed={wallet} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-white">{display}</span>
              <span className={`text-xs ${path === "/app/profil" ? "text-brand-tint" : "text-faint"}`}>Profil &amp; pengaturan</span>
            </span>
          </Link>
          <button type="button" onClick={logout} className="min-h-10 rounded-full text-sm text-faint hover:text-white">
            Keluar
          </button>
        </div>
      </aside>
      <main className="box-border min-w-0 flex-[999_1_560px] px-4 pb-12 pt-8 sm:px-8 lg:px-10">{children}</main>
    </div>
  );
}
