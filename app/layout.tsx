import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { brand } from "@/lib/brand";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: brand.product,
  description: `DISPO & Aged Stock data management for ${brand.company === "OuterJoin" ? "OuterJoin" : "iRam / OuterJoin"}`,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // Brand colours override globals.css's :root values (inline wins).
      style={{
        "--color-primary": brand.colors.primary,
        "--color-primary-dark": brand.colors.primaryDark,
        "--color-secondary": brand.colors.secondary,
        "--color-accent": brand.colors.accent,
      } as React.CSSProperties}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
