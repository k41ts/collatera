"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Avatar, StatusPill, input } from "@/components/ui";
import { api } from "@/lib/client";
import { useApi, type NoteSummary } from "@/lib/hooks";

type Msg = { id: string; body: string; link: string | null; createdAt: string; kind: "me" | "them" | "event"; sender: string | null };

const time = (d: string) => {
  const x = new Date(d);
  const today = new Date().toDateString() === x.toDateString();
  return x.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", ...(today ? {} : { day: "numeric", month: "short" }), hour: "2-digit", minute: "2-digit" });
};

function ChatInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: list, refresh: refreshList } = useApi<{ notes: NoteSummary[] }>("/api/notes", 10000);
  const [q, setQ] = useState("");
  const convos = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return (list?.notes ?? [])
      .filter((n) => n.role && (!qq || `${n.party} ${n.title} ${n.code}`.toLowerCase().includes(qq)))
      .sort((a, b) => new Date(b.lastMessageAt ?? b.updatedAt).getTime() - new Date(a.lastMessageAt ?? a.updatedAt).getTime());
  }, [list, q]);
  const activeId = params.get("note") ?? convos[0]?.id ?? null;
  const active = list?.notes.find((n) => n.id === activeId) ?? null;
  const { data: thread, refresh } = useApi<{ messages: Msg[] }>(activeId ? `/api/notes/${activeId}/messages` : null, 5000);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length]);
  useEffect(() => { refreshList(); }, [thread?.messages.length, refreshList]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || !activeId) return;
    setSending(true);
    setError(null);
    try {
      await api(`/api/notes/${activeId}/messages`, { method: "POST", json: { body: t } });
      setDraft("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const quick = active?.status === "PENDING_SIGNATURE"
    ? ["Oke, aku review dulu ya", "Bisa jadwalnya diubah?", "Sudah aku tanda tangani"]
    : active?.role === "debtor"
      ? ["Sudah saya bayar", "Boleh minta mundur beberapa hari?", "Terima kasih"]
      : ["Sudah saya cek, terima kasih", "Saya cek mutasi dulu ya", "Kapan bisa dibayar?"];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-faint">Satu percakapan untuk setiap surat piutang</span>
        <h1 className="text-[32px] font-semibold tracking-tight">Chat</h1>
      </div>

      <div className="flex flex-wrap items-stretch gap-4">
        <section aria-label="Daftar percakapan" className="flex min-w-0 flex-[1_1_300px] flex-col gap-2.5 rounded-[20px] border border-line bg-card p-3.5 lg:max-w-[360px]">
          <label htmlFor="cari-chat" className="sr-only">Cari percakapan</label>
          <input id="cari-chat" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama atau piutang" className={`${input} text-[13px]`} />
          {convos.length === 0 && <p className="p-3 text-sm text-muted">Belum ada percakapan. Chat muncul untuk setiap surat piutang kamu.</p>}
          {convos.map((c) => {
            const on = c.id === activeId;
            return (
              <button key={c.id} type="button" aria-pressed={on} onClick={() => router.replace(`/app/chat?note=${c.id}`)} className={`flex w-full items-start gap-3 rounded-[14px] border p-3 text-left ${on ? "border-brand bg-brand-soft" : "border-transparent hover:bg-raised"}`}>
                <Avatar name={c.party} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex justify-between gap-2"><span className="truncate text-sm font-semibold">{c.party}</span><span className="flex-none text-[11px] text-faint">{c.lastMessageAt ? time(c.lastMessageAt) : ""}</span></span>
                  <span className="truncate text-xs text-soft">{c.code} · {c.title}</span>
                  <span className="truncate text-xs text-faint">{c.lastMessage ?? "Belum ada pesan"}</span>
                </span>
                {c.unread > 0 && !on && <span className="flex h-5 min-w-5 flex-none items-center justify-center self-center rounded-full bg-rasp px-1 text-[11px] font-semibold" aria-label={`${c.unread} pesan belum dibaca`}>{c.unread}</span>}
              </button>
            );
          })}
        </section>

        <section aria-label="Percakapan" className="flex min-h-[560px] min-w-0 flex-[999_1_480px] flex-col overflow-hidden rounded-[20px] border border-line bg-card">
          {!active ? (
            <p className="m-auto p-6 text-sm text-muted">Pilih percakapan di kiri.</p>
          ) : (
            <>
              <header className="flex flex-wrap items-center gap-3 border-b border-line px-4.5 py-4">
                <Avatar name={active.party} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">{active.party}</span>
                  <span className="truncate text-xs text-faint">{active.code} · {active.title} · kamu {active.role === "creditor" ? "kreditur" : "debitur"}</span>
                </div>
                <StatusPill status={active.status} />
                <Link href={`/app/piutang/${active.id}`} className="inline-flex min-h-10 items-center rounded-full border border-line2 px-3.5 text-[13px] font-medium text-white no-underline">Lihat detail piutang</Link>
              </header>
              <div className="mx-4 mt-3.5 rounded-xl bg-raised px-3 py-2.5 text-xs leading-relaxed text-muted">
                Chat tersimpan di server PiutangChain, bukan di blockchain, dan <strong className="font-semibold text-white">tidak mengubah isi perjanjian</strong>. Perubahan nominal atau jadwal tetap lewat revisi yang ditandatangani berdua.
              </div>
              <ol aria-label="Pesan" aria-live="polite" className="flex max-h-[60vh] min-h-[320px] flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
                {(thread?.messages ?? []).map((m) =>
                  m.kind === "event" ? (
                    <li key={m.id} className="flex justify-center">
                      <div className="flex flex-wrap items-center justify-center gap-2 rounded-full border border-line bg-midnight px-3.5 py-1.5 text-center text-xs text-soft">
                        <span>{m.body}</span><span className="text-faint">· {time(m.createdAt)}</span>
                        {m.link && <Link href={m.link} className="font-medium text-lav">Lihat</Link>}
                      </div>
                    </li>
                  ) : (
                    <li key={m.id} className={`flex ${m.kind === "me" ? "justify-end" : "justify-start"}`}>
                      <div className={`flex max-w-[72%] flex-col gap-1 px-3.5 py-2.5 ${m.kind === "me" ? "rounded-[16px_16px_4px_16px] bg-brand" : "rounded-[16px_16px_16px_4px] bg-bubble"}`}>
                        <span className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{m.body}</span>
                        <span className={`self-end text-[11px] ${m.kind === "me" ? "text-brand-tint" : "text-faint"}`}>{time(m.createdAt)}</span>
                      </div>
                    </li>
                  ),
                )}
                <li ref={endRef} aria-hidden />
              </ol>
              <div className="flex flex-col gap-2.5 border-t border-line px-4 pb-4 pt-3">
                <div className="flex flex-wrap gap-2">
                  {quick.map((t) => (
                    <button key={t} type="button" disabled={sending} onClick={() => send(t)} className="min-h-9 rounded-full border border-line2 px-3 text-xs text-lav">{t}</button>
                  ))}
                </div>
                {error && <p role="alert" className="text-sm text-pink">{error}</p>}
                <form onSubmit={(e) => { e.preventDefault(); send(draft); }} className="flex items-center gap-2.5">
                  <label htmlFor="pesan" className="sr-only">Tulis pesan</label>
                  <input id="pesan" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Tulis pesan ke ${active.party.split(" ")[0]}…`} autoComplete="off" maxLength={2000} className={`${input} flex-1 text-sm`} />
                  <button type="submit" disabled={sending || !draft.trim()} className="h-[46px] flex-none rounded-xl bg-brand px-5 text-sm font-medium disabled:opacity-50">Kirim</button>
                </form>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatInner />
    </Suspense>
  );
}
