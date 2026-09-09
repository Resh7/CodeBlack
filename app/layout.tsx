import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Batch Operations Control Center",
  description:
    "Monitor, validate, and analyze enterprise batch operations from one secure workspace.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="studio-theme antialiased">{children}</body>
    </html>
  );
}
