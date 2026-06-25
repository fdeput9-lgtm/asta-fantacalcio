# Asta Fantacalcio a Chiamata — versione multi-dispositivo

Questa versione funziona davvero da più telefoni/PC contemporaneamente:
tutto lo stato dell'asta (turni, offerte, countdown, budget) vive su un
backend condiviso (una Netlify Function + Netlify Blobs), non più nella
memoria del singolo browser.

## Come fare il deploy

### Opzione A — Drag & drop su Netlify (più semplice)

⚠️ Il drag & drop "semplice" di una cartella su Netlify **NON** carica le
Netlify Functions. Per avere anche il backend devi usare uno dei due metodi
sotto (Git oppure Netlify CLI).

### Opzione B — Collegare un repository Git (raccomandato)

1. Crea un nuovo repository (es. su GitHub) e carica dentro **tutti** i file
   di questa cartella, mantenendo la stessa struttura:
   ```
   ├── netlify.toml
   ├── package.json
   ├── index.html
   └── netlify/
       └── functions/
           └── state.mjs
   ```
2. Su [app.netlify.com](https://app.netlify.com) → "Add new site" → "Import an existing project"
   → collega il repository.
3. Netlify rileva automaticamente `netlify.toml`: build command vuoto,
   publish directory `.`, functions directory `netlify/functions`.
   Lascia tutto com'è e clicca "Deploy".
4. Dopo il primo deploy, la function sarà raggiungibile su
   `https://<il-tuo-sito>.netlify.app/.netlify/functions/state` — il
   frontend la chiama già da solo, non devi configurare nulla a mano.

### Opzione C — Netlify CLI da terminale

```bash
npm install -g netlify-cli
cd asta-netlify
netlify deploy --prod
```
Segui le istruzioni a schermo per collegare/creare il sito.

## Note importanti

- **Netlify Blobs** è incluso gratuitamente nel piano Netlify base: non serve
  creare nessun account esterno (niente Firebase, niente database a parte).
- Lo stato è condiviso tra **tutti** i dispositivi che visitano il sito: chi
  fa login come Master da un telefono e avvia l'asta, la fa partire per
  tutti gli altri dispositivi che caricano lo stesso URL.
- Ogni dispositivo aggiorna la sua vista circa ogni secondo (polling). Le
  azioni (chiamare un giocatore, fare un'offerta) vengono inviate subito al
  server e si propagano agli altri al polling successivo.
- Per ricominciare una nuova asta da zero, usa il bottone "Nuova Asta" nella
  schermata dei risultati finali — resetta lo stato condiviso per tutti.
- I codici di accesso sono gli stessi di prima: Master `RONALDOTHEGOAT`,
  Squadra 1 `ABC`, Squadra 2 `DIH`, Squadra 3 `GOON`, Squadra 4 `ZEFE`.
  Si possono modificare editando le costanti `TEAM_CODES`/`MASTER_CODE` in
  `netlify/functions/state.mjs`.
