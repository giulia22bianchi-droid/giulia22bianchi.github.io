import { db } from '../db.js';
import { normalizeText, CATEGORY_INDEX, QUALITY_INDEX, COLOR_INDEX } from './lexicon.js';
import {
  rilevaLingua, interpretaRisposta, messaggio,
  traduciColore, traduciCategoria, traduciQualita,
} from './i18n.js';
import { resolveQuery, logUnresolved } from './resolver.js';
import { valuta } from './assistant.js';
import { registerSale, getItem, InventoryError } from './inventory.js';

// Conversazione del cliente: lingua → modello → ricambio → qualità → colore →
// prezzo → conferma → scarico. Ogni passo mancante viene chiesto, mai dedotto.

const GIORNI_CONSERVAZIONE = Number(process.env.CONVERSATION_RETENTION_DAYS || 90);

export function leggiConversazione(telefono) {
  const riga = db.prepare(`SELECT * FROM conversations WHERE phone = ?`).get(telefono);
  if (!riga) return { phone: telefono, name: null, lingua: 'it', stato: 'iniziale', contesto: {} };
  return { ...riga, contesto: JSON.parse(riga.contesto) };
}

function salvaConversazione({ phone, name, lingua, stato, contesto }) {
  db.prepare(
    `INSERT INTO conversations (phone, name, lingua, stato, contesto)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET
       name = COALESCE(excluded.name, conversations.name),
       lingua = excluded.lingua,
       stato = excluded.stato,
       contesto = excluded.contesto,
       updated_at = datetime('now')`,
  ).run(phone, name ?? null, lingua, stato, JSON.stringify(contesto ?? {}));
}

export function dimenticaCliente(telefono) {
  const conv = db.prepare(`DELETE FROM conversations WHERE phone = ?`).run(telefono);
  const msg = db.prepare(`DELETE FROM whatsapp_messages WHERE phone = ?`).run(telefono);
  return { conversazioni: conv.changes, messaggi: msg.changes };
}

// I dati personali non servono a tempo indeterminato
export function pulisciVecchieConversazioni() {
  db.prepare(`DELETE FROM conversations WHERE updated_at < datetime('now', ?)`).run(`-${GIORNI_CONSERVAZIONE} days`);
  db.prepare(`DELETE FROM whatsapp_messages WHERE created_at < datetime('now', ?)`).run(`-${GIORNI_CONSERVAZIONE} days`);
}

export function registraMessaggio({ id, phone, direzione, testo }) {
  db.prepare(
    `INSERT INTO whatsapp_messages (id, phone, direzione, testo) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(id, phone, direzione, testo);
}

export function giaElaborato(id) {
  return Boolean(db.prepare(`SELECT 1 FROM whatsapp_messages WHERE id = ?`).get(id));
}

function numeroScelto(testo, quante) {
  const match = normalizeText(testo).match(/^(\d{1,2})\b/);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= quante ? n - 1 : null;
}

function quantitaRichiesta(testo) {
  const match = normalizeText(testo).match(/(?<!\S)(\d{1,3})(?!\S)/);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= 999 ? n : null;
}

function perNome(testo, voci, campo = 'name') {
  const t = normalizeText(testo);
  if (!t) return null;
  const esatta = voci.findIndex((v) => normalizeText(v[campo]) === t);
  if (esatta >= 0) return esatta;
  const contenuta = voci.findIndex((v) => t.includes(normalizeText(v[campo])));
  return contenuta >= 0 ? contenuta : null;
}

/**
 * Il cliente può rispondere nella sua lingua ("black", "noir", "أسود"):
 * il lessico riporta la parola al termine del catalogo prima del confronto.
 */
function perSinonimo(testo, voci, indice, campo) {
  const parole = normalizeText(testo).split(' ').filter(Boolean);
  for (const lunghezza of [3, 2, 1]) {
    for (let i = 0; i + lunghezza <= parole.length; i += 1) {
      const chiave = indice.get(parole.slice(i, i + lunghezza).join(' '));
      if (!chiave) continue;
      const trovata = voci.findIndex((v) => v[campo] === chiave);
      if (trovata >= 0) return trovata;
    }
  }
  return null;
}

const scegliCategoria = (testo, voci) =>
  perNome(testo, voci) ?? perSinonimo(testo, voci, CATEGORY_INDEX, 'slug');
const scegliQualita = (testo, voci) =>
  perNome(testo, voci) ?? perSinonimo(testo, voci, QUALITY_INDEX, 'slug');
const scegliColore = (testo, voci) =>
  perNome(testo, voci) ?? perSinonimo(testo, voci, COLOR_INDEX, 'name');

function descriviArticolo(item, lingua) {
  return [
    item.brand_name,
    item.model_name,
    '–',
    traduciCategoria(item.category_slug, item.category_name, lingua),
    item.quality_name ? traduciQualita(item.quality_slug, item.quality_name, lingua) : null,
    item.color ? traduciColore(item.color, lingua) : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Dal contesto raccolto produce il messaggio successivo. */
function prosegui(contesto, lingua) {
  const esito = valuta({
    model: contesto.model,
    category: contesto.category,
    quality: contesto.quality,
    color: contesto.color,
  });
  const nomeModello = `${contesto.model.brand} ${contesto.model.name}`;

  switch (esito.status) {
    case 'ricambio_mancante': {
      if (esito.categorie.length === 0) {
        return {
          testo: messaggio('non_a_catalogo', lingua, { ricambio: '—', modello: nomeModello }),
          stato: 'iniziale',
          contesto: {},
        };
      }
      return {
        testo: messaggio('scegli_ricambio', lingua, {
          modello: nomeModello,
          voci: esito.categorie.map((c) => traduciCategoria(c.slug, c.name, lingua)),
        }),
        stato: 'scelta_ricambio',
        contesto: {
          ...contesto,
          opzioni: esito.categorie.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
        },
      };
    }

    case 'non_a_catalogo':
      return {
        testo: messaggio('non_a_catalogo', lingua, { ricambio: esito.category.name, modello: nomeModello }),
        stato: 'iniziale',
        contesto: {},
      };

    case 'variante_non_disponibile': {
      // Si riparte dalla scelta della qualità, senza perdere modello e ricambio
      const seguito = prosegui({ ...contesto, quality: null, color: null }, lingua);
      const avviso = messaggio('variante_non_disponibile', lingua, {
        alternative: esito.alternative
          .map((i) => [i.quality_name, i.color].filter(Boolean).join(' '))
          .join(', '),
      });
      return { ...seguito, testo: `${avviso}\n\n${seguito.testo}` };
    }

    case 'qualita_da_scegliere':
      return {
        testo: messaggio('scegli_qualita', lingua, {
          modello: nomeModello,
          ricambio: traduciCategoria(esito.category.slug, esito.category.name, lingua),
          voci: esito.qualities.map(
            (q) => `${traduciQualita(q.slug, q.name, lingua)} — ${q.prezzo.toFixed(2)} €`,
          ),
        }),
        stato: 'scelta_qualita',
        contesto: {
          ...contesto,
          opzioni: esito.qualities.map((q) => ({ id: q.quality_id, name: q.name, slug: q.slug })),
        },
      };

    case 'colore_da_scegliere':
      return {
        testo: messaggio('scegli_colore', lingua, {
          voci: esito.colors.map((c) => traduciColore(c.name, lingua)),
        }),
        stato: 'scelta_colore',
        contesto: { ...contesto, opzioni: esito.colors.map((c) => ({ id: c.item_id, name: c.name })) },
      };

    case 'esaurito':
      return {
        testo: messaggio('esaurito', lingua, { articolo: descriviArticolo(esito.item, lingua) }),
        stato: 'iniziale',
        contesto: {},
      };

    case 'disponibile':
    default:
      return {
        testo: messaggio('prezzo', lingua, {
          articolo: descriviArticolo(esito.item, lingua),
          prezzo: `${esito.item.price.toFixed(2)} €`,
        }),
        stato: 'conferma',
        contesto: { ...contesto, item_id: esito.item.id, quantita: 1 },
      };
  }
}

function nuovaRichiesta(testo, lingua) {
  const resolution = resolveQuery(testo);

  if (resolution.status === 'not_found') {
    logUnresolved({ query: testo, reason: 'not_found', channel: 'whatsapp' });
    return { testo: messaggio('chiedi_modello', lingua), stato: 'iniziale', contesto: {}, riconosciuto: false };
  }

  if (resolution.status === 'ambiguous') {
    logUnresolved({ query: testo, reason: 'ambiguous', candidates: resolution.models, channel: 'whatsapp' });
    return {
      testo: messaggio('scegli_modello', lingua, {
        voci: resolution.models.map((m) => `${m.brand} ${m.name}`),
      }),
      stato: 'scelta_modello',
      contesto: {
        candidati: resolution.models.map((m) => ({ id: m.id, name: m.name, brand: m.brand })),
        category: resolution.category,
        quality: resolution.quality,
        color: resolution.color,
      },
      riconosciuto: true,
    };
  }

  const m = resolution.models[0];
  return {
    ...prosegui(
      {
        model: { id: m.id, name: m.name, brand: m.brand },
        category: resolution.category,
        quality: resolution.quality,
        color: resolution.color,
      },
      lingua,
    ),
    riconosciuto: true,
  };
}

function confermaOrdine(contesto, lingua, telefono, nome) {
  const item = getItem(contesto.item_id);
  if (!item) {
    return { testo: messaggio('chiedi_modello', lingua), stato: 'iniziale', contesto: {} };
  }

  const quantita = Math.max(1, Number(contesto.quantita) || 1);
  if (item.quantity < quantita) {
    if (item.quantity <= 0) {
      return {
        testo: messaggio('esaurito', lingua, { articolo: descriviArticolo(item, lingua) }),
        stato: 'iniziale',
        contesto: {},
      };
    }
    return {
      testo: messaggio('quantita_insufficiente', lingua, { disponibili: item.quantity }),
      stato: 'conferma',
      contesto: { ...contesto, quantita: item.quantity },
    };
  }

  try {
    const vendita = registerSale({
      channel: 'whatsapp',
      customerPhone: telefono,
      customerName: nome ?? null,
      lines: [{ item_id: item.id, quantity: quantita }],
      actor: 'assistente whatsapp',
    });
    return {
      testo: messaggio('ordine_confermato', lingua, {
        articolo: descriviArticolo(item, lingua),
        quantita,
        totale: `${vendita.total.toFixed(2)} €`,
      }),
      stato: 'iniziale',
      contesto: {},
      vendita,
    };
  } catch (err) {
    if (err instanceof InventoryError && err.details?.available != null) {
      return {
        testo: messaggio('quantita_insufficiente', lingua, { disponibili: err.details.available }),
        stato: 'conferma',
        contesto: { ...contesto, quantita: err.details.available },
      };
    }
    throw err;
  }
}

/**
 * Elabora un messaggio del cliente e restituisce la risposta da inviare.
 * Non invia nulla: il trasporto (WhatsApp o simulatore) è separato.
 */
export function rispondi({ telefono, testo, nome = null }) {
  const conv = leggiConversazione(telefono);
  const lingua = rilevaLingua(testo, conv.lingua);
  const contesto = conv.contesto ?? {};
  let esito;

  if (conv.stato === 'scelta_modello' && contesto.candidati?.length) {
    const indice =
      numeroScelto(testo, contesto.candidati.length) ??
      perNome(testo, contesto.candidati.map((c) => ({ name: `${c.brand} ${c.name}` })));
    if (indice != null) {
      const scelto = contesto.candidati[indice];
      esito = prosegui(
        { model: scelto, category: contesto.category, quality: contesto.quality, color: contesto.color },
        lingua,
      );
    }
  } else if (conv.stato === 'scelta_ricambio' && contesto.opzioni?.length) {
    const indice = numeroScelto(testo, contesto.opzioni.length) ?? scegliCategoria(testo, contesto.opzioni);
    if (indice != null) {
      const scelta = contesto.opzioni[indice];
      esito = prosegui({ ...contesto, category: scelta, opzioni: undefined }, lingua);
    }
  } else if (conv.stato === 'scelta_qualita' && contesto.opzioni?.length) {
    const indice = numeroScelto(testo, contesto.opzioni.length) ?? scegliQualita(testo, contesto.opzioni);
    if (indice != null) {
      const scelta = contesto.opzioni[indice];
      esito = prosegui({ ...contesto, quality: scelta, opzioni: undefined }, lingua);
    }
  } else if (conv.stato === 'scelta_colore' && contesto.opzioni?.length) {
    const indice = numeroScelto(testo, contesto.opzioni.length) ?? scegliColore(testo, contesto.opzioni);
    if (indice != null) {
      const scelta = contesto.opzioni[indice];
      esito = prosegui({ ...contesto, color: scelta.name, opzioni: undefined }, lingua);
    }
  } else if (conv.stato === 'conferma' && contesto.item_id) {
    const risposta = interpretaRisposta(testo);
    const quantita = quantitaRichiesta(testo);
    if (risposta === 'no') {
      esito = { testo: messaggio('annullato', lingua), stato: 'iniziale', contesto: {} };
    } else if (risposta === 'si' || quantita != null) {
      // Una richiesta di prezzo non scarica nulla: si arriva qui solo confermando
      esito = confermaOrdine({ ...contesto, quantita: quantita ?? contesto.quantita }, lingua, telefono, nome);
    }
  }

  // Nessuna scelta riconosciuta: forse il cliente sta chiedendo un altro pezzo
  if (!esito) {
    const tentativo = nuovaRichiesta(testo, lingua);
    esito =
      tentativo.riconosciuto || conv.stato === 'iniziale'
        ? tentativo
        : { testo: messaggio('non_capito', lingua), stato: conv.stato, contesto };
  }

  salvaConversazione({
    phone: telefono,
    name: nome,
    lingua,
    stato: esito.stato,
    contesto: esito.contesto,
  });

  return { testo: esito.testo, lingua, stato: esito.stato, vendita: esito.vendita ?? null };
}
