import type { Metadata } from "next";
import { Geist, Geist_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";

const geistSans = IBM_Plex_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Beatmarker – Auto Beat & Drop Markers for Video Editing",
  description: "Automatically detect beats and drops in audio and generate timeline markers for DaVinci Resolve, Premiere Pro, and other video editors.",
  openGraph: {
    title: "Beatmarker – Auto Beat & Drop Markers",
    description: "Upload audio and instantly generate beat and drop markers for your video timeline.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Beatmarker – Auto Beat & Drop Markers",
    description: "Automatically detect beats and drops and generate timeline markers for faster video editing.",
  }
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`relative ${geistSans.className} ${geistMono.variable} antialiased`}
      >
        <Suspense>{children}</Suspense>
      </body>
    </html>
  );
}
