import { Router } from 'express';
import { db, normalizeCode } from '../db.js';
import { InventoryError } from '../lib/inventory.js';
import { invalidateCatalogCache, resolveQuery, logUnresolved } from '../lib/resolver.js';
import { slugify } from '../db.js';

export const catalogRouter = Router();

catalogRouter.get('/categories', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM items WHERE category_id = c.id AND active = 1) AS items_count,
                (SELECT COALESCE(SUM(quantity), 0) FROM items WHERE category_id = c.id AND active = 1) AS units
         FROM categories c ORDER BY c.sort_order, c.name`,
      )
      .all(),
  );
});

catalogRouter.post('/categories', (req, res) => {
  const { name, icon = '📦' } = req.body ?? {};
  if (!name) throw new InventoryError('Nome categoria obbligatorio');
  const max = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM categories`).get().next;
  const info = db
    .prepare(`INSERT INTO categories (name, slug, icon, sort_order) VALUES (?, ?, ?, ?)`)
    .run(name, slugify(name), icon, max);
  res.status(201).json(db.prepare(`SELECT * FROM categories WHERE id = ?`).get(info.lastInsertRowid));
});

catalogRouter.get('/qualities', (req, res) => {
  res.json(db.prepare(`SELECT * FROM qualities ORDER BY sort_order, name`).all());
});

catalogRouter.post('/qualities', (req, res) => {
  const { name } = req.body ?? {};
  if (!name) throw new InventoryError('Nome qualità obbligatorio');
  const max = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM qualities`).get().next;
  const info = db
    .prepare(`INSERT INTO qualities (name, slug, sort_order) VALUES (?, ?, ?)`)
    .run(name, slugify(name), max);
  res.status(201).json(db.prepare(`SELECT * FROM qualities WHERE id = ?`).get(info.lastInsertRowid));
});

catalogRouter.get('/colors', (req, res) => {
  res.json(db.prepare(`SELECT * FROM colors ORDER BY name`).all());
});

catalogRouter.get('/brands', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT b.*, (SELECT COUNT(*) FROM models WHERE brand_id = b.id) AS models_count
         FROM brands b ORDER BY b.name`,
      )
      .all(),
  );
});

catalogRouter.get('/models', (req, res) => {
  const { brand_id: brandId, q, limit = 200 } = req.query;
  const where = [];
  const params = [];
  if (brandId) {
    where.push('m.brand_id = ?');
    params.push(Number(brandId));
  }
  if (q) {
    where.push(`(m.name LIKE ? OR EXISTS (SELECT 1 FROM model_codes mc WHERE mc.model_id = m.id AND mc.normalized LIKE ?))`);
    params.push(`%${q}%`, `%${normalizeCode(q)}%`);
  }
  const sql = `
    SELECT m.id, m.name, m.year, b.name AS brand_name, b.id AS brand_id,
           (SELECT group_concat(code, ' / ') FROM model_codes WHERE model_id = m.id) AS codes,
           (SELECT COUNT(*) FROM items WHERE model_id = m.id AND active = 1) AS items_count
    FROM models m JOIN brands b ON b.id = m.brand_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY b.name, m.name
    LIMIT ?`;
  res.json(db.prepare(sql).all(...params, Number(limit)));
});

catalogRouter.post('/models', (req, res) => {
  const { brand, brand_id: brandIdRaw, name, year = null, codes = [] } = req.body ?? {};
  if (!name) throw new InventoryError('Nome modello obbligatorio');

  let brandId = brandIdRaw ? Number(brandIdRaw) : null;
  if (!brandId) {
    if (!brand) throw new InventoryError('Marca obbligatoria');
    const slug = slugify(brand);
    db.prepare(`INSERT INTO brands (name, slug) VALUES (?, ?) ON CONFLICT(slug) DO NOTHING`).run(brand, slug);
    brandId = db.prepare(`SELECT id FROM brands WHERE slug = ?`).get(slug).id;
  }

  const existing = db.prepare(`SELECT id FROM models WHERE brand_id = ? AND name = ?`).get(brandId, name);
  const modelId =
    existing?.id ??
    db.prepare(`INSERT INTO models (brand_id, name, year) VALUES (?, ?, ?)`).run(brandId, name, year)
      .lastInsertRowid;

  for (const code of codes) {
    if (!code) continue;
    db.prepare(
      `INSERT INTO model_codes (model_id, code, normalized, source) VALUES (?, ?, ?, 'manuale')
       ON CONFLICT(model_id, normalized) DO NOTHING`,
    ).run(modelId, code, normalizeCode(code));
  }

  invalidateCatalogCache();
  res.status(existing ? 200 : 201).json(getModel(modelId));
});

catalogRouter.get('/models/:id', (req, res) => {
  const model = getModel(Number(req.params.id));
  if (!model) throw new InventoryError('Modello non trovato', 404);
  res.json(model);
});

catalogRouter.post('/models/:id/codes', (req, res) => {
  const modelId = Number(req.params.id);
  const { code, source = 'manuale' } = req.body ?? {};
  if (!code) throw new InventoryError('Codice obbligatorio');
  const model = db.prepare(`SELECT id FROM models WHERE id = ?`).get(modelId);
  if (!model) throw new InventoryError('Modello non trovato', 404);

  // Un codice già assegnato a un altro modello è un conflitto da risolvere a mano,
  // non qualcosa da sovrascrivere in automatico.
  const clash = db
    .prepare(
      `SELECT mc.model_id, m.name FROM model_codes mc JOIN models m ON m.id = mc.model_id
       WHERE mc.normalized = ? AND mc.model_id != ?`,
    )
    .get(normalizeCode(code), modelId);
  if (clash) {
    throw new InventoryError(
      `Il codice ${code} è già associato a "${clash.name}". Verifica prima di procedere.`,
      409,
      { conflict_model_id: clash.model_id },
    );
  }

  db.prepare(
    `INSERT INTO model_codes (model_id, code, normalized, source) VALUES (?, ?, ?, ?)
     ON CONFLICT(model_id, normalized) DO NOTHING`,
  ).run(modelId, code, normalizeCode(code), source);
  invalidateCatalogCache();
  res.status(201).json(getModel(modelId));
});

catalogRouter.get('/identify', (req, res) => {
  const q = String(req.query.q ?? '');
  if (!q.trim()) throw new InventoryError('Parametro q obbligatorio');
  const result = resolveQuery(q);
  if (result.status !== 'ok' && req.query.log === '1') {
    result.unresolved_id = logUnresolved({
      query: q,
      reason: result.status,
      candidates: result.models,
      channel: String(req.query.channel ?? 'web'),
    });
  }
  res.json(result);
});

catalogRouter.get('/unresolved', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT * FROM unresolved_queries WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 200`,
      )
      .all()
      .map((row) => ({ ...row, candidates: JSON.parse(row.candidates ?? '[]') })),
  );
});

// Chiude una richiesta rimasta in sospeso insegnando l'associazione codice -> modello
catalogRouter.post('/unresolved/:id/resolve', (req, res) => {
  const id = Number(req.params.id);
  const { model_id: modelId, code } = req.body ?? {};
  const row = db.prepare(`SELECT * FROM unresolved_queries WHERE id = ?`).get(id);
  if (!row) throw new InventoryError('Richiesta non trovata', 404);
  if (!modelId) throw new InventoryError('model_id obbligatorio');

  if (code) {
    db.prepare(
      `INSERT INTO model_codes (model_id, code, normalized, source) VALUES (?, ?, ?, 'appreso')
       ON CONFLICT(model_id, normalized) DO NOTHING`,
    ).run(Number(modelId), code, normalizeCode(code));
    invalidateCatalogCache();
  }

  db.prepare(
    `UPDATE unresolved_queries SET resolved_model_id = ?, resolved_at = datetime('now') WHERE id = ?`,
  ).run(Number(modelId), id);
  res.json({ ok: true, model: getModel(Number(modelId)) });
});

function getModel(id) {
  const model = db
    .prepare(
      `SELECT m.id, m.name, m.year, b.id AS brand_id, b.name AS brand_name
       FROM models m JOIN brands b ON b.id = m.brand_id WHERE m.id = ?`,
    )
    .get(id);
  if (!model) return null;
  model.codes = db.prepare(`SELECT id, code, source FROM model_codes WHERE model_id = ? ORDER BY code`).all(id);
  return model;
}
