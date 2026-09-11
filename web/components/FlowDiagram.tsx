// Agentic flow: Diagnosi → Instradamento → Miglioramento → Verifica di fedeltà → Approvazione dell'agente.
// Pure HTML/CSS: horizontal on large screens (with the "retry" loop drawn under steps 2–4), vertical on mobile.

const STEPS = [
  {
    title: "Diagnosi",
    text: "Misura sette metriche tecniche e le confronta con obiettivi espliciti: luce, alte luci, colore, verticali, nitidezza, rumore, risoluzione.",
    tool: "Metriche OpenCV",
    human: false,
  },
  {
    title: "Instradamento",
    text: "Sceglie il workflow adatto ai difetti trovati: correzione deterministica se bastano luce e geometria, generativo solo se serve ricostruire dettaglio.",
    tool: "Regole + risultati del laboratorio",
    human: false,
  },
  {
    title: "Miglioramento",
    text: "Esegue il workflow scelto e misura di nuovo: quali difetti sono rientrati, quali restano, se ne sono nati di nuovi.",
    tool: "Workflow scelto dal router",
    human: false,
  },
  {
    title: "Verifica di fedeltà",
    text: "Confronto strutturale con l'originale e checklist dei giudici AI: oggetti, finestre, materiali, geometria, difetti nascosti, testi.",
    tool: "gradient-SSIM · DINOv2 · giudici AI",
    human: false,
  },
  {
    title: "Approvazione dell'agente",
    text: "L'agente vede prima e dopo e cosa è cambiato: accetta, prova un'alternativa o tiene l'originale. La foto pubblicata porta l'etichetta AI.",
    tool: "Studio",
    human: true,
  },
];

export function FlowDiagram() {
  return (
    <figure>
      <ol className="grid gap-3 lg:grid-cols-5 lg:gap-4" aria-label="Flusso di FotoFedele in cinque passaggi">
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative">
            <div className={`flex h-full flex-col rounded-xl border p-4 ${s.human ? "border-accent bg-accent-soft" : "border-line bg-surface"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-accent text-sm font-bold text-on-accent" aria-hidden="true">
                  {i + 1}
                </span>
                <span className={`text-xs font-medium ${s.human ? "text-accent" : "text-muted"}`}>{s.human ? "Persona" : "Automatico"}</span>
              </div>
              <h3 className="mt-3 font-semibold">{s.title}</h3>
              <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted">{s.text}</p>
              <p className="mt-3 border-t border-line pt-2 font-mono text-[11px] text-muted">{s.tool}</p>
            </div>
            {i < STEPS.length - 1 && (
              <>
                {/* connector: right arrow on desktop, down arrow on mobile */}
                <span aria-hidden="true" className="absolute top-1/2 -right-3.5 z-10 hidden -translate-y-1/2 text-line-strong lg:block">
                  <svg viewBox="0 0 12 12" className="size-3" fill="currentColor">
                    <path d="M2 1.5 10 6l-8 4.5z" />
                  </svg>
                </span>
                <span aria-hidden="true" className="flex justify-center py-1 text-line-strong lg:hidden">
                  <svg viewBox="0 0 12 12" className="size-3" fill="currentColor">
                    <path d="M1.5 2 6 10l4.5-8z" />
                  </svg>
                </span>
              </>
            )}
            {i === 3 && (
              <p className="mt-2 rounded-lg border border-dashed border-warn/60 px-3 py-2 text-xs text-warn lg:hidden">
                Se la verifica segnala un&apos;alterazione si torna al passo 2: alternativa più conservativa o foto originale.
              </p>
            )}
          </li>
        ))}
      </ol>
      {/* Retry loop from step 4 back to step 2 (desktop). Column centres of a 5-column grid: 30% and 70%. */}
      <div aria-hidden="true" className="relative mt-1 hidden h-12 lg:block">
        <div className="absolute top-0 right-[30%] left-[30%] h-6 rounded-b-xl border-2 border-t-0 border-dashed border-warn/70" />
        <svg viewBox="0 0 12 12" className="absolute -top-1.5 left-[30%] size-3 -translate-x-[5px] text-warn" fill="currentColor">
          <path d="M1.5 10 6 2l4.5 8z" />
        </svg>
        <p className="absolute top-7 left-1/2 -translate-x-1/2 bg-canvas px-2 text-xs whitespace-nowrap text-warn">
          flag di fedeltà → alternativa più conservativa o foto originale
        </p>
      </div>
      <figcaption className="sr-only">
        Se la verifica di fedeltà segnala un&apos;alterazione, il flusso torna all&apos;instradamento e propone
        un&apos;alternativa più conservativa o la foto originale.
      </figcaption>
    </figure>
  );
}
