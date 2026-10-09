import Link from "next/link";
import NoteForm from "@/components/NoteForm";

export default function NewNotePage() {
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="flex gap-2 text-[13px] text-faint">
        <Link href="/app/piutang" className="text-soft no-underline">Piutang saya</Link>
        <span aria-hidden>/</span>
        <span>Buat surat piutang</span>
      </nav>
      <div className="flex flex-col gap-2">
        <h1 className="text-[34px] font-semibold tracking-tight">Buat surat piutang</h1>
        <p className="text-[15px] text-muted">Draft belum mengikat. Piutang baru aktif setelah <strong className="font-semibold text-white">kamu dan pihak lawan sama-sama tanda tangan</strong>.</p>
      </div>
      <NoteForm />
    </div>
  );
}
