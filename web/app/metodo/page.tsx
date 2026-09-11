import type { Metadata } from "next";
import Link from "next/link";

import { Card, Container, IconAlert, IconCheck, PageHeader, Pill, Section, WorkflowTag } from "@/components/ui";
import { getResults } from "@/lib/data";
import { dataSrc, fmtDate, fmtNum, fmtPct } from "@/lib/format";
import { CHECKLIST_KEYS, CHECKLIST_QUESTION, DEFECT_LABEL, RUBRIC_KEYS, STATUS_LABEL, familyLabel } from "@/lib/labels";
import { DEFECT_METRIC, DEFECT_ORDER, METRIC_BY_KEY, targetLabel } from "@/lib/metrics";
import type { JudgeId, Results } from "@/lib/types";

export const metadata: Metadata = { title: "Metodo" };

const TOC = [
  { id: "parametri", label: "Parametri" },
  { id: "decisione", label: "Regola di decisione" },
  { id: "misurabile", label: "Qualitativo → misurabile" },
  { id: "trappole", label: "Set di trappole" },
  { id: "obiettivi", label: "Obiettivi per difetto" },
  { id: "reale", label: "Reale e simulato" },
  { id: "limiti", label: "Limiti" },
  { id: "prossimi", label: "Prossimi passi" },
];

const PARAMS = [
  {
    name: "Qualità",
    how: "Win-rate nei confronti a coppie contro l'originale (giudici AI, IC bootstrap 95%) e quota di difetti riportati nell'obiettivo dalle metriche tecniche.",
    why: "È il valore per l'inserzionista: foto più leggibili e invitanti fanno aprire e contattare l'annuncio.",
  },
  {
    name: "Costo",
    how: "Dollari per foto: listini API per i modelli chiusi, tempo GPU misurato × prezzo orario per quelli self-hosted.",
    why: "Il servizio deve reggere milioni di foto: la differenza tra 0,001 $ e 0,15 $ a foto decide se è gratuito o a pagamento.",
  },
  {
    name: "Tempo",
    how: "Latenza wall-clock per foto, mediana (p50) e 90° percentile.",
    why: "L'agente carica le foto mentre compila l'annuncio: sotto i 10–20 s si può mostrare subito il risultato, oltre serve un flusso asincrono.",
  },
  {
    name: "Affidabilità",
    how: "Quota di richieste che producono un'immagine (nessun errore, rifiuto del filtro di sicurezza, quota esaurita o timeout).",
    why: "Ogni fallimento è un caso di supporto o un fallback da gestire: a scala, il 10% di errori non è accettabile.",
  },
  {
    name: "Rischio di alterazione",
    how: "Quota di foto con flag di fedeltà: cambiamento strutturale misurato dopo l'allineamento oppure checklist della maggioranza dei giudici.",
    why: "Una foto che cambia la casa rende l'annuncio ingannevole: rischio legale e reputazionale per inserzionista e portale. È l'unico criterio che non si compensa.",
  },
];

const NEXT_STEPS = [
  {
    title: "Arena umana alla cieca",
    text: "Voti a coppie di persone (acquirenti e agenti) e calibrazione Bradley–Terry: quanto i giudici AI concordano con le persone e con che peso combinarli.",
  },
  {
    title: "A/B test su annunci reali",
    text: "Foto migliorate (con etichetta AI) contro originali su annunci veri, misurando CTR della scheda e tasso di contatto, più le segnalazioni di non conformità.",
  },
  {
    title: "Router appreso per difetto",
    text: "Dalle regole scritte a un modello che sceglie il workflow a partire dalle metriche misurate, addestrato sugli esiti del laboratorio.",
  },
  {
    title: "Ottimizzazione di batch e costi",
    text: "Elaborazione asincrona al caricamento, GPU condivise e code batch, cache dei risultati, modelli più piccoli dove bastano.",
  },
];

const STATUS_TONE = { reale: "ok", stimato: "accent", simulato: "warn", progettato: "neutral" } as const;

function alphaLabel(a: number) {
  if (a >= 0.8) return "accordo alto";
  if (a >= 0.67) return "accordo accettabile";
  if (a >= 0.4) return "accordo moderato: il singolo giudice non basta";
  return "accordo basso: il singolo giudice non basta";
}

function judgeLabel(r: Results, id: string) {
  return r.judges.list.find((j) => j.id === id)?.name ?? id;
}

function pairKeyToJudges(r: Results, key: string): [string, string] | null {
  const ids = r.judges.list.map((j) => j.id as string);
  const parts = key.split(/[-_|:,\s]+|vs/).filter(Boolean);
  if (parts.length === 2 && parts.every((p) => ids.includes(p))) return [parts[0], parts[1]];
  return null;
}

export default function MetodoPage() {
  const r = getResults();
  const gates = r.decision.gates;
  const weights = r.decision.weights;
  const wsum = weights.quality + weights.naturalness + weights.cost + weights.speed || 1;
  const judges = r.judges.list;
  const pairs = Object.entries(r.judges.agreement.pairwise_agreement).map(([k, v]) => ({ key: k, v, pair: pairKeyToJudges(r, k) }));
  const allPairsParsed = pairs.length > 0 && pairs.every((p) => p.pair);
  const finalDetector = r.traps.detectors.find((d) => /combin|final|finale/i.test(d.id)) ?? null;
  const detectorName = (id: string) => r.traps.detectors.find((d) => d.id === id)?.name ?? id;

  return (
    <>
      <PageHeader
        eyebrow="Metodo"
        title="Come si misura una foto «migliore ma fedele»"
        lead={
          <p>
            Qualità e fedeltà sembrano giudizi soggettivi. Qui diventano numeri: criteri scelti prima dei risultati, domande
            binarie invece di voti vaghi, giudici di famiglie diverse controllati con trappole e con un riferimento pulito.
          </p>
        }
      />
      <Container className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Indice" className="hidden lg:block">
          <ul className="sticky top-20 space-y-1 py-12 text-sm">
            {TOC.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`} className="block rounded-md px-2 py-1 text-muted hover:bg-subtle hover:text-ink">
                  {t.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">
          <Section id="parametri" title="Parametri di valutazione" lead="Cinque parametri, ciascuno con una misura esplicita e un motivo di business.">
            <ul className="grid gap-4 md:grid-cols-2">
              {PARAMS.map((p) => (
                <Card as="li" key={p.name} className={p.name === "Rischio di alterazione" ? "border-warn/50 md:col-span-2" : undefined}>
                  <h3 className="font-semibold">{p.name}</h3>
                  <p className="mt-2 text-sm leading-relaxed">
                    <span className="font-medium">Come si misura: </span>
                    <span className="text-muted">{p.how}</span>
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed">
                    <span className="font-medium">Perché conta: </span>
                    <span className="text-muted">{p.why}</span>
                  </p>
                </Card>
              ))}
            </ul>
          </Section>

          <Section
            id="decisione"
            title="Regola di decisione"
            aside={
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-sm font-medium text-accent">
                <IconCheck className="size-3.5 shrink-0" />
                <span>
                  Dichiarata prima di vedere i risultati
                  {r.decision.declared_at ? ` · ${fmtDate(r.decision.declared_at)}` : ""}
                </span>
              </span>
            }
          >
            <ol className="grid gap-4 md:grid-cols-2">
              <Card as="li">
                <p className="text-sm font-semibold text-accent">1 · Gate (sì/no)</p>
                <ul className="mt-2 space-y-1.5 text-sm">
                  <li>
                    Affidabilità ≥ <strong>{fmtPct(gates.reliability_min)}</strong> delle richieste andate a buon fine
                  </li>
                  <li>
                    Flag di fedeltà ≤ <strong>{fmtPct(gates.fidelity_flag_max)}</strong> delle foto elaborate
                  </li>
                </ul>
                <p className="mt-3 text-sm text-muted">
                  Chi non supera un gate è escluso, anche se è il più apprezzato: la fedeltà non si compra con la qualità.
                </p>
              </Card>
              <Card as="li">
                <p className="text-sm font-semibold text-accent">2 · Punteggio pesato</p>
                <ul className="mt-2 grid grid-cols-2 gap-1.5 text-sm">
                  <li>
                    Qualità <strong className="tabular">{fmtPct(weights.quality / wsum)}</strong>
                  </li>
                  <li>
                    Naturalezza <strong className="tabular">{fmtPct(weights.naturalness / wsum)}</strong>
                  </li>
                  <li>
                    Costo <strong className="tabular">{fmtPct(weights.cost / wsum)}</strong>
                  </li>
                  <li>
                    Velocità <strong className="tabular">{fmtPct(weights.speed / wsum)}</strong>
                  </li>
                </ul>
                <p className="mt-3 text-sm text-muted">
                  Solo tra chi supera i gate. Costo in scala logaritmica, velocità min-max; la formula è nel{" "}
                  <Link href="/lab#classifica" className="font-medium text-accent hover:underline">
                    laboratorio
                  </Link>
                  , dove i pesi si possono cambiare per verificare la robustezza della scelta.
                </p>
              </Card>
            </ol>
          </Section>

          <Section
            id="misurabile"
            title="Rendere misurabile il qualitativo"
            lead="Sei scelte di metodo per trasformare «è più bella?» e «è la stessa casa?» in dati confrontabili."
          >
            <div className="space-y-10">
              <div>
                <h3 className="text-lg font-semibold">1. Rubrica ancorata</h3>
                <p className="mt-1 max-w-3xl text-sm text-muted">
                  Ogni dimensione ha una descrizione per i punteggi 1, 3 e 5: il giudice non sceglie un numero, sceglie la descrizione più vicina.
                </p>
                <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface">
                  <table className="data-table min-w-[760px]">
                    <thead>
                      <tr>
                        <th scope="col">Dimensione</th>
                        <th scope="col">1</th>
                        <th scope="col">3</th>
                        <th scope="col">5</th>
                      </tr>
                    </thead>
                    <tbody>
                      {RUBRIC_KEYS.filter((k) => r.rubric_definition[k]).map((k) => {
                        const d = r.rubric_definition[k];
                        return (
                          <tr key={k}>
                            <th scope="row">{d.label}</th>
                            <td className="text-muted">{d.anchors[1]}</td>
                            <td className="text-muted">{d.anchors[3]}</td>
                            <td className="text-muted">{d.anchors[5]}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <h3 className="font-semibold">2. Confronto a coppie, non voto assoluto</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    «Da 1 a 10 quanto è bella?» dà risposte instabili tra giudici e tra sessioni. «Quale delle due ti invoglia di più a
                    visitare la casa?» è una domanda più facile e più ripetibile. Il risultato è un win-rate contro l&apos;originale, con
                    intervallo di confidenza bootstrap.
                  </p>
                </Card>
                <Card>
                  <h3 className="font-semibold">3. Checklist binaria di fedeltà</h3>
                  <p className="mt-2 text-sm text-muted">Sei domande sì/no, al posto di un voto di «fedeltà»:</p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {CHECKLIST_KEYS.map((k) => (
                      <li key={k} className="flex gap-2">
                        <span className="text-muted">·</span>
                        {CHECKLIST_QUESTION[k]}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-sm text-muted">Conta la maggioranza dei giudici senza conflitto; in parallelo, un controllo strutturale misurato.</p>
                </Card>
              </div>

              <div>
                <h3 className="text-lg font-semibold">4. Giudici di famiglie diverse, con esclusione per conflitto di interessi</h3>
                <p className="mt-1 max-w-3xl text-sm text-muted">
                  Un modello tende a preferire le immagini generate dalla propria famiglia. Per questo il suo verdetto non entra nel
                  risultato quando giudica un workflow della stessa famiglia.
                </p>
                <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface">
                  <table className="data-table min-w-[640px]">
                    <thead>
                      <tr>
                        <th scope="col">Giudice</th>
                        <th scope="col">Modello</th>
                        <th scope="col">Famiglia</th>
                        <th scope="col">Escluso quando giudica</th>
                      </tr>
                    </thead>
                    <tbody>
                      {judges.map((j) => {
                        const excluded = r.workflows.filter((w) => w.family === j.family);
                        return (
                          <tr key={j.id}>
                            <th scope="row">{j.name}</th>
                            <td className="font-mono text-xs">{j.model}</td>
                            <td>{familyLabel(j.family)}</td>
                            <td>
                              {excluded.length ? (
                                <span className="flex flex-wrap gap-1">
                                  {excluded.map((w) => (
                                    <WorkflowTag key={w.id} id={w.id} />
                                  ))}
                                </span>
                              ) : (
                                <span className="text-muted">mai</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <h3 className="font-semibold">5. Controllo del bias di posizione</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    Ogni coppia è mostrata due volte, invertendo l&apos;ordine. Se il giudice cambia idea, il confronto vale «pari».
                    Quota di risposte coerenti:
                  </p>
                  <ul className="mt-3 space-y-2">
                    {judges.map((j) => {
                      const v = r.judges.position_consistency[j.id as JudgeId];
                      return (
                        <li key={j.id} className="grid grid-cols-[5rem_1fr_3rem] items-center gap-3 text-sm">
                          <span>{j.name}</span>
                          <span className="h-2 rounded-full bg-subtle" aria-hidden="true">
                            <span className="block h-2 rounded-full bg-accent" style={{ width: `${(v ?? 0) * 100}%` }} />
                          </span>
                          <span className="tabular text-right font-medium">{fmtPct(v)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
                <Card>
                  <h3 className="font-semibold">6. Meta-validazione dei giudici</h3>
                  <dl className="mt-3 space-y-3 text-sm">
                    <div>
                      <dt className="text-muted">Accordo tra giudici (α di Krippendorff, preferenze)</dt>
                      <dd className="flex items-baseline gap-2">
                        <span className="tabular text-2xl font-semibold">{fmtNum(r.judges.agreement.krippendorff_alpha, 2)}</span>
                        <span className={`text-sm font-medium ${r.judges.agreement.krippendorff_alpha >= 0.67 ? "text-ok" : "text-warn"}`}>
                          {alphaLabel(r.judges.agreement.krippendorff_alpha)}
                        </span>
                      </dd>
                      <dd className="text-xs text-muted">1 = accordo perfetto, 0 = come il caso; sopra 0,67 è considerato accettabile.</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Riconoscono l&apos;originale pulito rispetto alla versione degradata</dt>
                      <dd className="mt-1 flex flex-wrap gap-2">
                        {judges.map((j) => (
                          <span key={j.id} className="rounded-md bg-subtle px-2 py-1">
                            {j.name} <strong className="tabular">{fmtPct(r.judges.gt_accuracy[j.id as JudgeId])}</strong>
                          </span>
                        ))}
                      </dd>
                    </div>
                  </dl>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <h3 className="font-semibold">Accordo a coppie</h3>
                  <p className="mt-1 text-sm text-muted">Quota di confronti in cui due giudici danno la stessa preferenza.</p>
                  {allPairsParsed ? (
                    <div className="mt-3 overflow-x-auto">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th scope="col">
                              <span className="sr-only">Giudice</span>
                            </th>
                            {judges.slice(1).map((j) => (
                              <th key={j.id} scope="col" className="num">
                                {j.name}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {judges.slice(0, -1).map((a, ai) => (
                            <tr key={a.id}>
                              <th scope="row">{a.name}</th>
                              {judges.slice(1).map((b, bi) => {
                                if (bi < ai) return <td key={b.id} />;
                                const p = pairs.find((x) => x.pair && x.pair.includes(a.id) && x.pair.includes(b.id));
                                return (
                                  <td key={b.id} className="num">
                                    {p ? fmtPct(p.v) : "—"}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <ul className="mt-3 space-y-1 text-sm">
                      {pairs.map((p) => (
                        <li key={p.key} className="flex justify-between gap-3">
                          <span>{p.pair ? `${judgeLabel(r, p.pair[0])} · ${judgeLabel(r, p.pair[1])}` : p.key}</span>
                          <span className="tabular font-medium">{fmtPct(p.v)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card>
                  <h3 className="font-semibold">Preferenza per la propria famiglia</h3>
                  <p className="mt-1 text-sm text-muted">
                    Sugli output della stessa famiglia: quanto spesso il giudice preferisce l&apos;output, contro gli altri giudici. È il
                    motivo dell&apos;esclusione per conflitto.
                  </p>
                  <table className="data-table mt-3">
                    <thead>
                      <tr>
                        <th scope="col">Giudice</th>
                        <th scope="col" className="num">
                          Propria famiglia
                        </th>
                        <th scope="col" className="num">
                          Altri giudici
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.judges.self_preference.map((s) => (
                        <tr key={s.judge}>
                          <th scope="row">{judgeLabel(r, s.judge)}</th>
                          <td className={`num font-semibold ${s.own_family_winrate - s.others_winrate > 0.05 ? "text-warn" : ""}`}>
                            {fmtPct(s.own_family_winrate)}
                          </td>
                          <td className="num">{fmtPct(s.others_winrate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            </div>
          </Section>

          <Section
            id="trappole"
            title="Set di trappole"
            lead={`${r.traps.n} coppie costruite apposta: alterazioni vere (oggetti tolti, vista cambiata, crepe cancellate…) e controlli con sole correzioni tecniche. Servono a misurare quanto i rilevatori di alterazione sbagliano.`}
          >
            <div className="overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="data-table min-w-[560px]">
                <thead>
                  <tr>
                    <th scope="col">Rilevatore</th>
                    <th scope="col" className="num">
                      Precisione
                    </th>
                    <th scope="col" className="num">
                      Richiamo
                    </th>
                    <th scope="col" className="num">
                      F1
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {r.traps.detectors.map((d) => (
                    <tr key={d.id} className={finalDetector?.id === d.id ? "bg-accent-soft/60" : undefined}>
                      <th scope="row">
                        {d.name}
                        {finalDetector?.id === d.id && (
                          <Pill tone="accent" className="ml-2">
                            usato in produzione
                          </Pill>
                        )}
                      </th>
                      <td className="num">{fmtPct(d.precision)}</td>
                      <td className="num">{fmtPct(d.recall)}</td>
                      <td className="num font-semibold">{fmtNum(d.f1, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">
              Precisione: quante segnalazioni erano alterazioni vere. Richiamo: quante alterazioni vere sono state segnalate.
            </p>

            <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {r.traps.items.map((t) => {
                const caught = finalDetector ? t.detected_by.includes(finalDetector.id) : t.detected_by.length > 0;
                const good = t.is_alteration ? caught : !caught;
                return (
                  <Card as="li" key={t.id} className="p-4">
                    <div className="grid grid-cols-2 gap-2">
                      <figure>
                        <img src={dataSrc(t.original)} alt={`${t.id}: originale`} loading="lazy" decoding="async" className="aspect-[4/3] w-full rounded-md bg-subtle object-cover" />
                        <figcaption className="mt-1 text-xs text-muted">Originale</figcaption>
                      </figure>
                      <figure>
                        <img src={dataSrc(t.altered)} alt={`${t.id}: ${t.description}`} loading="lazy" decoding="async" className="aspect-[4/3] w-full rounded-md bg-subtle object-cover" />
                        <figcaption className="mt-1 text-xs text-muted">{t.is_alteration ? "Alterata" : "Solo correzione"}</figcaption>
                      </figure>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted">{t.id}</span>
                      <Pill tone={t.is_alteration ? "bad" : "neutral"}>{t.is_alteration ? "Alterazione" : "Controllo"}</Pill>
                      <span className="text-sm font-medium">{t.type}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted">{t.description}</p>
                    <p className={`mt-2 flex items-center gap-1.5 text-sm font-semibold ${good ? "text-ok" : "text-bad"}`}>
                      {good ? <IconCheck /> : <IconAlert />}
                      {t.is_alteration ? (caught ? "Rilevata" : "Sfuggita") : caught ? "Falso allarme" : "Nessun allarme (corretto)"}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {t.detected_by.length
                        ? `Segnalata da: ${t.detected_by.filter((d) => d !== finalDetector?.id).map(detectorName).join(", ") || detectorName(t.detected_by[0])}`
                        : "Nessun rilevatore l'ha segnalata"}
                    </p>
                  </Card>
                );
              })}
            </ul>
          </Section>

          <Section id="obiettivi" title="Obiettivi per difetto" lead="Un difetto è «corretto» quando la metrica passa da fuori a dentro l'obiettivo. Soglie tarate su foto di interni da annuncio.">
            <div className="overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="data-table min-w-[640px]">
                <thead>
                  <tr>
                    <th scope="col">Difetto</th>
                    <th scope="col">Metrica</th>
                    <th scope="col" className="num">
                      Obiettivo
                    </th>
                    <th scope="col">Come si misura</th>
                  </tr>
                </thead>
                <tbody>
                  {DEFECT_ORDER.map((d) => {
                    const m = METRIC_BY_KEY[DEFECT_METRIC[d]];
                    return (
                      <tr key={d}>
                        <th scope="row">{DEFECT_LABEL[d]}</th>
                        <td>{m.label}</td>
                        <td className="num">{targetLabel(m.key)}</td>
                        <td className="text-muted">{m.how}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="reale" title="Cosa è reale e cosa è simulato">
            <div className="overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="data-table min-w-[560px]">
                <thead>
                  <tr>
                    <th scope="col">Elemento</th>
                    <th scope="col">Stato</th>
                    <th scope="col">Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {r.real_vs_simulated.map((x) => (
                    <tr key={x.item}>
                      <th scope="row">{x.item}</th>
                      <td>
                        <Pill tone={STATUS_TONE[x.status] ?? "neutral"}>{STATUS_LABEL[x.status] ?? x.status}</Pill>
                      </td>
                      <td className="text-muted">{x.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="limiti" title="Limiti">
            <ul className="max-w-3xl space-y-2">
              {r.limits.map((l) => (
                <li key={l} className="flex gap-3 text-sm leading-relaxed">
                  <IconAlert className="mt-0.5 size-4 shrink-0 text-warn" />
                  {l}
                </li>
              ))}
            </ul>
          </Section>

          <Section id="prossimi" title="Prossimi passi">
            <ol className="grid gap-4 md:grid-cols-2">
              {NEXT_STEPS.map((s, i) => (
                <Card as="li" key={s.title}>
                  <p className="text-sm font-semibold text-accent">{i + 1}</p>
                  <h3 className="mt-1 font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.text}</p>
                </Card>
              ))}
            </ol>
          </Section>
        </div>
      </Container>
    </>
  );
}
