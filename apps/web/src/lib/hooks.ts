"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./client";

export type NoteSummary = {
  id: string;
  code: string;
  title: string;
  debtType: string;
  status: string;
  role: "creditor" | "debtor" | null;
  party: string;
  totalOwed: string;
  principal: string;
  paid: string;
  installmentCount: number;
  paidInstallments: number;
  nextDue: string | null;
  disbursement: string;
  lateFeeBps: number;
  version: number;
  mySignature: boolean;
  isCreator: boolean;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unread: number;
  updatedAt: string;
};

export type Me = {
  user: {
    id: string;
    wallet: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    phoneVerifiedAt: string | null;
    lastFaucetAt: string | null;
    notifyH3: boolean;
    notifyH0: boolean;
    notifyPayment: boolean;
    notifyChat: boolean;
    createdAt: string;
  };
  balance: string;
  stats: { asCreditor: number; asDebtor: number; paid: number };
};

/** Fetch JSON + refresh manual + polling opsional. */
export function useApi<T>(path: string | null, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);

  const refresh = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    refresh();
    if (!pollMs) return;
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  return { data, error, loading, refresh, setData };
}

/** Status piutang yang menunggu tanda tangan user ini. */
export const needsMySignature = (n: NoteSummary) => n.status === "PENDING_SIGNATURE" && !n.mySignature && !!n.role;
