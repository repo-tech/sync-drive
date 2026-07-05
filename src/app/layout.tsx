import type { Metadata } from "next";
import "./globals.css";
import { SyncProvider } from "@/components/SyncProvider";

export const metadata: Metadata = {
  title: "SyncDoc - Local-First Collaborative Editor",
  description: "Offline-resilient real-time collaborative rich-text editor powered by Yjs CRDTs and Gemini AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased dark"
    >
      <body className="min-h-full flex flex-col bg-[#09090b] text-white">
        <SyncProvider>
          {children}
        </SyncProvider>
      </body>
    </html>
  );
}
