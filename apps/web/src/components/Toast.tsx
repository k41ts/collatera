"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Notifikasi singkat (toast) di kanan atas untuk hasil aksi user: "Draft disimpan", "Profil disimpan", dst.
 * Muncul meluncur dari kanan ke kiri, hilang sendiri setelah beberapa detik (berhenti selama kursor/fokus di atasnya),
 * dan bisa ditutup manual. Dipasang sekali di root layout supaya tetap tampil walau halaman berpindah (mis. setelah
 * simpan draft lalu diarahkan ke halaman detail).
 */

type Tone = "success" | "error" | "info" | "chat";
type Options = { description?: ReactNode; link?: { href: string; label: string; external?: boolean }; duration?: number };
type Item = Options & { id: number; tone: Tone; title: ReactNode; phase: "in" | "out" | "collapse" };
type Fn = (title: ReactNode, o?: Options) => void;
type Api = { success: Fn; error: Fn; info: Fn; chat: Fn };

const Ctx = createContext<Api | null>(null);
const MAX = 4;

export function useToast() {
  const api = useContext(Ctx);
  if (!api) throw new Error("useToast harus dipakai di dalam <ToastProvider>");
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const seq = useRef(0);

  const push = useCallback((tone: Tone, title: ReactNode, o: Options = {}) => {
    const id = ++seq.current;
    // Toast terlama ikut keluar kalau sudah terlalu banyak.
    setItems((xs) => [...xs.map((x, i) => (xs.length - i >= MAX && x.phase === "in" ? { ...x, phase: "out" as const } : x)), { ...o, id, tone, title, phase: "in" }]);
  }, []);
  const set = useCallback((id: number, phase: Item["phase"]) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, phase } : x))), []);
  const remove = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const api = useMemo<Api>(
    () => ({
      success: (t, o) => push("success", t, o),
      error: (t, o) => push("error", t, o),
      chat: (t, o) => push("chat", t, o),
      info: (t, o) => push("info", t, o),
    }),
    [push],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <section
        aria-label="Notifikasi"
        className="pointer-events-none fixed right-3 top-3 z-[70] flex w-[min(380px,calc(100vw-3rem))] flex-col sm:right-5 sm:top-5"
      >
        {/* Toast terbaru di paling atas. */}
        {[...items].reverse().map((t) => (
          <ToastItem key={t.id} t={t} onClose={() => set(t.id, "out")} onExited={() => set(t.id, "collapse")} onCollapsed={() => remove(t.id)} />
        ))}
      </section>
    </Ctx.Provider>
  );
}

const TONE: Record<Tone, { bar: string; icon: string; ring: string; path: ReactNode }> = {
  success: { bar: "bg-mint", icon: "bg-mint text-mint-ink", ring: "border-mint/30", path: <path d="M5 12.5l4.5 4.5L19 7.5" /> },
  error: { bar: "bg-rasp", icon: "bg-rasp text-white", ring: "border-rasp/40", path: <path d="M12 7v6M12 17h.01" /> },
  info: { bar: "bg-lav", icon: "bg-lav text-lav-ink", ring: "border-lav/30", path: <path d="M12 11v6M12 7h.01" /> },
  chat: { bar: "bg-brand", icon: "bg-brand text-white", ring: "border-brand/50", path: <path d="M5 6h14v9H10l-5 4z" /> },
};

function ToastItem({ t, onClose, onExited, onCollapsed }: { t: Item; onClose: () => void; onExited: () => void; onCollapsed: () => void }) {
  const s = TONE[t.tone];
  const duration = t.duration ?? (t.tone === "error" ? 7000 : 4500);
  return (
    // Pembungkus grid: setelah toast meluncur keluar, tingginya menyusut halus sehingga toast di bawahnya naik pelan.
    <div
      className={`grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows] duration-200 ease-out ${t.phase === "collapse" ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}
      onTransitionEnd={(e) => e.target === e.currentTarget && t.phase === "collapse" && onCollapsed()}
    >
      <div className={`min-h-0 ${t.phase === "collapse" ? "overflow-hidden" : ""}`}>
        <div className="pb-2.5">
          <div
            role={t.tone === "error" ? "alert" : "status"}
            aria-live={t.tone === "error" ? "assertive" : "polite"}
            onAnimationEnd={(e) => e.target === e.currentTarget && t.phase === "out" && onExited()}
            className={`toast group pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-2xl border bg-card/95 p-3.5 pr-11 text-white shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur supports-[backdrop-filter]:bg-card/85 ${s.ring} ${t.phase === "in" ? "toast-in" : "toast-out"}`}
          >
            <span aria-hidden className={`mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full ${s.icon}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">{s.path}</svg>
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
              <span className="text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{t.title}</span>
              {t.description && <span className="text-[13px] leading-relaxed text-soft [overflow-wrap:anywhere]">{t.description}</span>}
              {t.link && (
                t.link.external ? (
                  <a href={t.link.href} target="_blank" rel="noreferrer" className="mt-1 self-start text-[13px] font-medium text-lav hover:text-white">
                    {t.link.label}
                  </a>
                ) : (
                  // Tautan di dalam aplikasi: pindah halaman tanpa reload, lalu toast ini ditutup.
                  <Link href={t.link.href} onClick={onClose} className="mt-1 self-start text-[13px] font-medium text-lav no-underline hover:text-white">
                    {t.link.label}
                  </Link>
                )
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup notifikasi"
              className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-xl text-faint hover:bg-raised hover:text-white"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            {/* Sisa waktu tampil. Berhenti saat kursor di atas toast atau tombolnya difokus; habis = toast keluar. */}
            {t.phase === "in" && (
              <span
                aria-hidden
                style={{ animationDuration: `${duration}ms` }}
                onAnimationEnd={(e) => { e.stopPropagation(); onClose(); }}
                className={`toast-timer absolute bottom-0 left-0 h-[3px] w-full origin-left ${s.bar} opacity-70 group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]`}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
