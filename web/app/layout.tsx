import type { Metadata, Viewport } from "next";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { getResults } from "@/lib/data";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FotoFedele", template: "%s · FotoFedele" },
  description:
    "Prototipo: migliorare con l'AI la qualità tecnica delle foto degli annunci immobiliari, senza alterare la casa.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export const viewport: Viewport = {
  themeColor: "#0074c1",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const results = getResults();
  return (
    <html lang="it" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col font-sans antialiased" suppressHydrationWarning>
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-accent px-3 py-2 text-on-accent focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Vai al contenuto
        </a>
        <SiteHeader />
        {results.is_mock && (
          <div className="border-b border-line bg-warn-soft text-warn">
            <p className="mx-auto w-full max-w-6xl px-4 py-2 text-sm sm:px-6">
              <strong className="font-semibold">Dati di esempio.</strong> Immagini reali, ma numeri generati da{" "}
              <code className="font-mono text-[13px]">npm run mock</code>: non sono i risultati dell&apos;esperimento.
            </p>
          </div>
        )}
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter generatedAt={results.generated_at} />
      </body>
    </html>
  );
}
