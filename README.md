# FotoFedele — foto degli annunci migliori, senza alterare la casa

Case study *Product Builder, Agentic AI Products* · Immobiliare.it · settembre 2026
**Demo:** ⟨URL⟩ · **Codice:** https://github.com/micheleguidaa/fotofedele ([`pipeline/`](pipeline/) Python, [`web/`](web/) Next.js) · **Screenshot:** [risultati](docs/screenshots/risultati.jpg), [studio](docs/screenshots/studio.jpg), [heatmap](docs/screenshots/laboratorio-heatmap.jpg)

## 1. Perimetro
**Per chi:** agenti e inserzionisti che caricano foto da smartphone. **Bisogno:** foto presentabili in pochi secondi, senza rischiare annunci ingannevoli.
**Cosa fa:** misura i difetti tecnici (buio, dominanti, verticali, nitidezza, risoluzione), migliora la foto, **verifica che la casa sia rimasta la stessa**, fa approvare l'agente ed etichetta la foto.
**Cosa non fa:** virtual staging, rimozione di oggetti, cambio di vista o cielo, riparazione di crepe o macchie, cambio di materiali.
**Rischi evitati:** oggetti, viste o pavimenti inventati, stanze più grandi del vero, difetti nascosti, effetto «finto AI», costi fuori controllo.

## 2. Il prototipo
Flusso agentico: **Diagnosi → Instradamento → Miglioramento → Verifica di fedeltà → Approvazione**, con fallback all'alternativa più conservativa o all'originale.
La web app ha quattro sezioni: **Studio** (il prodotto visto dall'agente), **Laboratorio** (classifica, pesi, costo e qualità, dettaglio con heatmap), **Metodo** e **Arena** (voto umano, progettato).
Pipeline `python -m fotolab run | evaluate | judge | aggregate`, con i flussi dichiarati in configurazione e ogni run e giudizio salvato in JSONL.
**Dataset:** 18 foto reali con difetti da annunci Immobiliare.it, senza il watermark della piattaforma grazie a un filtro automatico, più 6 foto buone **degradate in modo controllato** per avere una verità di riferimento.

## 3. Workflow testati (ogni coppia risponde a una domanda)
| | Flusso | Motore | Domanda |
|---|---|---|---|
| F1 | Classico: verticali, bianco, esposizione, rumore, Real-ESRGAN sotto 0,6 MP | OpenCV, H200 | Quanto si ottiene a costo ~0 e senza allucinazioni? |
| F2 | gpt-image, prompt semplice («rendila professionale») | Codex CLI, abbonamento ChatGPT | — |
| F3 | gpt-image, prompt vincolato (cosa migliorare, cosa NON toccare) | idem | F2 vs F3: quanto conta il prompt? |
| F4 | Qwen-Image-Edit 2511 open weights + Lightning, stesso prompt | ComfyUI su H200 | F3 vs F4: modello chiuso o open? |
| F5 | **Ibrido:** da F3 prendo solo curva tonale, matrice colore e luce sfocata, e le applico ai pixel originali | Python | F3 vs F5: generare pixel o trasferire il look? |

F6 (Gemini) non è stato eseguito: la CLI rifiuta gli account individuali, la web app non ha API e Vertex è a consumo. Ho scelto di usare solo l'abbonamento ChatGPT e modelli self-hosted.

## 4. Parametri e regola di decisione
Tutto è fissato prima dell'aggregazione, in `pipeline/config/decision.yaml`.
- **Qualità:**
  - win-rate a coppie contro l'originale, con IC bootstrap al 95%;
  - quota di difetti riportati entro gli obiettivi misurati;
  - PSNR, SSIM e LPIPS dove esiste la verità.
- **Costo/foto:** listino gpt-image-2 (0,165 $) e tempo GPU H200 a 4,40 $/h. Sono stime.
- **Tempo:** latenza p50 e p90.
- **Affidabilità:** quota di richieste riuscite.
- **Rischio di alterazione:** quota di foto segnalate dalla verifica di fedeltà (§5).

La regola:
1. **Gate:** affidabilità ≥ 95% e foto segnalate ≤ 5%.
2. **Punteggio** per chi li supera: 0,5·qualità + 0,2·naturalezza + 0,15·costo + 0,15·velocità, con i pesi regolabili nel Laboratorio. Un flusso che altera la casa non vince con nessun peso.

## 5. Come misuro il qualitativo
- **Rubrica ancorata** (6 criteri, voti 1-3-5 descritti) e **confronto a coppie alla cieca** invece di voti assoluti.
- **Checklist binaria di fedeltà:** oggetti, vista, materiali, geometria, difetti nascosti, loghi.
- **Tre giudici di famiglie diverse:** Gemma 4 e Qwen 3.8 sulla VM, GPT via Codex. Nessun giudice valuta la propria famiglia. Ogni coppia è chiesta nei due ordini.
- **Meta-validazione:** accuratezza dove la verità è nota, accordo tra giudici (α di Krippendorff), preferenza per la propria famiglia.
- **Rilevatore strutturale indipendente:** confronta i gradienti dopo l'allineamento, produce la heatmap delle zone ridisegnate e misura il contenuto inventato ai bordi.
- **12 trappole:** 6 alterazioni vere e 6 modifiche innocue. Servono a misurare precision e recall dei rilevatori e a calibrare la regola finale.

## 6. Risultati
| | Preferito all'originale | Foto segnalate | **Migliore e fedele** | Costo/foto (stima) | Latenza p50 |
|---|---|---|---|---|---|
| F1 classico | 60% | 8% | 52% | 0,0002 $ | 0,3 s |
| F2 gpt-image semplice (12 foto) | 100% | **92%** | 8% | 0,165 $ | 53 s |
| F3 gpt-image vincolato | 94% | **83%** | 17% | 0,165 $ | 108 s |
| F4 Qwen open weights | 81% | 25% | **58%** | 0,006 $ | 10 s |
| F5 ibrido | 56% | 8% | 54% | 0,165 $ | 108 s |

- **Nessun flusso supera il gate del 5%.** Quindi niente pubblicazione automatica: la verifica gira foto per foto e l'agente approva.
- **Il router è F1 → F4:** si prova il classico e, se la verifica lo scarta o la foto non migliora, si passa a Qwen. Consegna **il 50% delle foto migliorate e fedeli a 0,006 $ di media**, contro il 17% a 0,165 $ di gpt-image da solo. L'ordine usa il punteggio dichiarato, con la quota «migliore e fedele» al posto del win-rate.
- **gpt-image fa le foto più belle ma ridisegna la casa.** Nel test iniziale ha inventato uno skyline dietro le tende e su R01 ha ricolorato le pareti. Il prompt vincolato riduce le segnalazioni dal 92% all'83% e l'area ridisegnata dal 23% al 13%, ma non basta.
- **L'ibrido F5 conserva i pixel originali** (8% di segnalazioni), ma eredita costo e latenza di gpt-image.
- **Misura della misura:**
  - la regola finale ha precision e recall 1,00 sulle trappole, mentre il solo rilevatore strutturale ha recall 0,83 perché non vede un logo cancellato;
  - i tre giudici riconoscono l'originale pulito nel 100% dei casi;
  - l'accordo tra giudici è moderato (α 0,50);
  - Qwen favorisce la propria famiglia (81% contro 67%).
- **Iterazione:** F1 e F5 v1 tagliavano loghi ai bordi, e F5 v1 dava un effetto slavato. Li ho corretti e rimisurati; le v1 sono archiviate.

## 7. Strumenti
Claude Code per architettura, codice e analisi, con un agente in parallelo per la web app. Codex CLI per gpt-image e il giudice GPT. ComfyUI e Ollama su H200 per Qwen-Image-Edit, Real-ESRGAN, Gemma e Qwen VL. Python con OpenCV, PyTorch, LPIPS, pyiqa e DINOv2. Next.js su Vercel.

## 8. Reale, stimato, simulato
- **Reale:** foto, output dei 5 flussi, metriche, giudizi AI, latenze.
- **Stimato:** i costi, perché l'abbonamento non espone prezzi unitari; la latenza di gpt-image, che include l'overhead dell'agente Codex.
- **Simulato:** le degradazioni controllate, l'integrazione nel back-office e il caricamento live, che funziona solo in locale.
- **Progettato, non eseguito:** l'arena umana e l'A/B test su annunci veri.

## 9. Limiti
- **Campione piccolo:** 24 foto, 12 per F2. Gli intervalli di confidenza sono ampi.
- **Nessun valutatore umano.** Su F4 decide soprattutto Gemma, perché Qwen è escluso per conflitto e GPT ha coperto solo 7 coppie prima della fine del quota.
- **Trappole poche** e generate da un solo modello.
- **Quota ChatGPT:** circa 20 generazioni per finestra, con alcune richieste da ripetere. Non è una strada da produzione.
- **Foto già ricompresse** dal portale (al massimo 1,6 MP) e **soglia strutturale severa per scelta**: anche il dettaglio ridisegnato conta come alterazione.

## 10. Prossimi passi
1. Calibrare i giudici con 5–10 persone nell'Arena (Bradley-Terry) e sostituire il giudice più debole, oggi Gemma sulle trappole.
2. A/B test su annunci veri, misurando CTR dalla lista risultati e tasso di contatto.
3. Un router appreso per difetto e per stanza, con il generativo solo dove serve dettaglio.
4. API a costo noto (batch, cache) al posto degli abbonamenti, con un budget per foto e un fallback automatico.
