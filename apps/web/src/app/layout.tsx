import type { Metadata } from "next";
import { Caveat, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-jakarta" });
const hand = Caveat({ subsets: ["latin"], weight: ["700"], variable: "--font-hand-face" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400"], variable: "--font-mono-face" });

export const metadata: Metadata = {
  title: "Collatera",
  description: "Surat piutang yang ditandatangani berdua, dicatat di blockchain, dan ditagih sampai lunas.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body className={`${jakarta.variable} ${mono.variable} ${hand.variable} font-sans antialiased`}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
