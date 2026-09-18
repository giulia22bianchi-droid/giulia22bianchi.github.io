import { Router } from 'express';
import { db } from '../db.js';
import { ITEM_SELECT, InventoryError, adjustStock, getItem } from '../lib/inventory.js';
import { broadcast } from '../lib/events.js';

export const itemsRouter = Router();

itemsRouter.get('/', (req, res) => {
  const {
    category, category_id: categoryId, model_id: modelId, brand_id: brandId,
    quality_id: qualityId, color, q, status, include_inactive: includeInactive,
    limit = 500, offset = 0,
  } = req.query;

  const where = [];
  const params = [];
  if (!includeInactive) where.push('i.active = 1');
  if (category) {
    where.push('c.slug = ?');
    params.push(category);
  }
  if (categoryId) {
    where.push('i.category_id = ?');
    params.push(Number(categoryId));
  }
  if (modelId) {
    where.push('i.model_id = ?');
    params.push(Number(modelId));
  }
  if (brandId) {
    where.push('b.id = ?');
    params.push(Number(brandId));
  }
  if (qualityId) {
    where.push('i.quality_id = ?');
    params.push(Number(qualityId));
  }
  if (color) {
    where.push('i.color = ?');
    params.push(color);
  }
  if (status === 'sotto_scorta') where.push('i.quantity <= i.min_stock AND i.quantity > 0');
  if (status === 'esaurito') where.push('i.quantity <= 0');
  if (status === 'da_ordinare') where.push('i.quantity <= i.min_stock');
  if (q) {
    where.push(`(m.name LIKE ? OR b.name LIKE ? OR i.sku LIKE ? OR i.color LIKE ?
      OR EXISTS (SELECT 1 FROM model_codes mc WHERE mc.model_id = m.id AND mc.code LIKE ?))`);
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }

  const sql = `${ITEM_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY b.name, m.name, c.sort_order, q.sort_order, i.color
    LIMIT ? OFFSET ?`;
  const items = db.prepare(sql).all(...params, Number(limit), Number(offset));
  const total = db
    .prepare(
      `SELECT COUNT(*) AS n FROM items i
       JOIN models m ON m.id = i.model_id
       JOIN brands b ON b.id = m.brand_id
       JOIN categories c ON c.id = i.category_id
       LEFT JOIN qualities q ON q.id = i.quality_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
    )
    .get(...params).n;

  res.json({ items, total });
});

itemsRouter.get('/:id', (req, res) => {
  const item = getItem(Number(req.params.id));
  if (!item) throw new InventoryError('Articolo non trovato', 404);
  res.json(item);
});

itemsRouter.post('/', (req, res) => {
  const item = createItem(req.body ?? {});
  broadcast('articolo-creato', { item_id: item.id });
  res.status(201).json(item);
});

export function createItem(payload) {
  const {
    model_id: modelId, category_id: categoryId, quality_id: qualityId = null,
    color = '', sku = null, price = 0, cost = null, quantity = 0, min_stock: minStock = 0, note = null,
  } = payload;

  if (!modelId) throw new InventoryError('model_id obbligatorio');
  if (!categoryId) throw new InventoryError('category_id obbligatorio');
  if (!db.prepare(`SELECT 1 FROM models WHERE id = ?`).get(Number(modelId))) {
    throw new InventoryError('Modello non trovato', 404);
  }
  if (!db.prepare(`SELECT 1 FROM categories WHERE id = ?`).get(Number(categoryId))) {
    throw new InventoryError('Categoria non trovata', 404);
  }

  const duplicate = db
    .prepare(
      `SELECT id FROM items WHERE model_id = ? AND category_id = ? AND color = ?
       AND quality_id IS ?`,
    )
    .get(Number(modelId), Number(categoryId), color, qualityId ? Number(qualityId) : null);
  if (duplicate) {
    throw new InventoryError('Questa variante esiste già a catalogo', 409, { item_id: duplicate.id });
  }

  const info = db
    .prepare(
      `INSERT INTO items (model_id, category_id, quality_id, color, sku, price, cost, quantity, min_stock, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      Number(modelId),
      Number(categoryId),
      qualityId ? Number(qualityId) : null,
      color,
      sku,
      Number(price),
      cost == null ? null : Number(cost),
      Number(quantity),
      Number(minStock),
      note,
    );

  const itemId = Number(info.lastInsertRowid);
  if (Number(quantity) !== 0) {
    db.prepare(
      `INSERT INTO stock_movements (item_id, delta, qty_after, reason) VALUES (?, ?, ?, 'creazione articolo')`,
    ).run(itemId, Number(quantity), Number(quantity));
  }
  return getItem(itemId);
}

const EDITABLE = ['sku', 'price', 'cost', 'min_stock', 'note', 'color', 'quality_id', 'category_id', 'active'];

itemsRouter.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const item = getItem(id);
  if (!item) throw new InventoryError('Articolo non trovato', 404);

  const updates = [];
  const params = [];
  for (const field of EDITABLE) {
    if (req.body?.[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(req.body[field]);
    }
  }

  // La quantità non si modifica insieme al resto: passa sempre da un movimento tracciato
  if (req.body?.quantity !== undefined) {
    const target = Number(req.body.quantity);
    if (!Number.isInteger(target) || target < 0) throw new InventoryError('Quantità non valida');
    adjustStock({
      itemId: id,
      delta: target - item.quantity,
      reason: req.body.reason ?? 'rettifica manuale',
      actor: req.body.actor ?? null,
    });
  }

  if (updates.length) {
    params.push(id);
    db.prepare(`UPDATE items SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params);
  }

  const updated = getItem(id);
  broadcast('articolo-aggiornato', { item_id: id });
  res.json(updated);
});

// Operazioni rapide da banco: -1 / -2 / +1
itemsRouter.post('/:id/adjust', (req, res) => {
  const { delta, reason = 'rettifica rapida', actor = null } = req.body ?? {};
  const value = Number(delta);
  if (!Number.isInteger(value) || value === 0) throw new InventoryError('delta deve essere un intero diverso da zero');
  res.json(adjustStock({ itemId: Number(req.params.id), delta: value, reason, actor }));
});

itemsRouter.get('/:id/movements', (req, res) => {
  res.json(
    db
      .prepare(`SELECT * FROM stock_movements WHERE item_id = ? ORDER BY created_at DESC, id DESC LIMIT 200`)
      .all(Number(req.params.id)),
  );
});

itemsRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getItem(id)) throw new InventoryError('Articolo non trovato', 404);
  // Disattivazione, non cancellazione: lo storico vendite deve restare leggibile
  db.prepare(`UPDATE items SET active = 0, updated_at = datetime('now') WHERE id = ?`).run(id);
  broadcast('articolo-aggiornato', { item_id: id });
  res.json({ ok: true, disattivato: id });
});
