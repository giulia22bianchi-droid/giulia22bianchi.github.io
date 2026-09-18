import { db, normalizeCode } from '../db.js';
import { resolveQuery } from './resolver.js';
import { ITEM_SELECT, InventoryError } from './inventory.js';

// Un PDF illeggibile è un problema del documento, non un errore del server
class PdfError extends InventoryError {
  constructor(message) {
    super(message, 422);
  }
}

// Righe che non sono prodotti: intestazioni, totali, dati fiscali.
const NOISE = /\b(totale|imponibile|iva|p\.?\s?iva|partita iva|codice fiscale|pagina|page|fattura|ddt|documento|trasporto|destinatario|mittente|spett|indirizzo|telefono|email|pec|iban|bonifico|scadenza|pagamento|sconto totale|netto a pagare|aliquota|imposta|vettore|colli|peso|firma|causale|data|cliente|fornitore)\b/i;

const QTY_MARKERS = /(?:^|\s)(?:q(?:\.|u)?t(?:[àa]|y)?\.?|quant(?:it[àa])?\.?|pezzi|pz\.?|pcs\.?|nr\.?|n[.°])\s*[:.]?\s*(\d{1,4})(?!\d)|(?:^|\s)x\s*(\d{1,4})(?!\d)|(\d{1,4})\s*(?:pz\.?|pcs\.?|pezzi)(?!\w)/i;

const DECIMAL = /\d{1,6}[.,]\d{2}(?!\d)/g;

function parseDecimal(value) {
  return Number(String(value).replace(/\./g, '').replace(',', '.'));
}

/**
 * Estrae quantità e prezzo da una riga già ripulita dal codice/modello,
 * così i numeri del codice (A526, XT2083) non vengono scambiati per quantità.
 */
function extractNumbers(raw, consumedTokens) {
  const decimals = (raw.match(DECIMAL) ?? []).map(parseDecimal).filter((n) => n > 0);

  // Prima si tolgono gli importi, poi i codici già riconosciuti (dal più lungo,
  // così "A526" non viene spezzato togliendo prima "A52"): ciò che resta è la quantità.
  let cleaned = ` ${raw.replace(DECIMAL, ' ')} `;
  const tokens = [...new Set(consumedTokens.filter(Boolean).map(String))].sort((a, b) => b.length - a.length);
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'gi'), ' ');
  }

  let quantity = null;
  let quantitySource = null;
  const marker = cleaned.match(QTY_MARKERS) ?? raw.match(QTY_MARKERS);
  if (marker) {
    quantity = Number(marker[1] ?? marker[2] ?? marker[3]);
    quantitySource = 'etichetta';
  } else {
    const integers = (cleaned.match(/(?<![\w.,])\d{1,3}(?![\w.,])/g) ?? []).map(Number);
    const plausible = integers.filter((n) => n > 0 && n <= 500);
    if (plausible.length === 1) {
      quantity = plausible[0];
      quantitySource = 'dedotta';
    }
  }

  let unitCost = null;
  if (decimals.length === 1) {
    unitCost = decimals[0];
  } else if (decimals.length > 1) {
    const sorted = [...decimals].sort((a, b) => a - b);
    if (quantity) {
      // Il prezzo unitario è quello che moltiplicato per la quantità dà un altro importo della riga
      const match = sorted.find((candidate) =>
        decimals.some((other) => Math.abs(candidate * quantity - other) < 0.02 && other !== candidate),
      );
      unitCost = match ?? sorted[0];
    } else {
      unitCost = sorted[0];
    }
  }

  return { quantity, quantitySource, unitCost, decimals };
}

export function findExistingItem({ modelId, categoryId, qualityId, color }) {
  return db
    .prepare(
      `${ITEM_SELECT} WHERE i.model_id = ? AND i.category_id = ? AND i.quality_id IS ? AND i.color = ?`,
    )
    .get(modelId, categoryId, qualityId ?? null, color ?? '');
}

export function parseLine(raw, index = 0) {
  const text = String(raw).replace(/\s+/g, ' ').trim();
  const line = {
    indice: index,
    riga: text,
    stato: 'da_verificare',
    azione: 'verifica',
    note: [],
  };

  if (text.length < 6 || NOISE.test(text)) {
    line.stato = 'ignorata';
    line.azione = 'ignora';
    line.note.push('Riga non riconosciuta come prodotto');
    return line;
  }

  const resolution = resolveQuery(text);
  const consumed = [
    ...resolution.codes,
    ...(resolution.matchedWords?.category ?? []),
    ...(resolution.matchedWords?.quality ?? []),
    ...(resolution.matchedWords?.color ?? []),
    ...(resolution.models[0]?.name.split(' ') ?? []),
  ];
  const { quantity, quantitySource, unitCost } = extractNumbers(text, consumed);

  line.resolution = {
    status: resolution.status,
    models: resolution.models.slice(0, 5),
    category: resolution.category,
    quality: resolution.quality,
    color: resolution.color,
    codes: resolution.codes,
  };
  const identified = resolution.status === 'ok' ? resolution.models[0] : null;
  line.brand_name = identified?.brand ?? null;
  line.model_id = identified?.id ?? null;
  line.model_name = identified?.name ?? null;
  line.model_code = identified?.codes?.[0] ?? resolution.codes[0] ?? null;

  // Il codice che non appartiene al telefono è il riferimento articolo del fornitore
  const modelCodes = (identified?.codes ?? []).map(normalizeCode);
  const belongsToModel = (code) => {
    const value = normalizeCode(code);
    return modelCodes.some((mc) => mc.includes(value) || value.includes(mc));
  };
  line.sku = resolution.codes.find((c) => /[a-z]/i.test(c) && !belongsToModel(c)) ?? null;
  line.category_id = resolution.category?.id ?? null;
  line.category_name = resolution.category?.name ?? null;
  line.quality_id = resolution.quality?.id ?? null;
  line.quality_name = resolution.quality?.name ?? null;
  line.color = resolution.color ?? '';
  line.quantita = quantity;
  line.quantita_origine = quantitySource;
  line.costo_unitario = unitCost;

  if (resolution.status === 'ambiguous') line.note.push('Modello ambiguo: scegli tu quale');
  if (resolution.status === 'not_found') line.note.push('Modello non riconosciuto');
  if (!resolution.category) line.note.push('Tipo di ricambio non riconosciuto');
  if (quantity == null) line.note.push('Quantità non riconosciuta');
  else if (quantitySource === 'dedotta') line.note.push('Quantità dedotta dalla riga: da confermare');
  if (!resolution.color) line.note.push('Colore non indicato');

  if (line.model_id && line.category_id) {
    const existing = findExistingItem({
      modelId: line.model_id,
      categoryId: line.category_id,
      qualityId: line.quality_id,
      color: line.color,
    });
    if (existing) {
      line.item_id = existing.id;
      line.quantita_attuale = existing.quantity;
      line.prezzo_vendita = existing.price;
      line.azione = 'carica';
      line.stato = quantity != null && quantitySource === 'etichetta' ? 'pronta' : 'da_verificare';
    } else {
      line.item_id = null;
      line.quantita_attuale = 0;
      line.azione = 'crea';
      line.stato = 'da_verificare';
      line.nuovo_articolo = true;
      line.note.push('NUOVO ARTICOLO: non esiste ancora a catalogo');
    }
  }

  return line;
}

export function parseText(text) {
  return String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => parseLine(l, i));
}

/**
 * Estrae il testo mantenendo le righe: in una fattura i frammenti sulla stessa
 * altezza appartengono alla stessa riga di prodotto, e vanno riuniti in ordine.
 */
async function pdfToLines(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
  }).promise;

  const righe = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();

    const perAltezza = new Map();
    for (const item of content.items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5]);
      if (!perAltezza.has(y)) perAltezza.set(y, []);
      perAltezza.get(y).push({ x: item.transform[4], testo: item.str });
    }

    const ordinate = [...perAltezza.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, frammenti] of ordinate) {
      const testo = frammenti
        .sort((a, b) => a.x - b.x)
        .map((f) => f.testo)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (testo) righe.push(testo);
    }
  }
  const pagine = doc.numPages;
  await doc.destroy();
  return { righe, pagine };
}

export async function parsePdf(buffer) {
  let testo;
  let pagine;
  try {
    ({ righe: testo, pagine } = await pdfToLines(buffer));
  } catch (err) {
    throw new PdfError(`Impossibile leggere il PDF (${err.message}).`);
  }
  if (testo.length === 0) {
    throw new PdfError('Il PDF non contiene testo leggibile: probabilmente è una scansione. Incolla le righe a mano.');
  }

  const intero = testo.join('\n');
  return {
    pagine,
    fornitore: guessSupplier(intero),
    documento: guessDocumentRef(intero),
    righe: testo.map((riga, i) => parseLine(riga, i)),
  };
}

function guessSupplier(text) {
  const match = text.match(/(?:fornitore|mittente|spett(?:\.le)?)\s*[:\-]?\s*([A-Za-zÀ-ÿ0-9.&' ]{3,60})/i);
  return match ? match[1].trim() : null;
}

function guessDocumentRef(text) {
  const match = text.match(/(?:fattura|ddt|documento|doc\.?|n\.?)\s*[:\-]?\s*((?:n\.?\s*)?[A-Z0-9/\-]{3,20})/i);
  return match ? match[1].trim() : null;
}

export function draftSummary(lines) {
  return {
    righe: lines.length,
    pronte: lines.filter((l) => l.stato === 'pronta').length,
    da_verificare: lines.filter((l) => l.stato === 'da_verificare').length,
    ignorate: lines.filter((l) => l.stato === 'ignorata').length,
    nuovi_articoli: lines.filter((l) => l.nuovo_articolo).length,
    pezzi: lines.reduce((s, l) => s + (l.azione !== 'ignora' ? l.quantita ?? 0 : 0), 0),
  };
}
