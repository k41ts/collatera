// Chat antar pihak (off-chain, tidak mengubah isi perjanjian).
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, ok } from "@/lib/api";
import { displayName, loadNote } from "@/lib/notes";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler<Ctx>(async (_req, user, { params }) => {
  const n = await loadNote((await params).id, user);
  const messages = await db.message.findMany({
    where: { noteId: n.id },
    orderBy: { createdAt: "asc" },
    take: 300,
    include: { sender: true },
  });
  await db.chatRead.upsert({
    where: { userId_noteId: { userId: user.id, noteId: n.id } },
    update: { readAt: new Date() },
    create: { userId: user.id, noteId: n.id, readAt: new Date() },
  });
  return ok({
    messages: messages.map((m) => ({
      id: m.id,
      body: m.body,
      link: m.link,
      createdAt: m.createdAt,
      kind: !m.senderId ? "event" : m.senderId === user.id ? "me" : "them",
      sender: m.sender ? displayName(m.sender) : null,
    })),
  });
});

const Body = z.object({ body: z.string().trim().min(1, "Pesan kosong").max(2000, "Pesan terlalu panjang") });

export const POST = handler<Ctx>(async (req, user, { params }) => {
  const n = await loadNote((await params).id, user);
  const { body } = Body.parse(await req.json());
  const m = await db.message.create({ data: { noteId: n.id, senderId: user.id, body } });
  return ok({ id: m.id }, 201);
});
