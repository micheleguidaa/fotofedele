// Server-side props for the Foto view: captions, verdicts and quotes are computed here so the client gets words, not judges' raw data.
import type { PhotoViewerProps, VersionView } from "@/components/foto/PhotoViewer";

import { changeCaptions, describeDefects, judgeQuote, summaryLine, versionVerdict } from "./captions";
import { dataSrc } from "./format";
import { WORKFLOW_IDS, workflowShortName } from "./labels";
import type { ImageItem, Results } from "./types";

/** Real listing photos first, then the degraded test items. */
export function orderedImages(r: Results): ImageItem[] {
  return [...r.images].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "real" ? -1 : 1));
}

export function photoTitle(image: ImageItem): string {
  const defects = describeDefects(image.input.defects);
  if (image.kind === "real") return defects;
  const room = image.note.charAt(0).toUpperCase() + image.note.slice(1);
  return `${room}: ${defects.charAt(0).toLowerCase()}${defects.slice(1)}`;
}

export function buildPhotoView(r: Results, image: ImageItem): PhotoViewerProps {
  const images = orderedImages(r);
  const idx = images.findIndex((i) => i.id === image.id);
  const judgeName = (id: string) => r.judges.list.find((j) => j.id === id)?.name ?? id;

  const versions: VersionView[] = WORKFLOW_IDS.flatMap((id) => {
    const o = image.outputs[id];
    const w = r.workflows.find((x) => x.id === id);
    if (!o || o.status !== "ok" || !o.src || !w) return [];
    const captions = changeCaptions(o);
    const quote = judgeQuote(o);
    return [
      {
        id,
        name: workflowShortName(w),
        generative: w.generative,
        src: dataSrc(o.src)!,
        thumb: dataSrc(o.thumb ?? o.src)!,
        heatmap: dataSrc(o.heatmap) ?? null,
        verdict: versionVerdict(image.router, id, o),
        captions,
        summary: summaryLine(captions, o.ensemble?.win),
        quote: quote ? { judge: judgeName(quote.judge), text: quote.text } : null,
      },
    ];
  });

  const has = (id: string | null | undefined) => versions.some((v) => v.id === id);
  const chosen = image.router.chosen;
  const recommended = chosen !== "reshoot" && has(chosen) ? chosen : null;
  const fallback = image.router.fallback && has(image.router.fallback) ? image.router.fallback : null;

  return {
    image,
    title: photoTitle(image),
    strip: images.map((i) => ({ id: i.id, thumb: dataSrc(i.input.thumb ?? i.input.src)!, label: photoTitle(i) })),
    prevId: images[(idx - 1 + images.length) % images.length].id,
    nextId: images[(idx + 1) % images.length].id,
    versions,
    recommended,
    defaultVersion: recommended ?? fallback ?? versions.find((v) => v.verdict.tone !== "warn")?.id ?? versions[0]?.id ?? null,
    workflows: r.workflows.map((w) => ({ id: w.id, name: w.name, family: w.family, generative: w.generative })),
    judges: r.judges.list,
  };
}
