import { db } from '../db.js';
import { broadcast } from './events.js';

export const ITEM_SELECT = `
  SELECT i.id, i.model_id, i.category_id, i.quality_id, i.color, i.sku,
         i.price, i.cost, i.quantity, i.min_stock, i.note, i.active,
         i.created_at, i.updated_at,
         m.name AS model_name, m.year AS model_year,
         b.id AS brand_id, b.name AS brand_name,
         c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon,
         q.name AS quality_name, q.slug AS quality_slug,
         (SELECT group_concat(code, ' / ') FROM model_codes WHERE model_id = m.id) AS model_codes,
         CASE
           WHEN i.quantity <= 0 THEN 'esaurito'
           WHEN i.quantity <= i.min_stock THEN 'sotto_scorta'
           ELSE 'ok'
         END AS stock_status
  FROM items i
  JOIN models m ON m.id = i.model_id
  JOIN brands b ON b.id = m.brand_id
  JOIN categories c ON c.id = i.category_id
  LEFT JOIN qualities q ON q.id = i.quality_id
`;

export function getItem(id) {
  return db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id);
}

export class InventoryError extends Error {
  constructor(message, status = 400, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function openAlert(item) {
  const existing = db
    .prepare(`SELECT id FROM stock_alerts WHERE item_id = ? AND resolved_at IS NULL`)
    .get(item.id);
  if (existing) return null;
  const info = db
    .prepare(`INSERT INTO stock_alerts (item_id, quantity, min_stock) VALUES (?, ?, ?)`)
    .run(item.id, item.quantity, item.min_stock);
  return info.lastInsertRowid;
}

function closeAlerts(itemId) {
  db.prepare(
    `UPDATE stock_alerts SET resolved_at = datetime('now') WHERE item_id = ? AND resolved_at IS NULL`,
  ).run(itemId);
}

// Ogni volta che la quantità cambia va ricontrollata la soglia minima della variante.
function syncAlert(item) {
  if (item.quantity <= item.min_stock) {
    const alertId = openAlert(item);
    if (alertId) {
      broadcast('scorta', {
        alert_id: alertId,
        item_id: item.id,
        brand: item.brand_name,
        model: item.model_name,
        codes: item.model_codes,
        category: item.category_name,
        quality: item.quality_name,
        color: item.color,
        quantity: item.quantity,
        min_stock: item.min_stock,
      });
    }
  } else {
    closeAlerts(item.id);
  }
}

/**
 * Unico punto di scrittura delle quantità: registra il movimento, aggiorna la
 * soglia e avvisa gli altri dispositivi.
 */
export function adjustStock({ itemId, delta, reason, refType = null, refId = null, actor = null, allowNegative = false }) {
  const item = getItem(itemId);
  if (!item) throw new InventoryError(`Articolo ${itemId} non trovato`, 404);

  const next = item.quantity + delta;
  if (next < 0 && !allowNegative) {
    throw new InventoryError(
      `Quantità insufficiente per ${item.brand_name} ${item.model_name} ${item.category_name}: disponibili ${item.quantity}, richiesti ${-delta}`,
      409,
      { item_id: item.id, available: item.quantity, requested: -delta },
    );
  }

  db.prepare(`UPDATE items SET quantity = ?, updated_at = datetime('now') WHERE id = ?`).run(next, itemId);
  db.prepare(
    `INSERT INTO stock_movements (item_id, delta, qty_after, reason, ref_type, ref_id, actor)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(itemId, delta, next, reason, refType, refId, actor);

  const updated = getItem(itemId);
  syncAlert(updated);
  broadcast('magazzino', { item_id: itemId, quantity: next, delta, reason });
  return updated;
}

/**
 * Registra una vendita confermata. Una richiesta di prezzo non passa da qui:
 * il magazzino si scarica solo alla conferma.
 */
export function registerSale({ channel = 'banco', customerPhone = null, customerName = null, note = null, lines = [], actor = null }) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new InventoryError('La vendita non contiene righe');
  }

  const prepared = lines.map((line) => {
    const item = getItem(line.item_id);
    if (!item) throw new InventoryError(`Articolo ${line.item_id} non trovato`, 404);
    const quantity = Number(line.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new InventoryError(`Quantità non valida per l'articolo ${line.item_id}`);
    }
    if (item.quantity < quantity) {
      throw new InventoryError(
        `Disponibilità insufficiente: ${item.brand_name} ${item.model_name} - ${item.category_name} ${item.quality_name ?? ''} ${item.color} (disponibili ${item.quantity}, richiesti ${quantity})`,
        409,
        { item_id: item.id, available: item.quantity, requested: quantity },
      );
    }
    const unitPrice = line.unit_price != null ? Number(line.unit_price) : item.price;
    return { item, quantity, unitPrice };
  });

  const total = prepared.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

  const run = db.transaction(() => {
    const saleId = db
      .prepare(
        `INSERT INTO sales (channel, customer_phone, customer_name, total, note) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(channel, customerPhone, customerName, total, note).lastInsertRowid;

    for (const { item, quantity, unitPrice } of prepared) {
      db.prepare(
        `INSERT INTO sale_lines (sale_id, item_id, quantity, unit_price, line_total,
           brand_name, model_name, model_code, category_name, quality_name, color, sku)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        saleId,
        item.id,
        quantity,
        unitPrice,
        unitPrice * quantity,
        item.brand_name,
        item.model_name,
        item.model_codes,
        item.category_name,
        item.quality_name,
        item.color,
        item.sku,
      );
    }
    return saleId;
  });

  const saleId = run();
  for (const { item, quantity } of prepared) {
    adjustStock({
      itemId: item.id,
      delta: -quantity,
      reason: 'vendita',
      refType: 'sale',
      refId: saleId,
      actor,
    });
  }

  const sale = getSale(saleId);
  broadcast('vendita', sale);
  return sale;
}

export function getSale(id) {
  const sale = db.prepare(`SELECT * FROM sales WHERE id = ?`).get(id);
  if (!sale) return null;
  sale.lines = db.prepare(`SELECT * FROM sale_lines WHERE sale_id = ? ORDER BY id`).all(id);
  return sale;
}

export function cancelSale(id, actor = null) {
  const sale = getSale(id);
  if (!sale) throw new InventoryError('Vendita non trovata', 404);
  for (const line of sale.lines) {
    if (line.item_id) {
      adjustStock({
        itemId: line.item_id,
        delta: line.quantity,
        reason: 'storno vendita',
        refType: 'sale_cancel',
        refId: id,
        actor,
      });
    }
  }
  db.prepare(`DELETE FROM sales WHERE id = ?`).run(id);
  broadcast('vendita-annullata', { sale_id: id });
  return { cancelled: id, restored: sale.lines.length };
}

/** Quantità e prezzo aggiornati per una variante, senza toccare il magazzino. */
export function quote(itemId, quantity = 1) {
  const item = getItem(itemId);
  if (!item) throw new InventoryError('Articolo non trovato', 404);
  return {
    item,
    quantity,
    unit_price: item.price,
    total: item.price * quantity,
    available: item.quantity >= quantity,
    stock_status: item.stock_status,
  };
}
