"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar, Logo } from "./ui";
import { MenuButton, useDisclosure } from "./MobileMenu";
import { useToast } from "./Toast";
import { api } from "@/lib/client";
import { hasRevisionAlert, needsMySignature, useApi, type NoteSummary } from "@/lib/hooks";

const I = {
  dash: <path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z" />,
  notes: <><path d="M7 3h8l4 4v14H7z" /><path d="M11 12h5M11 16h5" /></>,
  sign: <><path d="M3 17c3-4 5 2 8-2s4-6 7-3" /><path d="M3 21h18" /></>,
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  plus: <path d="M12 5v14M5 12h14" />,
};

const Icon = ({ children, size = 18 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

/** Apakah percakapan surat ini sedang tampil di layar halaman Chat (tidak perlu toast). */
function isChatOpen(noteId: string, notes: NoteSummary[]) {
  if (window.location.pathname !== "/app/chat") return false;
  const chosen = new URLSearchParams(window.location.search).get("note");
  if (chosen) return chosen === noteId;
  // Tanpa ?note=, layar tablet/desktop otomatis membuka percakapan terbaru; HP menampilkan daftar saja.
  if (!window.matchMedia("(min-width: 768px)").matches) return false;
  const latest = notes
    .filter((n) => n.role)
    .sort((a, b) => new Date(b.lastMessageAt ?? b.updatedAt).getTime() - new Date(a.lastMessageAt ?? a.updatedAt).getTime())[0];
  return latest?.id === noteId;
}

export default function AppShell({ wallet, name, children }: { wallet: string; name: string | null; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { data } = useApi<{ notes: NoteSummary[]; me?: string }>("/api/notes", 10000);
  const notes = data?.notes ?? [];
  const toSign = notes.filter(needsMySignature).length;
  const unread = notes.reduce((s, n) => s + n.unread, 0);
  const revisions = notes.filter(hasRevisionAlert).length;
  const display = name || `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  const menu = useDisclosure();
  const toast = useToast();
  const drawerRef = useRef<HTMLElement>(null);
  const seenUnread = useRef<Map<string, number> | null>(null);
  const switching = useRef(false);
  // Sesi login disimpan di satu cookie untuk seluruh browser. Kalau di tab lain masuk dengan akun berbeda, tab ini
  // diam-diam ikut memakai akun itu (nama di sidebar masih akun lama, notifikasi jadi salah). Muat ulang agar sinkron.
  const sessionSwitched = !!data?.me && data.me.toLowerCase() !== wallet.toLowerCase();
  useEffect(() => {
    if (!sessionSwitched || switching.current) return;
    switching.current = true;
    toast.info("Akun berganti", { description: "Browser ini sekarang masuk dengan akun lain (dari tab lain). Halaman dimuat ulang…" });
    const t = setTimeout(() => window.location.reload(), 1800);
    return () => clearTimeout(t);
  }, [sessionSwitched, toast]);

  // Toast saat ada pesan chat masuk: bandingkan jumlah belum-dibaca tiap surat dengan polling sebelumnya.
  // Polling pertama hanya jadi patokan (pesan lama tidak dimunculkan), dan percakapan yang sedang terbuka dilewati.
  useEffect(() => {
    if (!data || sessionSwitched) return;
    const prev = seenUnread.current;
    seenUnread.current = new Map(data.notes.map((n) => [n.id, n.unread]));
    if (!prev) return;
    for (const n of data.notes) {
      const added = n.unread - (prev.get(n.id) ?? 0);
      if (added <= 0 || n.lastMessageMine || isChatOpen(n.id, data.notes)) continue;
      const preview = (n.lastMessage ?? "").length > 120 ? `${n.lastMessage!.slice(0, 117)}…` : n.lastMessage ?? "";
      toast.chat(
        n.lastMessageFrom ? (added > 1 ? `${added} pesan baru dari ${n.lastMessageFrom}` : `Pesan baru dari ${n.lastMessageFrom}`) : `Kabar baru · ${n.code}`,
        {
          description: (
            <>
              <span className="line-clamp-2 text-ink/90">{preview}</span>
              <span className="mt-0.5 block truncate text-xs text-faint">{n.code} · {n.title}</span>
            </>
          ),
          link: { href: `/app/chat?note=${n.id}`, label: n.lastMessageFrom ? "Balas →" : "Lihat →" },
          duration: 6000,
        },
      );
    }
  }, [data, toast, sessionSwitched]);
  const [lastPath, setLastPath] = useState(path);

  // Tutup drawer setiap kali halaman berganti.
  if (path !== lastPath) {
    setLastPath(path);
    if (menu.open) menu.close();
  }

  // Fokus ke item pertama saat drawer dibuka, dan jaga fokus Tab tetap di dalam drawer.
  useEffect(() => {
    if (!menu.open) return;
    const el = drawerRef.current;
    el?.querySelector<HTMLElement>("a[href], button")?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [menu.open]);

  const items: { href: string; label: string; icon: ReactNode; badge?: number; badgeCls?: string; exact?: boolean }[] = [
    { href: "/app", label: "Dashboard", icon: I.dash, exact: true },
    { href: "/app/piutang", label: "Piutang saya", icon: I.notes, badge: revisions, badgeCls: "bg-butter text-butter-ink" },
    { href: "/app/tanda-tangan", label: "Tanda tangan", icon: I.sign, badge: toSign, badgeCls: "bg-rasp text-white" },
    { href: "/app/chat", label: "Chat", icon: I.chat, badge: unread, badgeCls: "bg-brand-soft text-lav" },
    { href: "/app/piutang/baru", label: "Buat surat piutang", icon: I.plus, exact: true },
  ];
  const isActive = (href: string, exact?: boolean) =>
    exact ? path === href : path === href || (path.startsWith(href + "/") && !items.some((i) => i.exact && path === i.href));
  const current = items.find((i) => isActive(i.href, i.exact))?.label ?? (path === "/app/profil" ? "Profil" : "");

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (e) {
      toast.error("Gagal keluar", { description: (e as Error).message });
      return;
    }
    toast.success("Kamu sudah keluar", { description: "Sampai jumpa lagi." });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="min-h-screen lg:flex">
      {/* Top bar khusus layar kecil */}
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-board/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-board/80 sm:px-6 lg:hidden">
        <Link href="/app" className="flex min-w-0 items-center gap-2.5 text-ink no-underline">
          <Logo size={28} />
          <span className="truncate text-base font-semibold">{current || "Collatera"}</span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/app/piutang/baru"
            aria-label="Buat surat piutang"
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-white no-underline hover:bg-[#2a2a2a]"
          >
            <Icon size={20}>{I.plus}</Icon>
          </Link>
          <MenuButton open={menu.open} onClick={menu.toggle} controls="menu-aplikasi" badge={toSign + unread + revisions} ref={menu.buttonRef} />
        </div>
      </header>

      {/* Latar gelap di belakang drawer */}
      <div
        aria-hidden
        onClick={menu.close}
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-200 lg:hidden ${menu.open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />

      {/* Sidebar: drawer di layar kecil, menempel di kiri di desktop */}
      <aside
        id="menu-aplikasi"
        ref={drawerRef}
        aria-label="Menu aplikasi"
        className={`fixed inset-y-0 left-0 z-50 box-border flex w-[min(86vw,300px)] flex-col gap-7 overflow-y-auto overscroll-contain border-r border-line bg-board px-4 py-5 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-[260px] lg:flex-none lg:translate-x-0 lg:py-6 xl:w-[280px] ${
          // Buka: langsung terlihat (bisa difokus). Tutup: sembunyikan setelah animasi geser selesai.
          menu.open
            ? "translate-x-0 shadow-[0_0_60px_rgba(0,0,0,0.6)] [transition:transform_200ms_ease]"
            : "-translate-x-full [transition:transform_200ms_ease,visibility_0s_linear_200ms] max-lg:invisible"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <Link href="/" className="flex items-center gap-2.5 px-2 text-ink no-underline">
            <Logo />
            <span className="text-[21px] font-bold tracking-[-0.03em]">Collatera</span>
          </Link>
          <button
            type="button"
            onClick={menu.close}
            aria-label="Tutup menu"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-soft hover:bg-raised hover:text-ink lg:hidden"
          >
            <Icon size={20}><path d="M6 6l12 12M18 6L6 18" /></Icon>
          </button>
        </div>
        <nav aria-label="Navigasi aplikasi" className="flex flex-col gap-1 text-sm">
          {items.map((it) => {
            const active = isActive(it.href, it.exact);
            return (
              <Link
                key={it.href}
                href={it.href}
                onClick={menu.close}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-12 items-center gap-3 rounded-[10px] px-3 no-underline transition-colors lg:min-h-11 ${
                  active ? "bg-brand font-medium text-white" : "text-soft hover:bg-raised hover:text-ink"
                }`}
              >
                <Icon>{it.icon}</Icon>
                {it.label}
                {!!it.badge && (
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${active ? "bg-white/20 text-ink" : it.badgeCls}`}>{it.badge}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-2">
          <Link
            href="/app/profil"
            onClick={menu.close}
            aria-current={path === "/app/profil" ? "page" : undefined}
            className={`flex items-center gap-3 rounded-[14px] p-3 no-underline ${path === "/app/profil" ? "bg-brand" : "bg-raised hover:bg-bubble"}`}
          >
            <Avatar name={name || wallet.slice(2, 4)} seed={wallet} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold">{display}</span>
              <span className={`text-xs ${path === "/app/profil" ? "text-brand-tint" : "text-faint"}`}>Profil &amp; pengaturan</span>
            </span>
          </Link>
          <button type="button" onClick={logout} className="min-h-11 rounded-full text-sm text-faint hover:text-ink">
            Keluar
          </button>
        </div>
      </aside>

      <main className="box-border min-w-0 flex-1 px-4 pb-12 pt-5 sm:px-6 sm:pt-7 lg:px-10 lg:pt-8">{children}</main>
    </div>
  );
}
