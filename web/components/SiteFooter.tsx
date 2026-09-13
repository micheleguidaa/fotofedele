import Link from "next/link";

import { fmtDateWithArticle } from "@/lib/format";

export function SiteFooter({ generatedAt }: { generatedAt?: string }) {
  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-2xl space-y-1.5">
          <p className="font-semibold text-ink">FotoFedele</p>
          <p>
            Prototipo per case study · foto da annunci pubblici di Immobiliare.it, usate solo a scopo dimostrativo · non
            affiliato
          </p>
          {generatedAt && <p>Dati del laboratorio generati {fmtDateWithArticle(generatedAt)}.</p>}
        </div>
        <nav aria-label="Piè di pagina">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            <li>
              <Link className="hover:text-ink hover:underline" href="/">
                Foto
              </Link>
            </li>
            <li>
              <Link className="hover:text-ink hover:underline" href="/numeri">
                Numeri
              </Link>
            </li>
            <li>
              <Link className="hover:text-ink hover:underline" href="/metodo">
                Metodo
              </Link>
            </li>
            <li>
              <Link className="hover:text-ink hover:underline" href="/arena">
                Arena
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
