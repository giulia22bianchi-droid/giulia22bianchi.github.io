import { db } from '../db.js';
import { ITEM_SELECT } from './inventory.js';
import { resolveQuery, logUnresolved } from './resolver.js';

// Motore di risposta condiviso da banco e assistente WhatsApp.
// Regola fissa: quando manca un'informazione si chiede, non si indovina.

function itemsFor({ modelId, categoryId = null, qualityId = null, color = null }) {
  const where = ['i.active = 1', 'i.model_id = ?'];
  const params = [modelId];
  if (categoryId) {
    where.push('i.category_id = ?');
    params.push(categoryId);
  }
  if (qualityId) {
    where.push('i.quality_id = ?');
    params.push(qualityId);
  }
  if (color) {
    where.push('lower(i.color) = lower(?)');
    params.push(color);
  }
  return db
    .prepare(`${ITEM_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.sort_order, q.sort_order, i.color`)
    .all(...params);
}

function uniqueBy(items, key) {
  const seen = new Map();
  for (const item of items) {
    const value = item[key];
    if (value == null || value === '') continue;
    if (!seen.has(value)) seen.set(value, { value, items: [] });
    seen.get(value).items.push(item);
  }
  return [...seen.values()];
}

export function categorieDisponibili(modelId) {
  return db
    .prepare(
      `SELECT c.id, c.name, c.slug, c.icon, COUNT(*) AS varianti, SUM(i.quantity) AS pezzi
       FROM items i JOIN categories c ON c.id = i.category_id
       WHERE i.model_id = ? AND i.active = 1
       GROUP BY c.id ORDER BY c.sort_order`,
    )
    .all(modelId);
}

/**
 * Dato un modello certo e le scelte fatte finora, decide il passo successivo:
 * servire il prezzo oppure chiedere il dato mancante.
 */
export function valuta({ model, category = null, quality = null, color = null }) {
  if (!category) {
    return { status: 'ricambio_mancante', model, categorie: categorieDisponibili(model.id) };
  }

  const tutti = itemsFor({ modelId: model.id, categoryId: category.id });
  if (tutti.length === 0) {
    return { status: 'non_a_catalogo', model, category };
  }

  let filtrati = tutti;
  if (quality) filtrati = filtrati.filter((i) => i.quality_id === quality.id);
  if (color) filtrati = filtrati.filter((i) => i.color.toLowerCase() === String(color).toLowerCase());

  if (filtrati.length === 0) {
    return { status: 'variante_non_disponibile', model, category, quality, color, alternative: tutti };
  }

  // Più qualità possibili (Originale, OLED, Incell...): vanno proposte, non scelte
  const qualita = uniqueBy(filtrati, 'quality_name');
  if (!quality && qualita.length > 1) {
    return {
      status: 'qualita_da_scegliere',
      model,
      category,
      qualities: qualita.map((q) => ({
        name: q.value,
        quality_id: q.items[0].quality_id,
        slug: q.items[0].quality_slug,
        colori: [...new Set(q.items.map((i) => i.color).filter(Boolean))],
        disponibili: q.items.reduce((s, i) => s + i.quantity, 0),
        prezzo: q.items[0].price,
      })),
      items: filtrati,
    };
  }

  const colori = uniqueBy(filtrati, 'color');
  if (!color && colori.length > 1) {
    return {
      status: 'colore_da_scegliere',
      model,
      category,
      quality,
      colors: colori.map((c) => ({
        name: c.value,
        item_id: c.items[0].id,
        disponibili: c.items.reduce((s, i) => s + i.quantity, 0),
        prezzo: c.items[0].price,
      })),
      items: filtrati,
    };
  }

  const item = filtrati[0];
  return {
    status: item.quantity > 0 ? 'disponibile' : 'esaurito',
    model,
    category,
    quality,
    color,
    item,
    // Il prezzo arriva sempre dal magazzino: se lo modifichi a mano, da qui esce quello nuovo
    price: item.price,
    quantity: item.quantity,
    items: filtrati,
  };
}

export function descrizioneArticolo(item) {
  return [item.brand_name, item.model_name, '–', item.category_name, item.quality_name, item.color]
    .filter(Boolean)
    .join(' ');
}

/** Interpreta una richiesta libera e produce la risposta per l'interfaccia web. */
export function assist(query, { channel = 'web', logMisses = false } = {}) {
  const resolution = resolveQuery(query);
  const base = { query, resolution };

  if (resolution.status === 'not_found') {
    if (logMisses) base.unresolved_id = logUnresolved({ query, reason: 'not_found', channel });
    return {
      ...base,
      status: 'modello_non_riconosciuto',
      question: 'Non ho riconosciuto il modello. Puoi indicare marca e modello, oppure il codice (es. SM-A526B)?',
      models: [],
      items: [],
    };
  }

  if (resolution.status === 'ambiguous') {
    if (logMisses) {
      base.unresolved_id = logUnresolved({ query, reason: 'ambiguous', candidates: resolution.models, channel });
    }
    return {
      ...base,
      status: 'modello_ambiguo',
      question: `Ho trovato più modelli compatibili: ${resolution.models
        .map((m) => `${m.brand} ${m.name}`)
        .join(', ')}. Quale ti serve?`,
      models: resolution.models,
      items: [],
    };
  }

  const model = resolution.models[0];
  const esito = valuta({
    model,
    category: resolution.category,
    quality: resolution.quality,
    color: resolution.color,
  });

  const domande = {
    ricambio_mancante: () =>
      esito.categorie.length
        ? `${model.brand} ${model.name}: quale ricambio ti serve? (${esito.categorie.map((c) => c.name).join(', ')})`
        : `${model.brand} ${model.name} è riconosciuto, ma non ho ancora articoli a catalogo per questo modello. Quale ricambio ti serve?`,
    non_a_catalogo: () => `Non ho ${esito.category.name} per ${model.brand} ${model.name} a catalogo.`,
    variante_non_disponibile: () =>
      `Per ${model.brand} ${model.name} ${esito.category.name} non ho questa combinazione${
        esito.quality ? ` (${esito.quality.name})` : ''
      }${esito.color ? ` in ${esito.color}` : ''}. Disponibili: ${esito.alternative
        .map((i) => [i.quality_name, i.color].filter(Boolean).join(' '))
        .join(', ')}.`,
    qualita_da_scegliere: () =>
      `${model.brand} ${model.name} - ${esito.category.name}: quale versione? ${esito.qualities
        .map((q) => q.name)
        .join(' – ')}`,
    colore_da_scegliere: () => `Disponibile in ${esito.colors.map((c) => c.name).join(' – ')}. Quale colore?`,
  };

  const risposta = {
    ...base,
    ...esito,
    categories: esito.categorie,
    alternatives: esito.alternative,
    question: domande[esito.status]?.() ?? null,
  };

  if (esito.status === 'disponibile' || esito.status === 'esaurito') {
    risposta.answer =
      esito.status === 'disponibile'
        ? `${descrizioneArticolo(esito.item)}: ${esito.item.price.toFixed(2)} € (disponibili ${esito.item.quantity})`
        : `${descrizioneArticolo(esito.item)}: al momento esaurito.`;
  }

  risposta.items ??= [];
  return risposta;
}
