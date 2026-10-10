import type { ReactNode } from "react";

/**
 * Kerangka tampilan saat data dimuat. Bentuk & ukurannya meniru kartu aslinya supaya halaman tidak "melompat"
 * waktu data datang. Pembaca layar hanya mendengar label "Memuat …", bukan blok-blok abu-abunya.
 */

/** Satu blok abu-abu berkilau. `onBrand` untuk blok di atas latar ungu. */
export function Sk({ className = "", onBrand = false }: { className?: string; onBrand?: boolean }) {
  // Sudut default rounded-md, kecuali className sudah menentukan sudutnya sendiri.
  const radius = /(^|\s|:)rounded-/.test(className) ? "" : "rounded-md";
  return <span aria-hidden className={`skeleton block ${radius} ${onBrand ? "skeleton-on-brand" : ""} ${className}`} />;
}

/** Pembungkus area yang sedang dimuat (aria-busy + label untuk pembaca layar). */
export function Loading({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

const repeat = (n: number, f: (i: number) => ReactNode) => Array.from({ length: n }, (_, i) => f(i));

/* ---------------- Dashboard ---------------- */

export function TileSkeleton({ big, wide }: { big?: boolean; wide?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-2 rounded-[18px] p-4 sm:gap-2.5 sm:p-5 ${wide ? "col-span-2 sm:col-span-1" : ""} ${big ? "bg-brand" : "border border-line bg-card"}`}>
      <Sk onBrand={big} className="h-3.5 w-3/4" />
      <Sk onBrand={big} className="h-7 w-1/2" />
      <Sk onBrand={big} className="h-3 w-2/5" />
    </div>
  );
}

/** Baris "Surat piutang terbaru" di dashboard (kartu di HP, tabel di layar lebar). */
export function NoteRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Loading label="Memuat surat piutang…">
      <ul className="-mx-1 flex flex-col md:hidden">
        {repeat(rows, (i) => (
          <li key={i} className="flex flex-col gap-2.5 border-t border-line px-1 py-3.5 first:border-t-0">
            <span className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Sk className="h-4 w-4/5" />
                <Sk className="h-3 w-2/5" />
              </span>
              <Sk className="h-6 w-16 flex-none" />
            </span>
            <span className="flex justify-between gap-3">
              <Sk className="h-3.5 w-1/3" />
              <Sk className="h-3.5 w-24" />
            </span>
          </li>
        ))}
      </ul>
      <div className="hidden flex-col md:flex">
        <div className="flex gap-6 px-3 py-2.5">
          {["w-20", "w-14", "w-12", "w-32", "w-12"].map((w, i) => <Sk key={i} className={`h-3 ${w}`} />)}
        </div>
        {repeat(rows, (i) => (
          <div key={i} className="grid grid-cols-[2.2fr_1fr_1fr_1.4fr_0.8fr] items-center gap-4 border-t border-line px-3 py-3.5">
            <span className="flex flex-col gap-1.5"><Sk className="h-4 w-4/5" /><Sk className="h-3 w-1/2" /></span>
            <Sk className="h-3.5 w-16" />
            <Sk className="ml-auto h-3.5 w-24" />
            <Sk className="h-3.5 w-24" />
            <Sk className="h-6 w-16" />
          </div>
        ))}
      </div>
    </Loading>
  );
}

export function ActionCardSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-line bg-card p-4">
      <Sk className="h-5 w-24" />
      <Sk className="h-4 w-4/5" />
      <Sk className="h-3 w-3/5" />
      <Sk className="h-3.5 w-32" />
    </div>
  );
}

/* ---------------- Piutang saya ---------------- */

export function NoteCardSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-3.5 rounded-[20px] border border-line bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <Sk className="h-3 w-28" />
        <Sk className="h-6 w-16" />
      </div>
      <Sk className="h-5 w-4/5" />
      <div className="flex items-center gap-2.5">
        <Sk className="h-9 w-9 flex-none rounded-[10px]" />
        <span className="flex flex-1 flex-col gap-1.5">
          <Sk className="h-3.5 w-1/2" />
          <Sk className="h-3 w-2/5" />
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-end justify-between gap-3">
          <Sk className="h-3 w-2/5" />
          <Sk className="h-6 w-28" />
        </div>
        <Sk className="h-1.5 w-full rounded-full" />
      </div>
      <div className="flex justify-between gap-2 border-t border-line pt-3">
        <Sk className="h-3 w-1/3" />
        <Sk className="h-3 w-1/4" />
      </div>
    </div>
  );
}

export function NoteGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <Loading label="Memuat surat piutang…" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4">
      {repeat(count, (i) => <NoteCardSkeleton key={i} />)}
    </Loading>
  );
}

/* ---------------- Tanda tangan ---------------- */

export function SignCardSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-3.5 rounded-[20px] border border-line bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2.5">
        <Sk className="h-10 w-10 flex-none rounded-xl" />
        <span className="flex flex-1 flex-col gap-1.5">
          <Sk className="h-3.5 w-3/5" />
          <Sk className="h-3 w-1/3" />
        </span>
        <Sk className="h-6 w-20 flex-none" />
      </div>
      <div className="flex flex-col gap-2">
        <Sk className="h-5 w-4/5" />
        <Sk className="h-3.5 w-1/2" />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-3 rounded-[14px] bg-midnight p-3 sm:p-3.5">
        {repeat(4, (i) => (
          <span key={i} className="flex flex-col gap-1.5"><Sk className="h-3 w-1/2" /><Sk className="h-4 w-4/5" /></span>
        ))}
      </div>
      <Sk className="h-[46px] w-full rounded-full" />
    </div>
  );
}

export function SignGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <Loading label="Memuat surat…" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-4">
      {repeat(count, (i) => <SignCardSkeleton key={i} />)}
    </Loading>
  );
}

/* ---------------- Detail piutang ---------------- */

function CardShell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col gap-3.5 rounded-[20px] border border-line bg-card p-5 ${className}`}>{children}</div>;
}

export function NoteDetailSkeleton() {
  return (
    <Loading label="Memuat detail piutang…" className="mx-auto flex max-w-[1240px] flex-col gap-6">
      <Sk className="h-3.5 w-40" />
      <div className="flex flex-wrap items-start justify-between gap-4 sm:gap-5">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-3">
          <div className="flex gap-2"><Sk className="h-6 w-20" /><Sk className="h-6 w-36" /></div>
          <Sk className="h-8 w-4/5 sm:h-10" />
          <Sk className="h-4 w-3/5" />
        </div>
        <div className="flex w-full gap-2.5 sm:w-auto">
          <Sk className="h-11 flex-1 rounded-full sm:w-40 sm:flex-none" />
          <Sk className="h-11 flex-1 rounded-full sm:w-36 sm:flex-none" />
        </div>
      </div>
      <CardShell>
        <Sk className="h-5 w-56" />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
          <Sk className="h-[60px] w-full rounded-xl" />
          <Sk className="h-[60px] w-full rounded-xl" />
        </div>
      </CardShell>
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
          <div className="flex flex-col gap-5 rounded-[22px] bg-brand p-5 sm:p-6">
            <span className="flex flex-col gap-2"><Sk onBrand className="h-3.5 w-48" /><Sk onBrand className="h-10 w-3/5 sm:h-12" /></span>
            <Sk onBrand className="h-2.5 w-full rounded-full" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {repeat(4, (i) => <span key={i} className="flex flex-col gap-1.5"><Sk onBrand className="h-3 w-3/5" /><Sk onBrand className="h-4 w-4/5" /></span>)}
            </div>
          </div>
          <CardShell>
            <Sk className="h-5 w-36" />
            {repeat(4, (i) => (
              <div key={i} className="flex items-center justify-between gap-3 border-t border-line pt-3 first-of-type:border-t-0 first-of-type:pt-0">
                <span className="flex flex-col gap-1.5"><Sk className="h-3.5 w-28" /><Sk className="h-3 w-20" /></span>
                <span className="flex flex-col items-end gap-1.5"><Sk className="h-3.5 w-24" /><Sk className="h-5 w-20" /></span>
              </div>
            ))}
          </CardShell>
        </div>
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-5">
          <CardShell>
            <Sk className="h-4 w-16" />
            {repeat(2, (i) => (
              <div key={i} className="flex items-center gap-3">
                <Sk className="h-10 w-10 flex-none rounded-xl" />
                <span className="flex flex-1 flex-col gap-1.5"><Sk className="h-3.5 w-1/2" /><Sk className="h-3 w-2/5" /></span>
              </div>
            ))}
          </CardShell>
          <CardShell>
            <Sk className="h-4 w-28" />
            <Sk className="h-3 w-full" />
            <Sk className="h-3 w-4/5" />
            <Sk className="h-3.5 w-1/2" />
          </CardShell>
          <CardShell>
            <Sk className="h-4 w-20" />
            {repeat(3, (i) => (
              <div key={i} className="flex gap-2.5">
                <Sk className="mt-1 h-2.5 w-2.5 flex-none rounded-full" />
                <span className="flex flex-1 flex-col gap-1.5"><Sk className="h-3.5 w-3/4" /><Sk className="h-3 w-1/3" /></span>
              </div>
            ))}
          </CardShell>
        </div>
      </div>
    </Loading>
  );
}

/* ---------------- Ubah draft ---------------- */

export function NoteFormSkeleton() {
  return (
    <Loading label="Memuat draft…" className="flex flex-col gap-6">
      <span className="flex flex-col gap-2"><Sk className="h-3.5 w-40" /><Sk className="h-8 w-56" /></span>
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
          {repeat(3, (i) => (
            <CardShell key={i} className="p-4 sm:p-5">
              <Sk className="h-5 w-40" />
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-4">
                {repeat(i === 0 ? 4 : 2, (j) => (
                  <span key={j} className="flex flex-col gap-1.5"><Sk className="h-3.5 w-24" /><Sk className="h-[46px] w-full rounded-xl" /></span>
                ))}
              </div>
            </CardShell>
          ))}
        </div>
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 rounded-[22px] bg-brand p-4 sm:p-5">
          <Sk onBrand className="h-4 w-32" />
          <Sk onBrand className="h-9 w-3/5" />
          {repeat(4, (i) => <span key={i} className="flex justify-between gap-3"><Sk onBrand className="h-3 w-1/3" /><Sk onBrand className="h-3 w-1/4" /></span>)}
          <Sk onBrand className="h-11 w-full rounded-full" />
        </div>
      </div>
    </Loading>
  );
}

/* ---------------- Profil ---------------- */

export function ProfileSkeleton() {
  return (
    <Loading label="Memuat profil…" className="flex flex-col gap-5">
      <Sk className="h-8 w-28" />
      <div className="flex flex-wrap items-center gap-4 rounded-[22px] bg-brand p-5 sm:gap-5 sm:p-6">
        <Sk onBrand className="h-20 w-20 flex-none rounded-[22px]" />
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-2.5">
          <Sk onBrand className="h-7 w-1/2" />
          <Sk onBrand className="h-3.5 w-3/5" />
          <span className="flex gap-2"><Sk onBrand className="h-6 w-28" /><Sk onBrand className="h-6 w-16" /></span>
        </div>
        <div className="grid w-full flex-[1_1_280px] grid-cols-3 gap-2 sm:w-auto sm:gap-3">
          {repeat(3, (i) => <Sk key={i} onBrand className="h-[68px] w-full rounded-[14px]" />)}
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-5">
          {repeat(2, (i) => (
            <CardShell key={i} className="gap-4">
              <Sk className="h-5 w-32" />
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-4">
                {repeat(2, (j) => <span key={j} className="flex flex-col gap-1.5"><Sk className="h-3.5 w-24" /><Sk className="h-[46px] w-full rounded-xl" /></span>)}
              </div>
              <Sk className="h-11 w-36 rounded-full" />
            </CardShell>
          ))}
        </div>
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-5">
          <CardShell>
            <Sk className="h-5 w-28" />
            <Sk className="h-9 w-1/2" />
            <Sk className="h-3 w-4/5" />
            <Sk className="h-11 w-full rounded-full" />
          </CardShell>
          <CardShell>
            <Sk className="h-5 w-24" />
            {repeat(4, (i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <span className="flex flex-1 flex-col gap-1.5"><Sk className="h-3.5 w-1/2" /><Sk className="h-3 w-3/4" /></span>
                <Sk className="h-6 w-11 flex-none rounded-full" />
              </div>
            ))}
          </CardShell>
        </div>
      </div>
    </Loading>
  );
}

/* ---------------- Chat ---------------- */

export function ChatListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Loading label="Memuat percakapan…" className="flex flex-col gap-1">
      {repeat(rows, (i) => (
        <div key={i} className="flex items-start gap-3 rounded-[14px] p-3">
          <Sk className="h-10 w-10 flex-none rounded-xl" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="flex justify-between gap-2"><Sk className="h-3.5 w-1/2" /><Sk className="h-3 w-8" /></span>
            <Sk className="h-3 w-3/4" />
            <Sk className="h-3 w-2/3" />
          </span>
        </div>
      ))}
    </Loading>
  );
}

/** Gelembung pesan bergantian kiri/kanan, plus satu pesan sistem di tengah. */
export function ChatThreadSkeleton({ inset = true }: { inset?: boolean }) {
  const bubbles: ("them" | "me" | "event")[] = ["event", "them", "me", "them", "me", "me"];
  const widths = ["w-56", "w-64", "w-48", "w-72", "w-40", "w-52"];
  return (
    <Loading label="Memuat pesan…" className={`flex flex-1 flex-col gap-3 ${inset ? "px-3 py-4 sm:px-4" : ""}`}>
      {bubbles.map((k, i) => (
        <div key={i} className={`flex ${k === "event" ? "justify-center" : k === "me" ? "justify-end" : "justify-start"}`}>
          {k === "event" ? (
            <Sk className="h-7 w-64 max-w-[85%] rounded-full" />
          ) : (
            <Sk className={`h-12 max-w-[85%] sm:max-w-[72%] ${widths[i]} ${k === "me" ? "rounded-[16px_16px_4px_16px]" : "rounded-[16px_16px_16px_4px]"}`} />
          )}
        </div>
      ))}
    </Loading>
  );
}

export function ChatHeaderSkeleton() {
  return (
    <div aria-hidden className="flex items-center gap-3 border-b border-line px-3 py-3 sm:px-4.5 sm:py-4">
      <Sk className="h-10 w-10 flex-none rounded-xl" />
      <span className="flex flex-1 flex-col gap-1.5"><Sk className="h-4 w-1/3" /><Sk className="h-3 w-1/2" /></span>
      <Sk className="h-10 w-24 flex-none rounded-full" />
    </div>
  );
}
