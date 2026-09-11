import type { Metadata } from "next";

import { LiveUpload } from "@/components/studio/LiveUpload";
import { StudioApp } from "@/components/studio/StudioApp";
import { Container, PageHeader } from "@/components/ui";
import { getResults, slimImage } from "@/lib/data";

export const metadata: Metadata = { title: "Studio" };

export default function StudioPage() {
  const r = getResults();
  const workflows = r.workflows.map((w) => ({ id: w.id, name: w.name, short: w.short, generative: w.generative }));
  // Show real listing photos first, then the degraded test items.
  const images = [...r.images].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "real" ? -1 : 1)).map(slimImage);
  return (
    <>
      <PageHeader
        eyebrow="Studio"
        title="Il flusso dell'agente, foto per foto"
        lead={
          <p>
            Come lo vedrebbe un agente immobiliare: FotoFedele misura i difetti, sceglie il workflow adatto, migliora la foto e
            verifica che la casa sia rimasta la stessa. L&apos;ultima parola resta all&apos;agente. I risultati sono quelli
            precalcolati del laboratorio.
          </p>
        }
      />
      <Container className="space-y-10 py-8 sm:py-10">
        <StudioApp images={images} workflows={workflows} />
        <LiveUpload workflows={workflows} />
      </Container>
    </>
  );
}
