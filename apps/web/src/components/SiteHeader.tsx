"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { LinkButton, Logo } from "./ui";
import { MenuButton, useDisclosure } from "./MobileMenu";

const LINKS = [
  ["#cara-kerja", "Cara kerja"],
  ["#fitur", "Fitur"],
  ["#integritas", "Cek integritas"],
  ["#faq", "FAQ"],
] as const;

/** Header landing page: navigasi penuh di desktop, hamburger + panel menu di layar kecil. */
export default function SiteHeader() {
  const menu = useDisclosure("(min-width: 768px)");
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (menu.open) panelRef.current?.querySelector<HTMLElement>("a[href]")?.focus();
  }, [menu.open]);

  return (
    <header className="sticky top-0 z-40 -mx-4 bg-midnight/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-midnight/75 sm:-mx-6 sm:px-6 md:static md:mx-0 md:bg-transparent md:px-0 md:backdrop-blur-none">
      <div className="flex h-16 items-center justify-between gap-5 md:h-auto md:flex-wrap md:pt-7">
        <Link href="/" className="flex items-center gap-3 text-white no-underline">
          <Logo size={32} />
          <span className="text-xl font-semibold tracking-tight md:text-[22px]">piutangchain</span>
        </Link>

        <nav aria-label="Navigasi utama" className="hidden gap-6 text-sm md:flex lg:gap-7">
          {LINKS.map(([h, l]) => (
            <a key={h} href={h} className="text-soft no-underline hover:text-white">{l}</a>
          ))}
        </nav>
        <div className="hidden gap-3 md:flex">
          <LinkButton href="/masuk" variant="secondary">Masuk</LinkButton>
          <LinkButton href="/masuk?next=/app/piutang/baru">Buat surat piutang</LinkButton>
        </div>

        <MenuButton open={menu.open} onClick={menu.toggle} controls="menu-utama" ref={menu.buttonRef} className="md:hidden" />
      </div>

      {/* Panel menu layar kecil. Latar memakai absolute (bukan fixed) karena backdrop-filter di header mengurung elemen fixed. */}
      <div
        aria-hidden
        onClick={menu.close}
        className={`absolute inset-x-0 top-16 z-30 h-[calc(100dvh-4rem)] bg-black/60 transition-opacity duration-200 md:hidden ${menu.open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <div
        id="menu-utama"
        ref={panelRef}
        className={`absolute inset-x-0 top-16 z-40 border-b border-line bg-midnight px-4 pb-6 pt-2 shadow-[0_24px_48px_rgba(0,0,0,0.5)] sm:px-6 md:hidden ${
          menu.open
            ? "translate-y-0 opacity-100 [transition:opacity_150ms,transform_150ms]"
            : "invisible -translate-y-2 opacity-0 [transition:opacity_150ms,transform_150ms,visibility_0s_linear_150ms]"
        }`}
      >
        <nav aria-label="Navigasi utama (seluler)" className="flex flex-col">
          {LINKS.map(([h, l]) => (
            <a key={h} href={h} onClick={menu.close} className="flex min-h-12 items-center border-b border-line text-base text-soft no-underline hover:text-white">
              {l}
            </a>
          ))}
        </nav>
        <div className="mt-5 flex flex-col gap-3">
          <LinkButton href="/masuk?next=/app/piutang/baru" onClick={menu.close} className="min-h-12 w-full">Buat surat piutang</LinkButton>
          <LinkButton href="/masuk" variant="secondary" onClick={menu.close} className="min-h-12 w-full">Masuk</LinkButton>
        </div>
      </div>
    </header>
  );
}
