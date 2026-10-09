import { LinkButton } from "@/components/ui";
import SiteHeader from "@/components/SiteHeader";
import { ADDR, addressUrl } from "@/lib/chain/config";

const TAGS = [
  { t: "Tanda tangan", c: "bg-pink text-pink-ink", s: "left-[6%] top-[34%] rotate-12" },
  { t: "Cicilan", c: "bg-lav text-lav-ink", s: "left-[60%] top-[30%] -rotate-[22deg]" },
  { t: "Pinjaman teman", c: "bg-mint text-mint-ink", s: "-left-[6%] top-[52%] rotate-[70deg]" },
  { t: "Jatuh tempo", c: "bg-butter text-butter-ink", s: "left-[48%] top-[45%] rotate-[14deg]" },
  { t: "Invoice usaha", c: "bg-lav text-lav-ink", s: "left-[14%] top-[61%] -rotate-6" },
  { t: "Bukti digital", c: "bg-mint text-mint-ink", s: "left-[56%] top-[63%] -rotate-[18deg]" },
  { t: "Pengingat H-3", c: "bg-peach text-peach-ink", s: "left-[40%] top-[79%] rotate-[9deg]" },
  { t: "Lunas", c: "bg-cyan text-cyan-ink", s: "left-[8%] top-[81%] -rotate-[10deg]" },
];

const STEPS = [
  { n: "1", t: "Buat draft", b: "Isi nominal, jadwal cicilan, dan upload kuitansi atau invoice. Undang pihak lawan lewat alamat wallet.", c: "bg-lav text-lav-ink" },
  { n: "2", t: "Tanda tangan berdua", b: "Pihak lawan bisa setuju, minta revisi, atau menolak. Setiap revisi membatalkan tanda tangan lama.", c: "bg-pink text-pink-ink" },
  { n: "3", t: "Dana cair, bukti terbit", b: "Dana escrow langsung masuk ke debitur dan bukti digital piutang terbit di wallet kreditur.", c: "bg-mint text-mint-ink" },
  { n: "4", t: "Cicil sampai lunas", b: "Bayar dengan stablecoin atau transfer bank. Sisa nol, bukti lunas tercatat untuk kedua pihak.", c: "bg-butter text-butter-ink" },
];

const FEATURES = [
  { tag: "TANDA TANGAN", t: "Aktif hanya setelah dua tanda tangan", b: "Kreditur dan debitur menandatangani isi yang sama persis. Satu dokumen tidak bisa jadi dua piutang.", c: "bg-brand-soft text-lav" },
  { tag: "PEMBAYARAN", t: "Stablecoin atau transfer bank", b: "Bayar on-chain langsung mengurangi sisa utang. Transfer bank tercatat setelah kreditur mengonfirmasi bukti.", c: "bg-[#1e3324] text-mint" },
  { tag: "DENDA", t: "Denda 2% per bulan, dihitung kontrak", b: "Hanya jika disepakati. Dihitung per hari dari cicilan yang terlambat dan berhenti saat sengketa.", c: "bg-[#3a3017] text-butter" },
  { tag: "SENGKETA", t: "Ada masalah? Ajukan sengketa", b: "Admin meninjau riwayat, tapi tidak bisa mengubah isi perjanjian. Perubahan hanya lewat revisi berdua.", c: "bg-[#3a1626] text-pink" },
  { tag: "PRIVASI", t: "Data pribadi tidak masuk blockchain", b: "Nama, nomor HP, dan dokumen disimpan di server. Yang dikunci on-chain hanya hash dan nominal.", c: "bg-[#13303a] text-cyan" },
];

const FAQ = [
  { q: "Apakah saya perlu membeli crypto?", a: "Tidak. Kamu cukup punya wallet MetaMask di jaringan Sepolia. Semua biaya jaringan dibayar relayer PiutangChain." },
  { q: "Apakah ini pinjaman online?", a: "Bukan. PiutangChain hanya mencatat perjanjian antara pihak yang sudah saling kenal. Kami tidak menyalurkan dana." },
  { q: "Bagaimana kalau debitur bayar lewat transfer bank?", a: "Debitur upload bukti transfer, lalu kreditur mengonfirmasi dengan tanda tangan. Pembayaran tercatat setelah itu." },
  { q: "Bisa diubah setelah ditandatangani?", a: "Hanya lewat revisi yang ditandatangani ulang kedua pihak. Perubahan sepihak terdeteksi dan piutang dibekukan." },
];

export default function Landing() {
  return (
    <div className="overflow-x-clip px-4 pb-12 sm:px-6">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-16 sm:gap-24 lg:gap-28">
        <SiteHeader />

        <section className="-mt-6 flex flex-wrap items-center gap-10 sm:mt-0 lg:gap-12">
          <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-6 sm:gap-7">
            <span className="self-start rounded-lg bg-raised px-3.5 py-2 text-xs text-lav">Surat piutang digital · Ethereum Sepolia</span>
            <h1 className="text-[clamp(34px,8vw,64px)] font-semibold leading-[1.05] tracking-[-0.035em]">
              Utang jelas.<br />Tagihan <span className="text-lav">tercatat</span>.<br />Lunas <span className="text-rasp">tuntas</span>.
            </h1>
            <p className="max-w-[520px] text-base leading-relaxed text-muted sm:text-lg">
              Buat surat piutang untuk <strong className="font-semibold text-white">pinjaman teman, keluarga, atau invoice usaha</strong>. Kedua pihak tanda tangan, cicilan dipantau, dan bukti lunas tercatat. <strong className="font-semibold text-white">Tanpa bayar gas.</strong>
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <LinkButton href="/masuk" className="min-h-[52px] px-7">Masuk dengan MetaMask →</LinkButton>
              <LinkButton href="#cara-kerja" variant="secondary" className="min-h-[52px] px-7">Lihat cara kerja</LinkButton>
            </div>
          </div>
          <div className="relative h-[380px] min-w-0 flex-[1_1_520px] overflow-hidden rounded-[24px] bg-brand sm:h-[460px] sm:rounded-[32px] lg:h-[520px]">
            <div className="absolute inset-x-5 bottom-0 top-6 overflow-hidden rounded-t-[20px] border-[6px] border-b-0 border-[#2c2e38] bg-[#191a21] sm:inset-x-10 sm:top-10">
              <div className="px-5 pt-6 text-center sm:px-7 sm:pt-8">
                <div className="text-[clamp(28px,4vw,44px)] font-semibold tracking-tight text-lav">piutangchain</div>
                <div className="mt-1.5 text-[13px] text-soft">Surat piutang yang ditandatangani berdua</div>
              </div>
              {TAGS.map((x) => (
                <span key={x.t} className={`absolute whitespace-nowrap rounded-[12px] px-3.5 py-2 text-[15px] font-medium shadow-[0_10px_24px_rgba(0,0,0,0.35)] sm:rounded-[14px] sm:px-5 sm:py-3 sm:text-[22px] ${x.c} ${x.s}`}>{x.t}</span>
              ))}
            </div>
          </div>
        </section>

        <section id="cara-kerja" className="flex flex-col gap-7 sm:gap-10">
          <h2 className="max-w-[640px] text-[28px] font-normal leading-tight tracking-tight text-muted sm:text-4xl">
            Dari <strong className="font-semibold text-white">draft</strong> sampai <strong className="font-semibold text-white">lunas</strong> dalam empat langkah.
          </h2>
          <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-3 sm:gap-4">
            {STEPS.map((s) => (
              <li key={s.n} className="flex flex-col gap-3.5 rounded-[20px] border border-line bg-card p-5 sm:p-6">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl font-semibold ${s.c}`}>{s.n}</span>
                <span className="text-lg font-semibold">{s.t}</span>
                <span className="text-sm leading-relaxed text-muted">{s.b}</span>
              </li>
            ))}
          </ol>
        </section>

        <section id="fitur" className="flex flex-col gap-7 sm:gap-10">
          <h2 className="max-w-[760px] text-[28px] font-normal leading-tight tracking-tight text-muted sm:text-4xl">
            Alat yang <strong className="font-semibold text-white">sederhana</strong> untuk menjaga utang tetap <strong className="font-semibold text-white">jelas dan adil</strong> bagi kedua pihak.
          </h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-3 sm:gap-4">
            <div className="flex min-h-[220px] flex-col gap-3.5 rounded-[20px] bg-brand p-5 sm:p-7">
              <span className="self-start rounded-lg bg-white/15 px-3 py-1.5 text-[13px] font-medium">Tanpa gas</span>
              <span className="text-[22px] font-semibold leading-snug">Kamu cukup tanda tangan. Biaya jaringan kami yang tanggung.</span>
              <span className="text-sm leading-relaxed text-brand-tint">Tanda tangan, bayar cicilan, dan konfirmasi berjalan lewat relayer.</span>
            </div>
            {FEATURES.map((f) => (
              <div key={f.tag} className="flex flex-col gap-3.5 rounded-[20px] border border-line bg-card p-5 sm:p-7">
                <span className={`self-start rounded-md px-2.5 py-1 text-[11px] font-semibold tracking-wider ${f.c}`}>{f.tag}</span>
                <span className="text-lg font-semibold leading-snug">{f.t}</span>
                <span className="text-sm leading-relaxed text-muted">{f.b}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="integritas" className="flex flex-wrap items-center gap-8 lg:gap-12">
          <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-5">
            <h2 className="text-[28px] font-normal leading-tight tracking-tight text-muted sm:text-4xl">
              Data diubah diam-diam? <strong className="font-semibold text-white">Langsung ketahuan.</strong>
            </h2>
            <p className="leading-relaxed text-muted">
              Isi perjanjian dan dokumen disimpan di server, tapi sidik jarinya (hash) dikunci di blockchain. Kapan pun hash dihitung ulang dan dibandingkan. Kalau berbeda, piutang <strong className="font-semibold text-white">dibekukan</strong> sampai admin memeriksa.
            </p>
          </div>
          <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-3 rounded-[20px] border border-line bg-card p-5 text-sm sm:p-6">
            <span className="text-faint">Kontrak di Sepolia</span>
            {Object.entries(ADDR).map(([k, v]) => (
              <a key={k} href={addressUrl(v) ?? "#"} target="_blank" rel="noreferrer" className="flex flex-wrap justify-between gap-2 border-t border-line pt-3 text-soft no-underline hover:text-white">
                <span className="font-medium text-white">{k}</span>
                <span className="font-mono [overflow-wrap:anywhere]">{v}</span>
              </a>
            ))}
          </div>
        </section>

        <section id="faq" className="flex flex-col gap-6">
          <h2 className="text-[28px] font-semibold tracking-tight sm:text-4xl">Pertanyaan umum</h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-4">
            {FAQ.map((f) => (
              <div key={f.q} className="flex flex-col gap-2 border-t border-line pt-5">
                <span className="font-semibold">{f.q}</span>
                <span className="text-sm leading-relaxed text-muted">{f.a}</span>
              </div>
            ))}
          </div>
        </section>

        <footer className="flex flex-wrap justify-between gap-4 border-t border-line pt-7 text-[13px] text-faint">
          <span>PiutangChain adalah alat pencatatan perjanjian antar pihak yang saling kenal, bukan marketplace pinjaman.</span>
          <span>Prototipe hackathon · Ethereum Sepolia testnet</span>
        </footer>
      </div>
    </div>
  );
}
