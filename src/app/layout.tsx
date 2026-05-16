import type { Metadata } from "next";
import { Handjet, Inter } from "next/font/google";
import Nav from "@/components/layout/nav";
import "./globals.css";

const handjet = Handjet({
  variable: "--font-handjet",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-sfpro",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Crosschain IBC Indexer",
  description:
    "Per-channel IBC transfer analytics for the Cosmos Hub network.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${handjet.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background font-sfpro text-white">
        <Nav />
        {children}
      </body>
    </html>
  );
}
