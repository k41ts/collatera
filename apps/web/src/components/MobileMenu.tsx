"use client";
import { useCallback, useEffect, useRef, useState, type Ref } from "react";

/**
 * State menu hamburger: Escape menutup, scroll halaman dikunci selama terbuka, otomatis tertutup saat layar
 * melebar melewati `desktopQuery`, dan fokus kembali ke tombol hamburger setelah ditutup dari keyboard.
 */
export function useDisclosure(desktopQuery = "(min-width: 1024px)") {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    const mq = window.matchMedia(desktopQuery);
    const onChange = () => mq.matches && setOpen(false);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [desktopQuery]);

  return { open, close, toggle, buttonRef };
}

/** Tombol hamburger yang berubah jadi ✕ saat terbuka. `badge` menandai ada hal yang perlu dilihat. */
export function MenuButton({
  open,
  onClick,
  controls,
  badge = 0,
  ref,
  className = "",
}: {
  open: boolean;
  onClick: () => void;
  controls: string;
  badge?: number;
  ref?: Ref<HTMLButtonElement>;
  className?: string;
}) {
  const bar = "absolute left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-current transition-all duration-200";
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={open ? "Tutup menu" : badge ? `Buka menu, ${badge} perlu perhatian` : "Buka menu"}
      className={`relative h-11 w-11 flex-none rounded-xl border border-line2 text-white hover:border-faint ${className}`}
    >
      <span aria-hidden className={`${bar} ${open ? "top-1/2 -translate-y-1/2 rotate-45" : "top-[15px]"}`} />
      <span aria-hidden className={`${bar} top-1/2 -translate-y-1/2 ${open ? "opacity-0" : ""}`} />
      <span aria-hidden className={`${bar} ${open ? "top-1/2 -translate-y-1/2 -rotate-45" : "bottom-[15px]"}`} />
      {badge > 0 && !open && (
        <span aria-hidden className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rasp px-1 text-[11px] font-semibold leading-none">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}
