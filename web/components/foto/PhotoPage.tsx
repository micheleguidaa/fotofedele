import Link from "next/link";

import { getResults } from "@/lib/data";
import { buildPhotoView } from "@/lib/photo-view";
import type { ImageItem } from "@/lib/types";

import { Container, IconArrowRight } from "../ui";
import { LiveUpload } from "./LiveUpload";
import { PhotoViewer } from "./PhotoViewer";

const LIVE = process.env.NEXT_PUBLIC_LIVE_MODE === "1";
const COUNT_WORD: Record<number, string> = { 2: "due", 3: "tre", 4: "quattro", 5: "cinque", 6: "sei", 7: "sette" };

/** The Foto view: shared by the home page (first photo) and /foto/[id]. */
export function PhotoPage({ image }: { image: ImageItem }) {
  const r = getResults();
  const props = buildPhotoView(r, image);
  const n = r.workflows.length;
  return (
    <Container className="space-y-10 py-8 sm:py-10">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="max-w-3xl">
            <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">Una foto, {COUNT_WORD[n] ?? n} modi di migliorarla</h1>
            <p className="mt-2 leading-relaxed text-muted">
              Foto vere di annunci, migliorate da {COUNT_WORD[n] ?? n} workflow diversi. Confronta ogni versione con l&apos;originale e
              leggi cosa è cambiato: se una versione altera la casa, lo segnaliamo.
            </p>
          </div>
          <Link href="/metodo#come-funziona" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
            Come funziona <IconArrowRight className="size-3.5" />
          </Link>
        </div>
        <PhotoViewer key={image.id} {...props} />
      </div>
      {LIVE && <LiveUpload workflows={props.workflows} />}
    </Container>
  );
}
