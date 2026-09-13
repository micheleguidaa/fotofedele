import Link from "next/link";

import { dataSrc } from "@/lib/format";
import { WORKFLOW_IDS } from "@/lib/labels";
import type { ImageItem, WorkflowId } from "@/lib/types";

import { IconAlert, cx } from "../ui";

export function ImageMatrix({ images, workflowIds = WORKFLOW_IDS }: { images: ImageItem[]; workflowIds?: WorkflowId[] }) {
  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted" aria-label="Legenda della matrice">
        <li className="flex items-center gap-2">
          <span className="inline-block h-4 w-6 rounded-sm ring-2 ring-bad" aria-hidden="true" /> flag di fedeltà
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-block h-4 w-6 rounded-sm bg-subtle ring-1 ring-line-strong" aria-hidden="true" /> errore / nessun output
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-block h-4 w-6 rounded-sm ring-2 ring-accent" aria-hidden="true" /> scelta del router
        </li>
      </ul>
      <div className="max-h-[80vh] overflow-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[820px] border-separate border-spacing-0 text-sm">
          <caption className="sr-only">Matrice foto × workflow: miniature degli output, con segnalazioni di fedeltà ed errori</caption>
          <thead className="sticky top-0 z-20 bg-surface">
            <tr>
              <th scope="col" className="sticky left-0 z-10 border-b border-line-strong bg-surface px-3 py-2 text-left text-xs font-semibold text-muted">
                Foto
              </th>
              <th scope="col" className="border-b border-line-strong px-1.5 py-2 text-left text-xs font-semibold text-muted">
                Originale
              </th>
              {workflowIds.map((id) => (
                <th key={id} scope="col" className="border-b border-line-strong px-1.5 py-2 text-left font-mono text-xs font-semibold text-muted">
                  {id}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {images.map((im) => (
              <tr key={im.id}>
                <th scope="row" className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-2 text-left align-top font-normal">
                  <Link href={`/foto/${im.id}`} className="font-mono font-semibold text-accent hover:underline">
                    {im.id}
                  </Link>
                  <p className="mt-0.5 max-w-28 text-xs leading-snug text-muted">{im.note}</p>
                  {im.router.chosen === "reshoot" && <p className="mt-0.5 text-xs font-medium text-warn">rifare lo scatto</p>}
                </th>
                <td className="border-b border-line px-1.5 py-2 align-top">
                  <Link href={`/foto/${im.id}`} className="block w-24 overflow-hidden rounded-md" aria-label={`${im.id}: foto originale`}>
                    <img src={dataSrc(im.input.thumb ?? im.input.src)} alt="" loading="lazy" decoding="async" className="aspect-[4/3] w-full bg-subtle object-cover" />
                  </Link>
                </td>
                {workflowIds.map((id) => {
                  const o = im.outputs[id];
                  const chosen = im.router.chosen === id;
                  if (!o || o.status !== "ok" || !o.src) {
                    return (
                      <td key={id} className="border-b border-line px-1.5 py-2 align-top">
                        <Link
                          href={`/foto/${im.id}`}
                          title={o?.error ?? "Nessun output"}
                          className="flex aspect-[4/3] w-24 items-center justify-center rounded-md bg-subtle p-1 text-center text-[11px] leading-tight text-muted ring-1 ring-line-strong"
                        >
                          {o?.status === "error" ? "Errore" : "—"}
                          <span className="sr-only">
                            {`: ${id} su ${im.id}`}
                            {o?.error ? `, ${o.error}` : ""}
                          </span>
                        </Link>
                      </td>
                    );
                  }
                  const flag = o.fidelity?.flag;
                  return (
                    <td key={id} className="border-b border-line px-1.5 py-2 align-top">
                      <Link
                        href={`/foto/${im.id}?v=${id}`}
                        className={cx(
                          "relative block w-24 overflow-hidden rounded-md",
                          flag ? "ring-2 ring-bad" : chosen ? "ring-2 ring-accent" : "ring-1 ring-line",
                        )}
                        aria-label={`${im.id}, ${id}${flag ? ": flag di fedeltà" : ""}${chosen ? ", scelta del router" : ""}`}
                      >
                        <img src={dataSrc(o.thumb ?? o.src)} alt="" loading="lazy" decoding="async" className="aspect-[4/3] w-full bg-subtle object-cover" />
                        {flag && (
                          <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-bad text-canvas shadow" aria-hidden="true">
                            <IconAlert className="size-3.5" />
                          </span>
                        )}
                        {chosen && (
                          <span className="absolute bottom-1 left-1 rounded bg-accent px-1 text-[10px] font-semibold text-on-accent" aria-hidden="true">
                            router
                          </span>
                        )}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
