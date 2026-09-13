import type { Metadata } from "next";
import Link from "next/link";

import { ImageMatrix } from "@/components/lab/ImageMatrix";
import { Leaderboard } from "@/components/lab/Leaderboard";
import { ParetoChart, type ParetoPoint } from "@/components/lab/ParetoChart";
import { Card, Container, GenerativeBadge, PageHeader, Pill, Section, WorkflowTag } from "@/components/ui";
import { getResults, getWorkflow } from "@/lib/data";
import { fmtNum, fmtPct, fmtSeconds, fmtUsd } from "@/lib/format";
import { DEFECT_LABEL, familyLabel } from "@/lib/labels";
import { DEFECT_METRIC, DEFECT_ORDER, targetLabel } from "@/lib/metrics";
import type { Defect, Results, WorkflowId } from "@/lib/types";

export const metadata: Metadata = { title: "Numeri" };

function defectFixRate(r: Results, wf: WorkflowId, d: Defect) {
  const rel = r.images.filter((im) => im.input.defects.includes(d) && im.outputs[wf]?.status === "ok");
  if (!rel.length) return null;
  const fixed = rel.filter((im) => im.outputs[wf]?.fixed_defects?.includes(d)).length;
  return { rate: fixed / rel.length, n: rel.length, fixed };
}

const SECTIONS = [
  { id: "workflow", label: "Workflow" },
  { id: "classifica", label: "Classifica" },
  { id: "pareto", label: "Costo e qualità" },
  { id: "matrice", label: "Matrice" },
  { id: "domande", label: "Domande" },
];

const WORKFLOW_COUNT_WORD: Record<number, string> = { 2: "Due", 3: "Tre", 4: "Quattro", 5: "Cinque", 6: "Sei", 7: "Sette" };

export default function LabPage() {
  const r = getResults();
  const nImages = r.images.length;
  const points: ParetoPoint[] = r.workflows.map((w) => ({
    id: w.id,
    name: w.name,
    cost: w.summary.cost_usd_per_image,
    winrate: w.summary.quality_winrate,
    ci: w.summary.quality_winrate_ci,
    flag: w.summary.fidelity_flag_rate,
    passes: w.summary.gates.reliability && w.summary.gates.fidelity,
    reliability: w.summary.gates.reliability,
    fidelity: w.summary.gates.fidelity,
  }));
  const defects = DEFECT_ORDER.filter((d) => r.decision.per_defect_winner[d]);

  return (
    <>
      <PageHeader
        eyebrow="Numeri"
        title={`${WORKFLOW_COUNT_WORD[r.workflows.length] ?? r.workflows.length} workflow, le stesse foto, criteri misurabili`}
        lead={
          <p>
            {r.dataset.n_real} foto reali di annunci e {r.dataset.n_degraded} foto degradate ad arte (con l&apos;originale pulito come
            riferimento), elaborate da ogni workflow. Prima si applicano i gate di affidabilità e fedeltà, poi i pesi. La regola è{" "}
            <Link href="/metodo#decisione" className="font-medium text-accent hover:underline">
              dichiarata prima dei risultati
            </Link>
            .
          </p>
        }
      >
        <nav aria-label="Sezioni del laboratorio" className="mt-6 flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="rounded-full border border-line-strong px-3 py-1 text-sm hover:bg-subtle">
              {s.label}
            </a>
          ))}
        </nav>
      </PageHeader>

      <Container>
        <Section id="workflow" title={`I ${(WORKFLOW_COUNT_WORD[r.workflows.length] ?? String(r.workflows.length)).toLowerCase()} workflow`} lead="Ogni workflow risponde a una domanda precisa: il confronto è progettato, non casuale.">
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {r.workflows.map((w) => (
              <Card as="li" key={w.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <WorkflowTag id={w.id} />
                    <h3 className="font-semibold leading-snug">{w.name}</h3>
                  </div>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {w.short}
                  {w.family && w.family !== "none" ? ` · famiglia ${familyLabel(w.family)}` : ""} ·{" "}
                  <span className="font-mono text-xs">{w.engine}</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <GenerativeBadge generative={w.generative} />
                  {w.id === r.decision.winner && <Pill tone="accent">Scelta dichiarata</Pill>}
                </div>
                <p className="mt-3 text-sm leading-relaxed">{w.description}</p>
                <p className="mt-3 rounded-lg bg-subtle px-3 py-2 text-sm">
                  <span className="font-semibold">Domanda: </span>
                  {w.question}
                </p>
                {w.prompt ? (
                  <details className="group mt-3 text-sm">
                    <summary className="cursor-pointer font-medium text-accent select-none hover:underline">Prompt usato</summary>
                    <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-line bg-canvas p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                      {w.prompt}
                    </pre>
                  </details>
                ) : (
                  <p className="mt-3 text-sm text-muted">Nessun prompt: solo operazioni deterministiche.</p>
                )}
                <dl className="mt-auto grid grid-cols-2 gap-2 pt-4 text-sm">
                  <div className="rounded-lg border border-line px-3 py-2">
                    <dt className="text-xs text-muted">
                      Costo/foto <span className="italic">(stimato)</span>
                    </dt>
                    <dd className="tabular font-semibold">{fmtUsd(w.summary.cost_usd_per_image)}</dd>
                  </div>
                  <div className="rounded-lg border border-line px-3 py-2">
                    <dt className="text-xs text-muted">Latenza p50</dt>
                    <dd className="tabular font-semibold">{fmtSeconds(w.summary.latency_p50_s)}</dd>
                  </div>
                </dl>
              </Card>
            ))}
          </ul>
        </Section>

        <Section
          id="classifica"
          title="Classifica"
          lead="Sposta i pesi per vedere quanto è robusta la scelta. I gate non si negoziano: un workflow che altera la casa resta fuori a qualunque peso."
        >
          <Leaderboard workflows={r.workflows} decision={r.decision} />
          <details className="group mt-6 rounded-xl border border-line bg-surface">
            <summary className="cursor-pointer px-5 py-3 font-semibold select-none">Altre misure per workflow</summary>
            <div className="overflow-x-auto border-t border-line">
              <table className="data-table min-w-[900px]">
                <thead>
                  <tr>
                    <th scope="col">Workflow</th>
                    <th scope="col" className="num">
                      Successo
                    </th>
                    <th scope="col" className="num">
                      GPU p50
                    </th>
                    <th scope="col" className="num">
                      Nuovi difetti
                    </th>
                    <th scope="col" className="num">
                      Struttura media
                    </th>
                    <th scope="col" className="num">
                      MUSIQ
                    </th>
                    <th scope="col" className="num">
                      PSNR ↑
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
                  {r.workflows.map((w) => (
                    <tr key={w.id}>
                      <th scope="row">
                        <span className="flex items-center gap-2">
                          <WorkflowTag id={w.id} /> <span className="font-normal">{w.name}</span>
                        </span>
                      </th>
                      <td className="num">
                        {w.summary.n_ok}/{w.summary.n_total}
                      </td>
                      <td className="num">{w.summary.gpu_s_p50 === null ? "—" : fmtSeconds(w.summary.gpu_s_p50)}</td>
                      <td className="num">{fmtPct(w.summary.new_defect_rate)}</td>
                      <td className="num">{fmtNum(w.summary.structural_mean, 2)}</td>
                      <td className="num">{fmtNum(w.summary.iqa_musiq, 1)}</td>
                      <td className="num">{fmtNum(w.summary.full_ref?.psnr, 1)}</td>
                      <td className="num">{fmtNum(w.summary.full_ref?.ssim, 3)}</td>
                      <td className="num">{fmtNum(w.summary.full_ref?.lpips, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line px-5 py-3 text-xs text-muted">
              Nuovi difetti: quota di foto in cui il workflow porta fuori obiettivo una metrica che prima era in regola. Struttura:
              gradient-SSIM medio dopo l&apos;allineamento. MUSIQ: qualità percepita stimata senza riferimento. PSNR, SSIM e LPIPS: solo
              sulle {r.dataset.n_degraded} foto degradate, contro l&apos;originale pulito.
            </p>
          </details>
        </Section>

        <Section
          id="pareto"
          title="Costo e qualità"
          lead="Più in alto è meglio, più a sinistra costa meno. Il colore dice quanto spesso il workflow altera la casa."
        >
          <div className="rounded-xl border border-line bg-surface p-4 sm:p-5">
            <ParetoChart points={points} fidelityMax={r.decision.gates.fidelity_flag_max} />
          </div>
        </Section>

        <Section
          id="matrice"
          title="Foto × workflow"
          lead={`Tutti gli output sulle ${nImages} foto. Clicca una miniatura per il confronto dettagliato, le metriche e i verdetti dei giudici.`}
        >
          <ImageMatrix images={r.images} />
        </Section>

        <Section id="domande" title="Le domande del confronto" lead="Cosa rispondono i dati alle domande per cui i workflow sono stati progettati.">
          <ul className="grid gap-4 md:grid-cols-2">
            {r.decision.pairwise_questions.map((q) => (
              <Card as="li" key={q.pair.join("-")}>
                <p className="flex items-center gap-1.5 text-sm text-muted">
                  <WorkflowTag id={q.pair[0]} /> vs <WorkflowTag id={q.pair[1]} />
                </p>
                <h3 className="mt-3 font-semibold">{q.question}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{q.answer}</p>
              </Card>
            ))}
          </ul>

          {r.decision.recommendation && (
            <div className="mt-8">
              <h3 className="text-lg font-semibold">Il router di produzione</h3>
              <p className="mt-1 max-w-3xl text-sm text-muted">
                Nessun workflow è abbastanza fedele da andare in automatico, quindi il prodotto prova un workflow, verifica la
                fedeltà su quella foto e, se serve, passa al successivo. L&apos;ordine usa il punteggio dichiarato con la quota di
                foto migliorate e fedeli come qualità. Costi e latenze includono i tentativi scartati.
              </p>
              <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="data-table min-w-[560px]">
                  <thead>
                    <tr>
                      <th scope="col">Cascata</th>
                      <th scope="col" className="num">Foto migliorate e fedeli</th>
                      <th scope="col" className="num">Costo medio/foto</th>
                      <th scope="col" className="num">Latenza p50</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.decision.recommendation.alternatives.map((a) => {
                      const chosen = a.cascade.join() === r.decision.recommendation!.cascade.join();
                      return (
                        <tr key={a.cascade.join("-")} className={chosen ? "bg-accent-soft/60" : undefined}>
                          <td>
                            <span className="flex flex-wrap items-center gap-1.5">
                              {a.cascade.map((id, k) => (
                                <span key={id} className="flex items-center gap-1.5">
                                  {k > 0 && <span className="text-muted">→</span>}
                                  <WorkflowTag id={id} />
                                </span>
                              ))}
                              {chosen && <Pill tone="accent">Scelta</Pill>}
                            </span>
                          </td>
                          <td className="num font-semibold text-ink">{fmtPct(a.delivered_rate)}</td>
                          <td className="num">{fmtUsd(a.mean_cost_usd)}</td>
                          <td className="num">{fmtSeconds(a.p50_latency_s)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {defects.length > 0 && (
            <div className="mt-8">
              <h3 className="text-lg font-semibold">Il migliore per difetto</h3>
              <p className="mt-1 text-sm text-muted">
                Per ogni difetto, il workflow con più foto migliorate <em>e</em> fedeli tra quelle che lo presentano.
              </p>
              <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="data-table min-w-[560px]">
                  <thead>
                    <tr>
                      <th scope="col">Difetto</th>
                      <th scope="col">Obiettivo</th>
                      <th scope="col">Migliore</th>
                      <th scope="col" className="num">
                        Corretto
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {defects.map((d) => {
                      const id = r.decision.per_defect_winner[d] as WorkflowId;
                      const wf = getWorkflow(r, id);
                      const fr = defectFixRate(r, id, d);
                      return (
                        <tr key={d}>
                          <td className="font-medium">{DEFECT_LABEL[d]}</td>
                          <td className="tabular text-muted">{targetLabel(DEFECT_METRIC[d])}</td>
                          <td>
                            <span className="flex items-center gap-2">
                              <WorkflowTag id={id} />
                              <span>{wf?.name}</span>
                            </span>
                          </td>
                          <td className="num">{fr ? `${fmtPct(fr.rate)} (${fr.fixed}/${fr.n})` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Section>
      </Container>
    </>
  );
}
