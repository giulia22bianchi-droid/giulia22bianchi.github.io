import { Router } from 'express';
import { db } from '../db.js';
import { InventoryError } from '../lib/inventory.js';
import { createItem } from './items.js';
import { resolveQuery } from '../lib/resolver.js';

export const missingRouter = Router();

// PRODOTTI MANCANTI: visti su cataloghi/fornitori esterni ma non presenti a magazzino.
// Restano fuori dal magazzino finché non entrano davvero.
missingRouter.get('/', (req, res) => {
  const { status, source } = req.query;
  const where = [];
  const params = [];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (source) {
    where.push('source = ?');
    params.push(source);
  }
  const rows = db
    .prepare(
      `SELECT * FROM missing_products ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC LIMIT 500`,
    )
    .all(...params);
  res.json({ totale: rows.length, prodotti: rows });
});

missingRouter.post('/', (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [req.body ?? {}];
  const insert = db.prepare(
    `INSERT INTO missing_products (brand_name, model_name, model_code, category_name, quality_name, color, source, url, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const created = [];
  const run = db.transaction(() => {
    for (const entry of list) {
      const {
        brand_name: brand = null, model_name: model = null, model_code: code = null,
        category_name: category = null, quality_name: quality = null, color = null,
        source = null, url = null, note = null,
      } = entry;
      if (!model && !code) throw new InventoryError('Serve almeno il modello o il codice');
      const id = insert.run(brand, model, code, category, quality, color, source, url, note).lastInsertRowid;
      created.push(Number(id));
    }
  });
  run();
  res.status(201).json({
    creati: created.length,
    prodotti: created.map((id) => db.prepare(`SELECT * FROM missing_products WHERE id = ?`).get(id)),
  });
});

missingRouter.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare(`SELECT 1 FROM missing_products WHERE id = ?`).get(id)) {
    throw new InventoryError('Prodotto non trovato', 404);
  }
  const fields = ['brand_name', 'model_name', 'model_code', 'category_name', 'quality_name', 'color', 'source', 'url', 'note', 'status'];
  const updates = [];
  const params = [];
  for (const field of fields) {
    if (req.body?.[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(req.body[field]);
    }
  }
  if (updates.length) {
    params.push(id);
    db.prepare(`UPDATE missing_products SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }
  res.json(db.prepare(`SELECT * FROM missing_products WHERE id = ?`).get(id));
});

missingRouter.delete('/:id', (req, res) => {
  db.prepare(`DELETE FROM missing_products WHERE id = ?`).run(Number(req.params.id));
  res.json({ ok: true });
});

// Porta un prodotto mancante a catalogo: richiede conferma esplicita di modello e categoria
missingRouter.post('/:id/importa', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`SELECT * FROM missing_products WHERE id = ?`).get(id);
  if (!row) throw new InventoryError('Prodotto non trovato', 404);

  const { model_id: modelId, category_id: categoryId, quality_id: qualityId = null,
    color = row.color ?? '', price = 0, quantity = 0, min_stock: minStock = 0, sku = null } = req.body ?? {};

  if (!modelId || !categoryId) {
    // Non si inventa: si propone e si aspetta conferma
    const suggestion = resolveQuery([row.brand_name, row.model_name, row.model_code, row.category_name]
      .filter(Boolean).join(' '));
    throw new InventoryError(
      'Per importare servono model_id e category_id confermati',
      400,
      { suggerimento: suggestion },
    );
  }

  const item = createItem({
    model_id: modelId,
    category_id: categoryId,
    quality_id: qualityId,
    color,
    sku,
    price,
    quantity,
    min_stock: minStock,
    note: `Importato da PRODOTTI MANCANTI${row.source ? ` (fonte: ${row.source})` : ''}`,
  });

  db.prepare(`UPDATE missing_products SET status = 'importato' WHERE id = ?`).run(id);
  res.status(201).json({ item, missing_id: id });
});

// Confronto con un catalogo esterno: le righe che non trovano riscontro a magazzino
// finiscono tra i prodotti mancanti, senza mai toccare le quantità.
missingRouter.post('/confronta', (req, res) => {
  const { source = 'catalogo esterno', righe = [], salva = false } = req.body ?? {};
  if (!Array.isArray(righe) || righe.length === 0) throw new InventoryError('Nessuna riga da confrontare');

  const mancanti = [];
  const presenti = [];

  for (const riga of righe) {
    const testo = typeof riga === 'string' ? riga : [riga.descrizione, riga.modello, riga.codice, riga.categoria]
      .filter(Boolean).join(' ');
    const resolution = resolveQuery(testo);

    if (resolution.status !== 'ok' || !resolution.category) {
      mancanti.push({ riga: testo, motivo: resolution.status === 'ok' ? 'categoria non riconosciuta' : resolution.status, resolution });
      continue;
    }

    const model = resolution.models[0];
    const found = db
      .prepare(
        `SELECT COUNT(*) AS n FROM items WHERE model_id = ? AND category_id = ? AND active = 1`,
      )
      .get(model.id, resolution.category.id).n;

    if (found > 0) {
      presenti.push({ riga: testo, model: `${model.brand} ${model.name}`, categoria: resolution.category.name });
    } else {
      mancanti.push({
        riga: testo,
        motivo: 'non presente a catalogo',
        brand_name: model.brand,
        model_name: model.name,
        model_code: model.codes?.[0] ?? null,
        category_name: resolution.category.name,
        color: resolution.color,
      });
    }
  }

  if (salva) {
    const insert = db.prepare(
      `INSERT INTO missing_products (brand_name, model_name, model_code, category_name, color, source, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const run = db.transaction(() => {
      for (const m of mancanti) {
        insert.run(m.brand_name ?? null, m.model_name ?? null, m.model_code ?? null,
          m.category_name ?? null, m.color ?? null, source, m.riga);
      }
    });
    run();
  }

  res.json({ analizzate: righe.length, presenti: presenti.length, mancanti, salvati: salva ? mancanti.length : 0 });
});
