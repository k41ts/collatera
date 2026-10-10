import { getAddress, isAddress } from "ethers";
import { z } from "zod";
import { DECIMALS } from "./chain/config";
import { computeTotal, splitInstallments } from "./notes";
import { rupiahToUnits } from "./money";

export const NoteInput = z
  .object({
    role: z.enum(["creditor", "debtor"]),
    title: z.string().trim().min(3, "Judul minimal 3 huruf").max(120),
    debtType: z.enum(["personal", "business", "invoice", "other"]),
    principal: z.string().regex(/^\d{1,13}$/, "Nominal pokok harus angka rupiah utuh"),
    interestType: z.enum(["none", "percent", "flat"]),
    interestValue: z.string().regex(/^\d+(\.\d{1,2})?$/, "Nilai bunga tidak valid").default("0"),
    installmentCount: z.number().int().min(1).max(24),
    firstDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal jatuh tempo tidak valid"),
    // Diabaikan: bunga keterlambatan 2%/bulan selalu berlaku (lihat lateFeeBps di bawah).
    lateFee: z.boolean().optional(),
    disbursement: z.enum(["onchain", "offchain"]),
    collateralNote: z.string().trim().max(500).default(""),
    counterpartyWallet: z.string().trim().refine(isAddress, "Alamat wallet pihak lawan tidak valid"),
  })
  .refine((v) => Number(v.principal) >= 1000, { message: "Nominal pokok minimal Rp1.000", path: ["principal"] })
  .refine((v) => v.interestType !== "percent" || Number(v.interestValue) <= 100, { message: "Bunga maksimal 100%", path: ["interestValue"] });

export type NoteInputT = z.infer<typeof NoteInput>;

export function deriveNoteFields(v: NoteInputT) {
  const unit = BigInt(10) ** BigInt(DECIMALS);
  const principal = BigInt(rupiahToUnits(v.principal));
  const interestValue = v.interestType === "none" ? "0" : v.interestValue;
  const total = computeTotal(principal, v.interestType, interestValue, unit);
  const firstDue = new Date(v.firstDue + "T00:00:00Z");
  if (firstDue.getTime() < Date.now()) throw new z.ZodError([{ code: "custom", path: ["firstDue"], message: "Jatuh tempo pertama harus setelah hari ini" }]);
  return {
    fields: {
      title: v.title,
      debtType: v.debtType,
      principal: principal.toString(),
      interestType: v.interestType,
      interestValue,
      totalOwed: total.toString(),
      // Wajib untuk semua surat: bunga berjalan selama ada tunggakan, sampai dibayar atau diikhlaskan kreditur.
      lateFeeBps: 200,
      disbursement: v.disbursement,
      collateralNote: v.collateralNote,
      counterpartyWallet: getAddress(v.counterpartyWallet),
    },
    installments: splitInstallments(total, v.installmentCount, firstDue),
  };
}
