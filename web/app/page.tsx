import Link from "next/link";

import { CompareSlider } from "@/components/CompareSlider";
import { FlowDiagram } from "@/components/FlowDiagram";
import { Card, Container, IconArrowRight, IconCheck, IconX, LinkButton, Section, Stat } from "@/components/ui";
import { getResults, getWorkflow } from "@/lib/data";
import { dataSrc, fmtPct, fmtScore, fmtSeconds, fmtUsd } from "@/lib/format";
import type { Results, WorkflowId } from "@/lib/types";

function pickFeatured(r: Results) {
  const candidates = r.images
    .filter((i) => i.kind === "real" && i.router.chosen !== "reshoot" && i.input.w >= i.input.h)
    .map((i) => ({ img: i, id: i.router.chosen as WorkflowId, out: i.outputs[i.router.chosen as WorkflowId] }))
    .filter((c) => c.out?.status === "ok" && c.out.src && !c.out.fidelity?.flag);
  candidates.sort(
    (a, b) =>
      (b.out?.fixed_defects?.length ?? 0) - (a.out?.fixed_defects?.length ?? 0) ||
      (b.out?.ensemble?.win ?? 0) - (a.out?.ensemble?.win ?? 0),
  );
  return candidates[0];
}

const PERIMETER: { title: string; items: string[]; tone?: "no" | "yes" }[] = [
  {
    title: "Per chi",
    items: ["Agenti e inserzionisti che caricano foto scattate con lo smartphone, senza fotografo professionista."],
  },
  {
    title: "Bisogno",
    items: ["Foto chiare e presentabili in pochi secondi, senza competenze di fotoritocco e senza mettere a rischio la credibilità dell'annuncio."],
  },
  {
    title: "Cosa fa",
    tone: "yes",
    items: [
      "Corregge esposizione e alte luci",
      "Neutralizza le dominanti di colore",
      "Raddrizza le verticali",
      "Riduce il rumore, recupera nitidezza e risoluzione",
    ],
  },
  {
    title: "Cosa NON fa",
    tone: "no",
    items: [
      "Niente virtual staging",
      "Niente rimozione di oggetti",
      "Niente cambio della vista o del cielo",
      "Non nasconde difetti: macchie, crepe, umidità",
    ],
  },
  {
    title: "Rischi evitati",
    items: [
      "Annunci ingannevoli e contestazioni",
      "Delusione alla visita, fiducia persa nel portale",
      "Foto «da catalogo» che si riconoscono come false",
      "Costi fuori controllo: il modello costoso solo quando serve",
    ],
  },
];

export default function HomePage() {
  const r = getResults();
  const winner = getWorkflow(r, r.decision.winner);
  const featured = pickFeatured(r);
  const featuredWf = featured ? getWorkflow(r, featured.id) : undefined;
  const worstFlag = [...r.workflows].sort((a, b) => b.summary.fidelity_flag_rate - a.summary.fidelity_flag_rate)[0];
  const rec = r.decision.recommendation;
  const nImages = r.dataset.n_real + r.dataset.n_degraded;

  return (
    <>
      <section className="border-b border-line bg-surface">
        <Container
          className={`grid gap-10 py-12 sm:py-16 lg:items-center ${featured ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]" : ""}`}
        >
          <div>
            <p className="text-sm font-semibold tracking-wide text-accent">Prototipo · miglioramento foto con AI</p>
            <h1 className="mt-3 text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl">
              FotoFedele: foto degli annunci migliori, senza alterare la casa
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
              Corregge luce, colore, verticali e nitidezza delle foto scattate con lo smartphone. Ogni modifica viene misurata e
              verificata: se l&apos;AI cambia la casa, la foto non passa.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <LinkButton href="/studio">
                Prova lo Studio <IconArrowRight />
              </LinkButton>
              <LinkButton href="/lab" variant="secondary">
                Vedi il Laboratorio
              </LinkButton>
            </div>
            <p className="mt-6 text-sm text-muted">
              {nImages} foto di prova · {r.workflows.length} workflow a confronto · {r.judges.list.length} giudici AI · criteri
              dichiarati prima dei risultati
            </p>
          </div>
          {featured && featured.out?.src && (
            <figure>
              <CompareSlider
                before={{ src: dataSrc(featured.img.input.src)!, alt: `Foto originale dell'annuncio: ${featured.img.note}`, label: "Originale" }}
                after={{ src: dataSrc(featured.out.src)!, alt: `La stessa foto migliorata con ${featured.id}`, label: `FotoFedele · ${featured.id}` }}
                aspect={featured.img.input.w / featured.img.input.h}
                initial={45}
                eager
                maxHeight="60vh"
              />
              <figcaption className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <span className="font-mono text-ink">{featured.img.id}</span>
                <span>· {featured.img.note} · migliorata con {featuredWf?.name ?? featured.id}</span>
                <span className="inline-flex items-center gap-1 text-ok">
                  <IconCheck className="size-3.5" /> nessuna alterazione rilevata
                </span>
              </figcaption>
            </figure>
          )}
        </Container>
      </section>

      <Container>
        <Section id="problema" title="Il problema">
          <div className="grid gap-6 md:grid-cols-2">
            <p className="leading-relaxed">
              Molte foto degli annunci arrivano dallo smartphone dell&apos;agente o del proprietario: stanze buie, dominanti gialle o
              verdi, verticali storte, immagini piccole e rumorose. Le foto sono il primo filtro di chi cerca casa, e una foto
              brutta fa scartare un annuncio valido.
            </p>
            <p className="leading-relaxed">
              I modelli generativi le rendono splendide, ma spesso lo fanno <strong>cambiando la casa</strong>: un panorama nuovo
              alla finestra, una crepa sparita, un parquet diverso. Una foto che non corrisponde alla realtà è un annuncio
              ingannevole: delude alla visita, espone inserzionista e portale a contestazioni, consuma fiducia.
            </p>
          </div>
        </Section>

        <Section id="perimetro" title="Perimetro" lead="Un intervento tecnico, come quello di un buon fotografo in post-produzione. Non un arredatore.">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {PERIMETER.map((p) => (
              <Card as="li" key={p.title} className={p.tone === "no" ? "border-bad/30" : undefined}>
                <h3 className="font-semibold">{p.title}</h3>
                <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-muted">
                  {p.items.map((it) => (
                    <li key={it} className="flex gap-2">
                      {p.tone === "no" ? (
                        <IconX className="mt-0.5 size-4 shrink-0 text-bad" />
                      ) : p.tone === "yes" ? (
                        <IconCheck className="mt-0.5 size-4 shrink-0 text-ok" />
                      ) : null}
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </ul>
        </Section>

        <Section
          id="come-funziona"
          title="Come funziona"
          lead="Un flusso agentico con un punto di controllo automatico (la verifica di fedeltà) e uno umano (l'approvazione)."
        >
          <FlowDiagram />
        </Section>

        <Section
          id="risultati"
          title="Risultati chiave"
          lead={
            <>
              Dal laboratorio: {nImages} foto, {r.workflows.length} workflow, regola di decisione{" "}
              <Link href="/metodo#decisione" className="font-medium text-accent hover:underline">
                dichiarata prima dei risultati
              </Link>
              .
            </>
          }
        >
          {winner ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat
                  label="Workflow scelto"
                  value={<span className="font-mono">{winner.id}</span>}
                  sub={
                    <>
                      <span className="font-medium text-ink">{winner.name}</span>. Supera i gate di affidabilità e fedeltà; punteggio{" "}
                      {fmtScore(winner.summary.score)}.
                    </>
                  }
                />
                <Stat
                  label="Preferito all'originale"
                  value={fmtPct(winner.summary.quality_winrate)}
                  sub={`dei confronti a coppie dei giudici AI (IC 95% ${fmtPct(winner.summary.quality_winrate_ci[0])}–${fmtPct(winner.summary.quality_winrate_ci[1])}).`}
                />
                <Stat
                  label="Foto con alterazioni sospette"
                  value={fmtPct(winner.summary.fidelity_flag_rate)}
                  sub={
                    worstFlag && worstFlag.id !== winner.id
                      ? `contro il ${fmtPct(worstFlag.summary.fidelity_flag_rate)} di ${worstFlag.id} (${worstFlag.name}).`
                      : "flag di fedeltà sul totale delle foto elaborate."
                  }
                />
                <Stat
                  label="Costo stimato per foto"
                  value={fmtUsd(winner.summary.cost_usd_per_image)}
                  sub={`latenza mediana ${fmtSeconds(winner.summary.latency_p50_s)}.`}
                />
              </div>
              <p className="mt-5 max-w-4xl rounded-xl border border-line bg-surface p-5 text-sm leading-relaxed">
                <span className="font-semibold">Perché: </span>
                {r.decision.rationale}
              </p>
            </>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat
                  label="Pronti per l'automatico"
                  value={<span className="font-mono">0 / {r.workflows.length}</span>}
                  sub={`Nessun workflow resta sotto il ${fmtPct(r.decision.gates.fidelity_flag_max)} di foto segnalate: la verifica gira foto per foto.`}
                />
                {rec && (
                  <Stat
                    label={`Router ${rec.cascade.join(" → ")}`}
                    value={fmtPct(rec.delivered_rate)}
                    sub="delle foto esce migliorato e fedele; le altre restano all'originale o vanno riscattate."
                  />
                )}
                {rec && (
                  <Stat
                    label="Costo medio con il router"
                    value={fmtUsd(rec.mean_cost_usd)}
                    sub={`per foto (stimato), latenza mediana ${fmtSeconds(rec.p50_latency_s)}.`}
                  />
                )}
                {worstFlag && (
                  <Stat
                    label={`${worstFlag.id} · foto alterate`}
                    value={fmtPct(worstFlag.summary.fidelity_flag_rate)}
                    sub={`${worstFlag.name}: preferito all'originale nel ${fmtPct(worstFlag.summary.quality_winrate)} dei confronti, ma ridisegna la casa.`}
                  />
                )}
              </div>
              <p className="mt-5 max-w-4xl rounded-xl border border-line bg-surface p-5 text-sm leading-relaxed">
                <span className="font-semibold">Perché: </span>
                {r.decision.rationale}
              </p>
            </>
          )}
        </Section>

        <Section id="esplora" title="Esplora il prototipo">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { href: "/studio", title: "Studio", text: "Il prodotto dal punto di vista dell'agente: diagnosi, proposta, verifica, approvazione." },
              { href: "/lab", title: "Laboratorio", text: `${r.workflows.length} workflow sulle stesse foto: classifica, pesi modificabili, frontiera costo-qualità.` },
              { href: "/metodo", title: "Metodo", text: "Come abbiamo reso misurabili qualità e fedeltà, e cosa è reale o simulato." },
              { href: "/arena", title: "Arena", text: "Vota alla cieca tra due versioni della stessa foto." },
            ].map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="group flex h-full flex-col rounded-xl border border-line bg-surface p-5 transition-colors hover:border-accent"
                >
                  <span className="flex items-center justify-between font-semibold">
                    {l.title}
                    <IconArrowRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                  </span>
                  <span className="mt-2 text-sm leading-relaxed text-muted">{l.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      </Container>
    </>
  );
}
