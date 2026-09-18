import { db } from '../db.js';
import { ITEM_SELECT } from './inventory.js';
import { resolveQuery, logUnresolved } from './resolver.js';

// Motore di risposta condiviso da banco e (in futuro) assistente WhatsApp.
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
    where.push('i.color = ?');
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

export function assist(query, { channel = 'web', logMisses = false } = {}) {
  const resolution = resolveQuery(query);
  const base = { query, resolution };

  if (resolution.status === 'not_found') {
    if (logMisses) {
      base.unresolved_id = logUnresolved({ query, reason: 'not_found', channel });
    }
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

  // Il modello è chiaro ma non il ricambio: "A526" da solo non significa display.
  if (!resolution.category) {
    const available = db
      .prepare(
        `SELECT c.id, c.name, c.slug, c.icon, COUNT(*) AS varianti, SUM(i.quantity) AS pezzi
         FROM items i JOIN categories c ON c.id = i.category_id
         WHERE i.model_id = ? AND i.active = 1
         GROUP BY c.id ORDER BY c.sort_order`,
      )
      .all(model.id);
    return {
      ...base,
      status: 'ricambio_mancante',
      model,
      question: available.length
        ? `${model.brand} ${model.name}: quale ricambio ti serve? (${available.map((c) => c.name).join(', ')})`
        : `${model.brand} ${model.name} è riconosciuto, ma non ho ancora articoli a catalogo per questo modello. Quale ricambio ti serve?`,
      categories: available,
      items: [],
    };
  }

  const all = itemsFor({ modelId: model.id, categoryId: resolution.category.id });
  if (all.length === 0) {
    return {
      ...base,
      status: 'non_a_catalogo',
      model,
      category: resolution.category,
      question: `Non ho ${resolution.category.name} per ${model.brand} ${model.name} a catalogo.`,
      items: [],
    };
  }

  let filtered = all;
  if (resolution.quality) filtered = filtered.filter((i) => i.quality_id === resolution.quality.id);
  if (resolution.color) {
    filtered = filtered.filter((i) => i.color.toLowerCase() === String(resolution.color).toLowerCase());
  }

  if (filtered.length === 0) {
    return {
      ...base,
      status: 'variante_non_disponibile',
      model,
      category: resolution.category,
      question: `Per ${model.brand} ${model.name} ${resolution.category.name} non ho questa combinazione${
        resolution.quality ? ` (${resolution.quality.name})` : ''
      }${resolution.color ? ` in ${resolution.color}` : ''}. Disponibili: ${all
        .map((i) => [i.quality_name, i.color].filter(Boolean).join(' '))
        .join(', ')}.`,
      alternatives: all,
      items: [],
    };
  }

  // Più qualità possibili: Originale, OLED, Incell... vanno proposte, non scelte
  const qualities = uniqueBy(filtered, 'quality_name');
  if (!resolution.quality && qualities.length > 1) {
    return {
      ...base,
      status: 'qualita_da_scegliere',
      model,
      category: resolution.category,
      question: `${model.brand} ${model.name} - ${resolution.category.name}: quale versione? ${qualities
        .map((q) => q.value)
        .join(' – ')}`,
      qualities: qualities.map((q) => ({
        name: q.value,
        quality_id: q.items[0].quality_id,
        colori: [...new Set(q.items.map((i) => i.color).filter(Boolean))],
        disponibili: q.items.reduce((s, i) => s + i.quantity, 0),
      })),
      items: filtered,
    };
  }

  const colors = uniqueBy(filtered, 'color');
  if (!resolution.color && colors.length > 1) {
    return {
      ...base,
      status: 'colore_da_scegliere',
      model,
      category: resolution.category,
      quality: resolution.quality,
      question: `Disponibile in ${colors.map((c) => c.value).join(' – ')}. Quale colore?`,
      colors: colors.map((c) => ({
        name: c.value,
        item_id: c.items[0].id,
        disponibili: c.items.reduce((s, i) => s + i.quantity, 0),
        prezzo: c.items[0].price,
      })),
      items: filtered,
    };
  }

  const item = filtered[0];
  const inStock = item.quantity > 0;
  return {
    ...base,
    status: inStock ? 'disponibile' : 'esaurito',
    model,
    category: resolution.category,
    item,
    // Il prezzo arriva sempre dal magazzino: se lo modifichi a mano, da qui esce quello nuovo
    price: item.price,
    quantity: item.quantity,
    question: null,
    answer: inStock
      ? `${item.brand_name} ${item.model_name} – ${item.category_name}${
          item.quality_name ? ` ${item.quality_name}` : ''
        }${item.color ? ` ${item.color}` : ''}: ${item.price.toFixed(2)} € (disponibili ${item.quantity})`
      : `${item.brand_name} ${item.model_name} – ${item.category_name}${
          item.quality_name ? ` ${item.quality_name}` : ''
        }${item.color ? ` ${item.color}` : ''}: al momento esaurito.`,
    items: filtered,
  };
}
