import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Transfer Yard — Sitecore Content Transfer Console",
  description:
    "A Marketplace Custom App for moving content between Sitecore environments via the Content Transfer API and Item Transfer API.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
