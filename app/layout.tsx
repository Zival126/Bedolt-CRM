import type { Metadata, Viewport } from "next";
import "./globals.css";
import Shell from "@/components/Shell";

// Rendu dynamique partout : nécessaire pour que le nonce CSP (middleware.ts) soit appliqué à chaque page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Bedolt CRM", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#08090a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
