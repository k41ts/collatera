const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const f = require("./fixture");
const { ethers, time, IDR, DAY, Status } = f;

// Regresi hasil review (branch fix/review-hardening). Satu blok describe per tugas.

describe("T1: view konsisten setelah markPaid", () => {
  it("markPaid saat OVERDUE: remaining, overdueAmount, lateFeeOf, getNote semuanya konsisten dengan PAID", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, creditor } = ctx;
    const note = await f.buildNote(ctx);
    await f.activateOnchain(ctx, note);
    await time.increaseTo(Number(note.dueDate) + 20 * DAY);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.OVERDUE);
    const feeBefore = await manager.lateFeeOf(note.noteId);
    expect(feeBefore).to.be.gt(0n);

    const tx = await manager.connect(creditor).markPaid(note.noteId);
    // event waived tetap berisi seluruh sisa (tunggakan + denda) saat ditandai lunas
    const waived = (await manager.queryFilter(manager.filters.NoteMarkedPaid(note.noteId)))[0].args.waived;
    expect(waived).to.be.gte(note.totalOwed + feeBefore);
    await expect(tx).to.emit(manager, "NoteMarkedPaid");

    expect(await manager.statusOf(note.noteId)).to.equal(Status.PAID);
    expect(await manager.remaining(note.noteId)).to.equal(0n);
    expect(await manager.overdueAmount(note.noteId)).to.equal(0n);
    expect(await manager.lateFeeOf(note.noteId)).to.equal(0n);
    const v = await manager.getNote(note.noteId);
    expect(v.lateFeeAccrued).to.equal(0n);
    expect(v.fullyPaid).to.equal(true);
    expect(v.status).to.equal(Status.PAID);

    // tetap 0 setelah waktu berjalan
    await time.increase(60 * DAY);
    expect(await manager.overdueAmount(note.noteId)).to.equal(0n);
    expect(await manager.lateFeeOf(note.noteId)).to.equal(0n);
  });
});
