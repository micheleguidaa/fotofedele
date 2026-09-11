import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Drilldown } from "@/components/lab/Drilldown";
import { Container, DefectChip, IconArrowRight, IconExternal, Pill, WorkflowTag } from "@/components/ui";
import { getImage, getResults, getWorkflow } from "@/lib/data";
import { fmtNum } from "@/lib/format";
import { KIND_LABEL, WORKFLOW_IDS } from "@/lib/labels";
import { DEFECT_ORDER } from "@/lib/metrics";

export const dynamicParams = false;

export function generateStaticParams() {
  return getResults().images.map((im) => ({ id: im.id }));
}

export async function generateMetadata({ params }: PageProps<"/lab/[id]">): Promise<Metadata> {
  const { id } = await params;
  const im = getImage(getResults(), id);
  return { title: im ? `${im.id} · ${im.note}` : "Foto" };
}

const DEGRADATION_LABEL: Record<string, string> = {
  ev: "Esposizione (EV)",
  cast: "Dominante",
  cast_strength: "Intensità dominante",
  tilt_deg: "Inclinazione (°)",
  noise_sigma: "Rumore (σ)",
  target_mp: "Risoluzione (MP)",
  jpeg_q: "Qualità JPEG",
};
const CAST_LABEL: Record<string, string> = { green: "verde", warm: "calda", cool: "fredda", magenta: "magenta" };

export default async function ImagePage({ params }: PageProps<"/lab/[id]">) {
  const { id } = await params;
  const r = getResults();
  const image = getImage(r, id);
  if (!image) notFound();

  const idx = r.images.findIndex((i) => i.id === image.id);
  const prev = r.images[(idx - 1 + r.images.length) % r.images.length];
  const next = r.images[(idx + 1) % r.images.length];
  const chosen = image.router.chosen === "reshoot" ? null : getWorkflow(r, image.router.chosen);
  const workflows = r.workflows.map((w) => ({ id: w.id, name: w.name, family: w.family, generative: w.generative }));
  const fullRefRows = WORKFLOW_IDS.flatMap((wid) => {
    const o = image.outputs[wid];
    return o?.status === "ok" && o.full_ref ? [{ wid, fr: o.full_ref }] : [];
  });

  return (
    <>
      <div className="border-b border-line bg-surface">
        <Container className="py-8">
          <nav aria-label="Percorso" className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <ol className="flex items-center gap-1.5 text-muted">
              <li>
                <Link href="/lab#matrice" className="hover:text-ink hover:underline">
                  Laboratorio
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="font-mono text-ink">
                {image.id}
              </li>
            </ol>
            <div className="flex gap-2">
              <Link href={`/lab/${prev.id}`} className="rounded-md border border-line-strong px-2.5 py-1 hover:bg-subtle" aria-label={`Foto precedente: ${prev.id}`}>
                ← {prev.id}
              </Link>
              <Link href={`/lab/${next.id}`} className="rounded-md border border-line-strong px-2.5 py-1 hover:bg-subtle" aria-label={`Foto successiva: ${next.id}`}>
                {next.id} →
              </Link>
            </div>
          </nav>
          <h1 className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-3xl font-semibold tracking-tight">
            <span className="font-mono">{image.id}</span>
            <span className="text-xl font-normal text-muted">{image.note}</span>
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Pill tone="muted">{KIND_LABEL[image.kind]}</Pill>
            {DEFECT_ORDER.filter((d) => image.input.defects.includes(d)).map((d) => (
              <DefectChip key={d} defect={d} />
            ))}
            {image.input.defects.length === 0 && <Pill tone="ok">Nessun difetto</Pill>}
            {image.source_url && (
              <a href={image.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
                Annuncio di origine <IconExternal />
              </a>
            )}
          </div>
          <div className="mt-5 max-w-3xl rounded-xl border border-line bg-canvas p-4 text-sm">
            <p className="flex flex-wrap items-center gap-2 font-semibold">
              Router:
              {chosen ? (
                <>
                  <WorkflowTag id={chosen.id} /> {chosen.name}
                </>
              ) : (
                <span className="text-warn">rifare lo scatto</span>
              )}
              {image.router.fallback && <span className="font-normal text-muted">· ripiego {image.router.fallback}</span>}
            </p>
            <p className="mt-1 leading-relaxed text-muted">{image.router.reason}</p>
            <Link href={`/studio?foto=${image.id}`} className="mt-2 inline-flex items-center gap-1 font-medium text-accent hover:underline">
              Come la vede l&apos;agente nello Studio <IconArrowRight className="size-3.5" />
            </Link>
          </div>
        </Container>
      </div>

      <Container className="space-y-10 py-10">
        <Drilldown image={image} workflows={workflows} judges={r.judges.list} />

        {image.kind === "degraded" && (
          <section aria-labelledby="fullref-title" className="space-y-3">
            <h2 id="fullref-title" className="text-xl font-semibold">
              Metriche con riferimento
            </h2>
            <p className="max-w-3xl text-sm text-muted">
              Questa foto è stata degradata ad arte partendo da un originale pulito: si può misurare quanto ogni workflow ci si
              riavvicina. PSNR e SSIM più alti sono meglio; LPIPS (distanza percettiva) più basso è meglio.
            </p>
            {image.degradation && (
              <dl className="flex flex-wrap gap-2 text-sm">
                {Object.entries(image.degradation).map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-line bg-surface px-3 py-1.5">
                    <dt className="inline text-muted">{DEGRADATION_LABEL[k] ?? k}: </dt>
                    <dd className="tabular inline font-medium">
                      {typeof v === "number" ? fmtNum(v, Math.abs(v) >= 10 ? 0 : 2) : (CAST_LABEL[v] ?? v)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {fullRefRows.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="data-table min-w-[520px]">
                  <thead>
                    <tr>
                      <th scope="col">Workflow</th>
                      <th scope="col" className="num">
                        PSNR (dB) ↑
                      </th>
                      <th scope="col" className="num">
                        SSIM ↑
                      </th>
                      <th scope="col" className="num">
                        LPIPS ↓
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fullRefRows.map(({ wid, fr }) => {
                      const best = (key: "psnr" | "ssim" | "lpips") => {
                        const vals = fullRefRows.map((x) => x.fr[key]);
                        return key === "lpips" ? Math.min(...vals) === fr[key] : Math.max(...vals) === fr[key];
                      };
                      return (
                        <tr key={wid}>
                          <th scope="row">
                            <span className="flex items-center gap-2">
                              <WorkflowTag id={wid} /> {getWorkflow(r, wid)?.name}
                            </span>
                          </th>
                          <td className={`num ${best("psnr") ? "font-semibold text-ok" : ""}`}>{fmtNum(fr.psnr, 1)}</td>
                          <td className={`num ${best("ssim") ? "font-semibold text-ok" : ""}`}>{fmtNum(fr.ssim, 3)}</td>
                          <td className={`num ${best("lpips") ? "font-semibold text-ok" : ""}`}>{fmtNum(fr.lpips, 3)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted">Metriche con riferimento non disponibili.</p>
            )}
          </section>
        )}
      </Container>
    </>
  );
}
