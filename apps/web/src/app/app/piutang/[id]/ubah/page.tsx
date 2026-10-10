"use client";
import Link from "next/link";
import { use } from "react";
import NoteForm, { type NoteFormValues } from "@/components/NoteForm";
import { Notice } from "@/components/ui";
import { NoteFormSkeleton } from "@/components/Skeleton";
import { useApi } from "@/lib/hooks";
import { unitsToRupiah } from "@/lib/money";

type Detail = {
  note: {
    id: string; status: string; creatorRole: "creditor" | "debtor"; title: string; debtType: NoteFormValues["debtType"]; principal: string;
    interestType: NoteFormValues["interestType"]; interestValue: string; lateFeeBps: number; disbursement: NoteFormValues["disbursement"];
    collateralNote: string; counterpartyWallet: string | null; installments: { dueDate: string }[];
  };
  me: { isCreator: boolean };
};

export default function EditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error } = useApi<Detail>(`/api/notes/${id}`);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <NoteFormSkeleton />;
  const n = data.note;
  if (!data.me.isCreator || n.status !== "DRAFT") return <Notice tone="warn">Draft ini tidak bisa diubah (hanya pembuat, dan hanya sebelum dikirim).</Notice>;

  const first = new Date(n.installments[0].dueDate);
  const initial: NoteFormValues = {
    role: n.creatorRole,
    title: n.title,
    debtType: n.debtType,
    principal: unitsToRupiah(n.principal).toString(),
    interestType: n.interestType,
    interestValue: n.interestValue,
    installmentCount: n.installments.length,
    firstDue: new Date(first.getTime() + 7 * 3600_000).toISOString().slice(0, 10),
    lateFee: n.lateFeeBps > 0,
    disbursement: n.disbursement,
    collateralNote: n.collateralNote,
    counterpartyWallet: n.counterpartyWallet ?? "",
  };
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="flex gap-2 text-[13px] text-faint">
        <Link href={`/app/piutang/${id}`} className="text-soft no-underline">{n.title}</Link>
        <span aria-hidden>/</span>
        <span>Ubah draft</span>
      </nav>
      <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.035em] [overflow-wrap:anywhere] sm:text-[34px]">Ubah draft</h1>
      <p className="-mt-3 text-sm text-muted">Dokumen yang sudah diupload dikelola di halaman detail. File baru di bawah akan ditambahkan.</p>
      <NoteForm initial={initial} noteId={id} />
    </div>
  );
}
