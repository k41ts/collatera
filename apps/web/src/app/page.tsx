import { LinkButton } from "@/components/ui";
import SiteHeader from "@/components/SiteHeader";
import { ADDR, addressUrl } from "@/lib/chain/config";

// Tag melayang di panel hero: putih, outline, atau abu (tanpa warna).
const TAGS = [
  { t: "Tanda tangan", c: "bg-white text-ink", s: "left-[6%] top-[34%] rotate-12" },
  { t: "Cicilan", c: "border-2 border-white bg-[#161616] text-white", s: "left-[60%] top-[30%] -rotate-[22deg]" },
  { t: "Pinjaman teman", c: "bg-[#d9d9d9] text-ink", s: "-left-[6%] top-[52%] rotate-[70deg]" },
  { t: "Jatuh tempo", c: "bg-white text-ink", s: "left-[48%] top-[45%] rotate-[14deg]" },
  { t: "Invoice usaha", c: "border-2 border-white bg-[#161616] text-white", s: "left-[14%] top-[61%] -rotate-6" },
  { t: "Bukti digital", c: "bg-[#d9d9d9] text-ink", s: "left-[56%] top-[63%] -rotate-[18deg]" },
  { t: "Pengingat H-3", c: "bg-white text-ink", s: "left-[40%] top-[79%] rotate-[9deg]" },
  { t: "Lunas", c: "border-2 border-white bg-[#161616] text-white", s: "left-[8%] top-[81%] -rotate-[10deg]" },
];

const STEPS = [
  { n: "1", t: "Buat draft", b: "Isi nominal, jadwal cicilan, dan upload kuitansi atau invoice. Undang pihak lawan lewat alamat wallet." },
  { n: "2", t: "Tanda tangan berdua", b: "Pihak lawan bisa setuju, minta revisi, atau menolak. Setiap revisi membatalkan tanda tangan lama." },
  { n: "3", t: "Dana cair, bukti terbit", b: "Dana escrow langsung masuk ke debitur dan bukti digital piutang terbit di wallet kreditur." },
  { n: "4", t: "Cicil sampai lunas", b: "Bayar cicilan dengan stablecoin IDRX. Sisa nol, bukti lunas tercatat untuk kedua pihak." },
];

const FEATURES = [
  { tag: "TANDA TANGAN", t: "Aktif hanya setelah dua tanda tangan", b: "Kreditur dan debitur menandatangani isi yang sama persis. Satu dokumen tidak bisa jadi dua piutang." },
  { tag: "PEMBAYARAN", t: "Bayar cicilan pakai stablecoin", b: "Pembayaran IDRX langsung tercatat di blockchain dan mengurangi sisa utang. Setiap pembayaran dikenai fee aplikasi 1%." },
  { tag: "DENDA", t: "Denda 2% per bulan, dihitung kontrak", b: "Hanya jika disepakati. Dihitung per hari dari cicilan yang terlambat dan berhenti saat sengketa." },
  { tag: "SENGKETA", t: "Ada masalah? Ajukan sengketa", b: "Admin meninjau riwayat, tapi tidak bisa mengubah isi perjanjian. Perubahan hanya lewat revisi berdua." },
  { tag: "PRIVASI", t: "Data pribadi tidak masuk blockchain", b: "Nama, nomor HP, dan dokumen disimpan di server. Yang dikunci on-chain hanya hash dan nominal." },
];

const FAQ = [
  { q: "Apakah saya perlu membeli crypto?", a: "Tidak. Kamu cukup punya wallet MetaMask di jaringan Sepolia. Biaya jaringan (gas) dibayar relayer Collatera." },
  { q: "Apakah ini pinjaman online?", a: "Bukan. Collatera hanya mencatat perjanjian antara pihak yang sudah saling kenal. Kami tidak menyalurkan dana." },
  { q: "Ada biaya apa saja?", a: "Gas ditanggung relayer. Debitur membayar fee aplikasi 1% di atas setiap pembayaran cicilan, jadi kreditur tetap menerima nominal penuh." },
  { q: "Bisa diubah setelah ditandatangani?", a: "Hanya lewat revisi yang ditandatangani ulang kedua pihak. Perubahan sepihak terdeteksi dan piutang dibekukan." },
];

/* ---------- doodle: coretan tangan (dekorasi, disembunyikan dari pembaca layar) ---------- */

const Star = ({ className = "", stroke = "currentColor" }: { className?: string; stroke?: string }) => (
  <svg aria-hidden viewBox="0 0 64 64" fill="none" className={className}>
    <path d="M32 6 C 33 22, 36 29, 58 32 C 36 35, 33 42, 32 58 C 31 42, 28 35, 6 32 C 28 29, 31 22, 32 6 Z" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" />
  </svg>
);

/** Lingkaran coretan di sekeliling nomor langkah. */
const CircleScribble = ({ stroke = "currentColor" }: { stroke?: string }) => (
  <svg aria-hidden viewBox="0 0 44 44" fill="none" className="absolute inset-0">
    <path d="M30 5 C 14 2, 3 12, 4 24 C 5 36, 18 42, 28 39 C 40 35, 42 20, 36 11 C 32 6, 24 4, 18 6" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

export default function Landing() {
  return (
    <div className="overflow-x-clip px-4 pb-12 sm:px-6">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-16 sm:gap-24 lg:gap-28">
        <SiteHeader />

        <section className="-mt-6 flex flex-wrap items-center gap-10 sm:mt-0 lg:gap-12">
          <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-6 sm:gap-7">
            <span className="self-start rounded-full bg-card px-3.5 py-2 text-xs font-semibold">Surat piutang digital · Ethereum Sepolia</span>
            <h1 className="text-[clamp(36px,8vw,68px)] font-extrabold leading-[1.08] tracking-[-0.045em]">
              Utang jelas.<br />
              Tagihan{" "}
              <span className="relative inline-block">
                tercatat
                <svg aria-hidden viewBox="0 0 240 24" preserveAspectRatio="none" fill="none" className="absolute -bottom-3 -left-1 h-5 w-[calc(100%+8px)]">
                  <path d="M4 14 C 30 4, 52 22, 80 12 S 132 4, 160 13 S 212 20, 236 8" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
                </svg>
              </span>
              .<br />
              Lunas{" "}
              <span className="relative inline-block px-1.5">
                tuntas
                <svg aria-hidden viewBox="0 0 260 110" preserveAspectRatio="none" fill="none" className="absolute -left-3.5 -top-2.5 h-[calc(100%+22px)] w-[calc(100%+28px)]">
                  <path d="M150 8 C 60 2, 8 24, 10 56 C 12 92, 96 104, 170 98 C 236 92, 258 66, 248 40 C 238 14, 170 4, 104 12" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
                </svg>
              </span>
              .
            </h1>
            <p className="max-w-[520px] text-base leading-relaxed text-[#4a4a4a] sm:text-lg">
              Buat surat piutang untuk <strong className="font-semibold text-ink">pinjaman teman, keluarga, atau invoice usaha</strong>. Kedua pihak tanda tangan, cicilan dipantau, dan bukti lunas tercatat. <strong className="font-semibold text-ink">Tanpa bayar gas</strong>, cukup fee aplikasi 1% saat debitur membayar pakai IDRX.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <LinkButton href="/masuk" className="min-h-[54px] px-7 text-[15px] font-bold">Masuk dengan MetaMask →</LinkButton>
              <LinkButton href="#cara-kerja" variant="secondary" className="min-h-[54px] border-ink px-7 text-[15px] font-bold">Lihat cara kerja</LinkButton>
            </div>
          </div>
          <div className="relative h-[380px] min-w-0 flex-[1_1_520px] overflow-hidden rounded-[24px] bg-ink sm:h-[460px] sm:rounded-[32px] lg:h-[520px]">
            <Star className="absolute left-5 top-5 h-12 w-12 sm:h-16 sm:w-16" stroke="#fff" />
            <svg aria-hidden width="120" height="40" viewBox="0 0 120 40" fill="none" className="absolute right-6 top-4 max-sm:hidden">
              <path d="M4 30 C 14 6, 24 6, 30 22 S 46 38, 54 18 S 72 2, 80 22 S 100 36, 116 10" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <div className="absolute inset-x-5 bottom-0 top-8 overflow-hidden rounded-t-[20px] border-[6px] border-b-0 border-[#2c2c2c] bg-[#161616] sm:inset-x-10 sm:top-[52px]">
              <div className="px-5 pt-6 text-center sm:px-7 sm:pt-8">
                <div className="text-[clamp(28px,4vw,46px)] font-extrabold tracking-[-0.04em] text-white">Collatera</div>
                <div className="mt-1.5 text-[13px] text-brand-tint">Surat piutang yang ditandatangani berdua</div>
              </div>
              {TAGS.map((x) => (
                <span key={x.t} className={`absolute whitespace-nowrap rounded-[12px] px-3.5 py-2 text-[15px] font-bold shadow-[0_10px_24px_rgba(0,0,0,0.45)] sm:rounded-[14px] sm:px-5 sm:py-3 sm:text-[22px] ${x.c} ${x.s}`}>{x.t}</span>
              ))}
              <svg aria-hidden width="46" height="46" viewBox="0 0 46 46" fill="none" className="absolute bottom-[110px] right-7">
                <circle cx="23" cy="23" r="17" stroke="#fff" strokeWidth="2.5" strokeDasharray="6 6" />
              </svg>
            </div>
          </div>
        </section>

        <section id="cara-kerja" className="flex flex-col gap-7 sm:gap-10">
          <div className="flex flex-wrap items-end gap-4">
            <h2 className="max-w-[640px] text-[28px] font-medium leading-tight tracking-[-0.03em] text-muted sm:text-[38px]">
              Dari <strong className="font-extrabold text-ink">draft</strong> sampai <strong className="font-extrabold text-ink">lunas</strong> dalam empat langkah.
            </h2>
            <svg aria-hidden width="140" height="70" viewBox="0 0 140 70" fill="none" className="max-sm:hidden">
              <path d="M6 14 C 30 70, 70 66, 82 40 C 90 22, 70 14, 64 30 C 58 48, 92 62, 128 50" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M116 42 L129 50 L118 61" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-3 sm:gap-4">
            {STEPS.map((s, i) => {
              const last = i === STEPS.length - 1;
              return (
                <li key={s.n} className={`flex flex-col gap-3.5 rounded-[24px] p-5 sm:p-6 ${last ? "bg-ink" : "bg-card"}`}>
                  <span className="relative flex h-11 w-11 items-center justify-center text-lg font-extrabold">
                    {s.n}
                    <CircleScribble stroke={last ? "#fff" : "#0a0a0a"} />
                  </span>
                  <span className="text-lg font-extrabold">{s.t}</span>
                  <span className={`text-sm leading-relaxed ${last ? "text-brand-tint" : "text-muted"}`}>{s.b}</span>
                </li>
              );
            })}
          </ol>
        </section>

        <section id="fitur" className="flex flex-col gap-7 sm:gap-10">
          <h2 className="max-w-[760px] text-[28px] font-medium leading-tight tracking-[-0.03em] text-muted sm:text-[38px]">
            Alat yang <strong className="font-extrabold text-ink">sederhana</strong> untuk menjaga utang tetap{" "}
            <span className="relative inline-block">
              <strong className="font-extrabold text-ink">jelas dan adil</strong>
              <svg aria-hidden viewBox="0 0 240 16" preserveAspectRatio="none" fill="none" className="absolute -bottom-2 left-0 h-3 w-full">
                <path d="M3 10 C 60 3, 150 4, 237 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                <path d="M20 14 C 90 9, 160 10, 220 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>{" "}
            bagi kedua pihak.
          </h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-3 sm:gap-4">
            <div className="relative flex min-h-[220px] flex-col gap-3.5 overflow-hidden rounded-[24px] bg-ink p-5 pb-20 sm:p-7 sm:pb-20">
              <span className="self-start rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-semibold">Tanpa gas</span>
              <span className="text-[22px] font-extrabold leading-snug tracking-[-0.02em]">Kamu cukup tanda tangan. Biaya jaringan kami yang tanggung.</span>
              <span className="text-sm leading-relaxed text-brand-tint">Tanda tangan, bayar cicilan, dan konfirmasi berjalan lewat relayer. Biaya yang ada hanya fee aplikasi 1% dari tiap pembayaran IDRX, dibayar debitur.</span>
              <Star className="absolute bottom-4 right-4 h-14 w-14" stroke="#fff" />
            </div>
            {FEATURES.map((f) => (
              <div key={f.tag} className="flex flex-col gap-3.5 rounded-[24px] bg-card p-5 sm:p-7">
                <span className="self-start rounded-full border-[1.5px] border-ink px-2.5 py-1 text-[11px] font-extrabold tracking-wider">{f.tag}</span>
                <span className="text-lg font-extrabold leading-snug">{f.t}</span>
                <span className="text-sm leading-relaxed text-muted">{f.b}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="integritas" className="flex flex-wrap items-center gap-8 lg:gap-12">
          <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-5">
            <h2 className="text-[28px] font-medium leading-tight tracking-[-0.03em] text-muted sm:text-[38px]">
              Data diubah diam-diam? <strong className="font-extrabold text-ink">Langsung ketahuan.</strong>
            </h2>
            <p className="leading-relaxed text-[#4a4a4a]">
              Isi perjanjian dan dokumen disimpan di server, tapi sidik jarinya (hash) dikunci di blockchain. Kapan pun hash dihitung ulang dan dibandingkan. Kalau berbeda, piutang <strong className="font-semibold text-ink">dibekukan</strong> sampai admin memeriksa.
            </p>
            <span aria-hidden className="flex items-center gap-2 self-end max-sm:hidden">
              <span className="-rotate-[4deg] font-hand text-[26px] font-bold">dikunci on-chain</span>
              <svg width="70" height="40" viewBox="0 0 70 40" fill="none">
                <path d="M4 30 C 24 36, 46 30, 62 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                <path d="M50 10 L63 11 L61 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
          <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-3 rounded-[24px] bg-card p-5 text-sm sm:p-6">
            <span className="text-muted">Kontrak di Sepolia</span>
            {Object.entries(ADDR).map(([k, v]) => (
              <a key={k} href={addressUrl(v) ?? "#"} target="_blank" rel="noreferrer" className="flex flex-wrap justify-between gap-2 border-t border-line pt-3 text-soft no-underline hover:text-ink">
                <span className="font-bold text-ink">{k}</span>
                <span className="font-mono text-[13px] [overflow-wrap:anywhere]">{v}</span>
              </a>
            ))}
          </div>
        </section>

        <section id="faq" className="flex flex-col gap-6">
          <div className="flex items-center gap-3.5">
            <h2 className="text-[28px] font-extrabold tracking-[-0.035em] sm:text-[38px]">Pertanyaan umum</h2>
            <svg aria-hidden width="44" height="54" viewBox="0 0 44 54" fill="none">
              <path d="M10 16 C 10 4, 34 2, 34 16 C 34 26, 22 26, 22 36" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              <circle cx="22" cy="47" r="2.8" fill="currentColor" />
            </svg>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-4">
            {FAQ.map((f) => (
              <div key={f.q} className="flex flex-col gap-2 border-t-[1.5px] border-ink pt-5">
                <span className="font-extrabold">{f.q}</span>
                <span className="text-sm leading-relaxed text-muted">{f.a}</span>
              </div>
            ))}
          </div>
        </section>

        <footer className="flex flex-wrap justify-between gap-4 border-t border-line2 pt-7 text-[13px] text-muted">
          <span>Collatera adalah alat pencatatan perjanjian antar pihak yang saling kenal, bukan marketplace pinjaman.</span>
          <span>Prototipe hackathon · Ethereum Sepolia testnet</span>
        </footer>
      </div>
    </div>
  );
}
