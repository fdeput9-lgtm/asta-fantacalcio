// netlify/functions/state.mjs
//
// Backend condiviso dell'Asta Fantacalcio a Chiamata.
// Tutta la logica di gioco (login, chiamata giocatore, offerte, vendita, turni)
// vive qui, lato server, salvata su Netlify Blobs con consistenza forte.
// Ogni client (Master, ogni squadra, spettatore) fa polling su GET /state
// e invia azioni via POST /state per restare sincronizzato in tempo reale.

import { getStore } from "@netlify/blobs";

// ---- DATI STATICI DELL'ASTA ----
const PLAYERS = [
  { id:1, nome:"Andrea Hada", ruoli:["ATT"], eta:14, valore:33, squadra:"SVINCOLATO", caratteristiche:["Tiro Preciso","Talento","Cecchino","Rigorista"] },
  { id:2, nome:"Michele Freda", ruoli:["DIF"], eta:14, valore:45, squadra:"ALIUS FC", caratteristiche:["Muro","Regista"] },
  { id:3, nome:"Wassim Jbilou", ruoli:["ATT"], eta:14, valore:75, squadra:"ROYAL ACADEMY", caratteristiche:["Illusionista","Passaggi Incisivi","Tecnico","Inventivo"] },
  { id:4, nome:"Hamza Charifi", ruoli:["ATT"], eta:17, valore:60, squadra:"SVINCOLATO", caratteristiche:["Enfoncer","Tiro Potente","Rapido","Finalizzatore"] },
  { id:5, nome:"Yassir Charifi", ruoli:["ATT"], eta:11, valore:80, squadra:"SVINCOLATO", caratteristiche:["Tecnico","Illusionista","Gamechanger","Talento","Acrobata"] },
  { id:6, nome:"Ilias Kone", ruoli:["ATT","CEN","DIF"], eta:14, valore:75, squadra:"SVINCOLATO", caratteristiche:["Regista","Rapido","Playmaker","Gamechanger","Passaggi Incisivi"] },
  { id:7, nome:"Mohamed El Ghabi", ruoli:["DIF"], eta:13, valore:40, squadra:"SVINCOLATO", caratteristiche:["Veloce","Mastino","Talento","Offensivo"] },
  { id:8, nome:"Ibrahima Zangare", ruoli:["ATT"], eta:16, valore:55, squadra:"SVINCOLATO", caratteristiche:["Enfoncer","Rapace","Leadership"] },
];

// Codici di accesso assegnati in ordine alle squadre (Squadra 1 -> ABC, ecc.)
const TEAM_CODES = ["ABC", "DIH", "GOON", "ZEFE"];
const MASTER_CODE = "RONALDOTHEGOAT";

const STORE_NAME = "asta-fantacalcio";
const STATE_KEY = "state";

function defaultState() {
  return {
    auctionStarted: false,
    teams: [
      { name:"Squadra 1", budget:100, players:[] },
      { name:"Squadra 2", budget:100, players:[] },
      { name:"Squadra 3", budget:100, players:[] },
      { name:"Squadra 4", budget:100, players:[] },
    ],
    startBudget: 100,
    countdownSecs: 15,
    available: [],       // giocatori non ancora chiamati/venduti (vuoto finché l'asta non parte)
    turnIdx: 0,           // indice della squadra a cui tocca chiamare
    currentPlayer: null,  // giocatore attualmente in asta
    callerIdx: null,      // chi l'ha chiamato
    currentBid: 0,
    currentBidder: null,
    deadline: null,       // timestamp ms epoch di fine countdown, null se nessuna asta in corso
    soldResult: null,     // { playerName, teamIdx, price } dopo una vendita, finché il Master non passa il turno
    ended: false,         // true quando tutti i giocatori sono stati assegnati e l'asta è chiusa definitivamente
  };
}

async function getStateStore() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

async function loadState() {
  const store = await getStateStore();
  const s = await store.get(STATE_KEY, { type: "json" });
  return s || defaultState();
}

async function saveState(state) {
  const store = await getStateStore();
  await store.setJSON(STATE_KEY, state);
}

// Applica la vendita automatica se il countdown è scaduto e nessuno ha ancora "raccolto" il risultato.
// Va chiamata ad ogni lettura/scrittura per mantenere lo stato coerente anche se nessun client
// ha fatto polling esattamente nel momento dello scadere.
function resolveExpiredAuction(state) {
  if (state.currentPlayer && state.deadline !== null && Date.now() >= state.deadline && !state.soldResult) {
    const p = state.currentPlayer;
    const ti = state.currentBidder;
    const price = state.currentBid;
    state.teams[ti].budget -= price;
    state.teams[ti].players.push({ ...p, price });
    state.soldResult = { playerName: p.nome, playerId: p.id, teamIdx: ti, price };
    state.deadline = null;
  }
  return state;
}

function publicError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function ok(state) {
  return new Response(JSON.stringify(state), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req, context) => {
  if (req.method === "GET") {
    let state = await loadState();
    state = resolveExpiredAuction(state);
    await saveState(state);
    return ok(state);
  }

  if (req.method !== "POST") {
    return publicError("Metodo non supportato", 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return publicError("Corpo della richiesta non valido");
  }

  const { action } = body;
  let state = await loadState();
  state = resolveExpiredAuction(state);

  switch (action) {
    case "reset": {
      // Solo per il Master: azzera completamente l'asta (nuova partita)
      state = defaultState();
      break;
    }

    case "login": {
      // Verifica il codice e ritorna l'esito; non modifica lo stato condiviso.
      const { role, teamIndex, code } = body;
      const upperCode = (code || "").trim().toUpperCase();
      if (role === "master") {
        if (upperCode !== MASTER_CODE) return publicError("Codice errato");
      } else if (role === "team") {
        const expected = TEAM_CODES[teamIndex];
        if (!expected || upperCode !== expected) return publicError("Codice errato");
      } else {
        return publicError("Ruolo non valido");
      }
      await saveState(state);
      return ok(state);
    }

    case "setup-update": {
      // Configurazione pre-asta: budget, secondi countdown, nomi/numero squadre.
      if (state.auctionStarted) return publicError("L'asta è già stata avviata");
      const { startBudget, countdownSecs, teamNames } = body;
      if (typeof startBudget === "number" && startBudget > 0) {
        state.startBudget = startBudget;
        state.teams.forEach(t => t.budget = startBudget);
      }
      if (typeof countdownSecs === "number" && countdownSecs >= 5) {
        state.countdownSecs = countdownSecs;
      }
      if (Array.isArray(teamNames)) {
        state.teams = teamNames.map((name, i) => ({
          name: name || `Squadra ${i + 1}`,
          budget: state.startBudget,
          players: state.teams[i]?.players || [],
        }));
      }
      break;
    }

    case "add-team": {
      if (state.auctionStarted) return publicError("L'asta è già stata avviata");
      state.teams.push({ name: `Squadra ${state.teams.length + 1}`, budget: state.startBudget, players: [] });
      break;
    }

    case "remove-team": {
      if (state.auctionStarted) return publicError("L'asta è già stata avviata");
      const { teamIndex } = body;
      if (state.teams.length > 2) state.teams.splice(teamIndex, 1);
      break;
    }

    case "start-auction": {
      if (state.teams.some(t => !t.name.trim())) return publicError("Tutte le squadre devono avere un nome");
      state.teams.forEach(t => { t.budget = state.startBudget; t.players = []; });
      state.available = [...PLAYERS];
      state.turnIdx = 0;
      state.currentPlayer = null;
      state.callerIdx = null;
      state.currentBid = 0;
      state.currentBidder = null;
      state.deadline = null;
      state.soldResult = null;
      state.ended = false;
      state.auctionStarted = true;
      break;
    }

    case "call-player": {
      // callerIdx: chi sta chiamando (può essere il Master per conto della squadra di turno,
      // o il dirigente stesso — entrambi devono coincidere con la squadra di turno).
      const { playerId } = body;
      if (state.currentPlayer) return publicError("C'è già un giocatore in asta");
      if (state.soldResult) return publicError("Passa prima il turno");
      const idx = state.available.findIndex(p => p.id === playerId);
      if (idx === -1) return publicError("Giocatore non disponibile");
      const p = state.available.splice(idx, 1)[0];
      state.currentPlayer = p;
      state.callerIdx = state.turnIdx;
      state.currentBid = 1;
      state.currentBidder = state.turnIdx;
      state.soldResult = null;
      state.deadline = Date.now() + state.countdownSecs * 1000;
      break;
    }

    case "bid": {
      const { teamIndex, amount } = body;
      if (!state.currentPlayer || state.soldResult) return publicError("Nessuna asta in corso");
      const team = state.teams[teamIndex];
      if (!team) return publicError("Squadra non valida");
      const newBid = state.currentBid + (amount || 1);
      if (newBid > team.budget) return publicError(`${team.name} non ha crediti sufficienti`);
      state.currentBid = newBid;
      state.currentBidder = teamIndex;
      // Rilancio = +5 secondi al countdown, con un tetto di 2x il tempo base per evitare aste infinite.
      const capMs = state.countdownSecs * 2 * 1000;
      let remainingMs = (state.deadline - Date.now()) + 5000;
      remainingMs = Math.min(remainingMs, capMs);
      state.deadline = Date.now() + Math.max(0, remainingMs);
      break;
    }

    case "advance-turn": {
      // Chiamata dal Master dopo aver visto il risultato della vendita: passa il turno.
      if (!state.soldResult) return publicError("Nessuna vendita da confermare");
      state.currentPlayer = null;
      state.callerIdx = null;
      state.currentBid = 0;
      state.currentBidder = null;
      state.deadline = null;
      state.soldResult = null;
      if (state.teams.length > 0) {
        state.turnIdx = (state.turnIdx + 1) % state.teams.length;
      }
      if (state.available.length === 0) state.ended = true;
      break;
    }

    default:
      return publicError("Azione non riconosciuta");
  }

  await saveState(state);
  return ok(state);
};
