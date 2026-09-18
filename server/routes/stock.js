import { Router } from 'express';
import { db } from '../db.js';
import { ITEM_SELECT, InventoryError } from '../lib/inventory.js';

export const stockRouter = Router();

// Pagina DA ORDINARE: tutto ciò che è sotto soglia o esaurito
stockRouter.get('/da-ordinare', (req, res) => {
  const { group_by: groupBy = 'categoria' } = req.query;
  const items = db
    .prepare(
      `${ITEM_SELECT} WHERE i.active = 1 AND i.quantity <= i.min_stock
       ORDER BY (i.quantity <= 0) DESC, i.quantity, b.name, m.name`,
    )
    .all();

  const keyOf = (item) =>
    groupBy === 'modello' ? `${item.brand_name} ${item.model_name}` : item.category_name;

  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, { nome: key, articoli: [], esauriti: 0, sotto_scorta: 0 });
    const group = groups.get(key);
    group.articoli.push(item);
    if (item.quantity <= 0) group.esauriti += 1;
    else group.sotto_scorta += 1;
  }

  res.json({
    totale: items.length,
    esauriti: items.filter((i) => i.quantity <= 0).length,
    sotto_scorta: items.filter((i) => i.quantity > 0).length,
    gruppi: [...groups.values()].sort((a, b) => b.articoli.length - a.articoli.length),
  });
});

stockRouter.get('/alerts', (req, res) => {
  const includeResolved = req.query.include_resolved === '1';
  const rows = db
    .prepare(
      `SELECT a.id, a.created_at, a.resolved_at, a.quantity AS quantity_at_alert, a.min_stock,
              i.id AS item_id, i.quantity AS quantity_now, i.color, i.sku,
              b.name AS brand_name, m.name AS model_name, c.name AS category_name,
              q.name AS quality_name,
              (SELECT group_concat(code, ' / ') FROM model_codes WHERE model_id = m.id) AS model_codes
       FROM stock_alerts a
       JOIN items i ON i.id = a.item_id
       JOIN models m ON m.id = i.model_id
       JOIN brands b ON b.id = m.brand_id
       JOIN categories c ON c.id = i.category_id
       LEFT JOIN qualities q ON q.id = i.quality_id
       ${includeResolved ? '' : 'WHERE a.resolved_at IS NULL'}
       ORDER BY a.created_at DESC LIMIT 300`,
    )
    .all();

  res.json({
    totale: rows.length,
    avvisi: rows.map((row) => ({
      ...row,
      // Messaggio già pronto per il canale di notifica (WhatsApp in fase 2)
      messaggio: `⚠️ Scorta minima: ${row.brand_name} ${row.model_name} (${row.model_codes ?? '—'}) – ${
        row.category_name
      }${row.quality_name ? ` ${row.quality_name}` : ''}${row.color ? ` ${row.color}` : ''} → rimasti ${
        row.quantity_now
      } (minimo ${row.min_stock})`,
    })),
  });
});

stockRouter.post('/alerts/:id/letto', (req, res) => {
  const id = Number(req.params.id);
  const alert = db.prepare(`SELECT * FROM stock_alerts WHERE id = ?`).get(id);
  if (!alert) throw new InventoryError('Avviso non trovato', 404);
  db.prepare(`UPDATE stock_alerts SET resolved_at = datetime('now') WHERE id = ?`).run(id);
  res.json({ ok: true });
});
