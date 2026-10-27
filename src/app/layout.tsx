import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "World Bank Report Q&A",
  description: "Retrieval-augmented question answering over a World Bank economic report",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
