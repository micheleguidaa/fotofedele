import type { Metadata } from "next";

import { Arena, type ArenaImage, type ArenaWorkflow } from "@/components/arena/Arena";
import { Container, PageHeader } from "@/components/ui";
import { getResults } from "@/lib/data";
import { WORKFLOW_IDS } from "@/lib/labels";

export const metadata: Metadata = { title: "Arena" };

export default function ArenaPage() {
  const r = getResults();
  const images: ArenaImage[] = r.images.map((im) => {
    const outputs: ArenaImage["outputs"] = {};
    for (const id of WORKFLOW_IDS) {
      const o = im.outputs[id];
      if (o?.status === "ok" && o.src) outputs[id] = { src: o.src, win: o.ensemble?.win ?? null };
    }
    return { id: im.id, note: im.note, w: im.input.w, h: im.input.h, input: im.input.src, outputs };
  });
  const workflows: ArenaWorkflow[] = r.workflows.map((w) => ({ id: w.id, name: w.name, winrate: w.summary.quality_winrate }));

  return (
    <>
      <PageHeader
        eyebrow="Arena"
        title="Vota alla cieca"
        lead={
          <p>
            Le metriche e i giudici AI dicono molto, ma chi compra casa è una persona. L&apos;arena raccoglie preferenze umane con lo
            stesso protocollo dei giudici: coppie casuali, posizione casuale, nomi nascosti fino al voto.
          </p>
        }
      />
      <Container className="py-8 sm:py-10">
        <Arena images={images} workflows={workflows} />
      </Container>
    </>
  );
}
