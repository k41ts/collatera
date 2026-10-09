import type { Metadata } from "next";
import { JetBrains_Mono, Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-poppins" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400"], variable: "--font-mono-face" });

export const metadata: Metadata = {
  title: "PiutangChain",
  description: "Surat piutang yang ditandatangani berdua, dicatat di blockchain, dan ditagih sampai lunas.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body className={`${poppins.variable} ${mono.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
