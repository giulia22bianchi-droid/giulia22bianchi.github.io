import { Router } from 'express';
import { db } from '../db.js';
import { PosError } from '../lib/documents.js';
import { requires } from '../lib/auth.js';

export const catalogRouter = Router();

const bool = (v) => (v ? 1 : 0);
const num = (v, d = 0) => (v === '' || v === undefined || v === null || !Number.isFinite(Number(v)) ? d : Number(v));
const text = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

const PRODUCT_SELECT = `
  SELECT p.*, g.name AS group_name, g.color AS group_color, COALESCE(t.rate, 0) AS tax_rate, t.name AS tax_name
  FROM products p
  LEFT JOIN product_groups g ON g.id = p.group_id
  LEFT JOIN taxes t ON t.id = p.tax_id`;

function productFromBody(b) {
  const name = text(b.name);
  if (!name) throw new PosError('Il nome è obbligatorio');
  const price = num(b.price);
  if (price < 0) throw new PosError('Prezzo non valido');
  return {
    name, code: text(b.code), barcode: text(b.barcode),
    group_id: b.group_id || null, tax_id: b.tax_id || null, supplier_id: b.supplier_id || null,
    price, cost: num(b.cost), unit: text(b.unit) || 'pz', min_stock: num(b.min_stock),
    track_stock: bool(b.track_stock ?? true), allow_price_change: bool(b.allow_price_change),
    favorite: bool(b.favorite), description: text(b.description), active: bool(b.active ?? true),
  };
}

function saveExtraBarcodes(productId, list) {
  db.prepare(`DELETE FROM product_barcodes WHERE product_id = ?`).run(productId);
  const ins = db.prepare(`INSERT OR IGNORE INTO product_barcodes (barcode, product_id) VALUES (?, ?)`);
  for (const code of list || []) if (text(code)) ins.run(String(code).trim(), productId);
}

function withBarcodes(p) {
  if (p) p.extra_barcodes = db.prepare(`SELECT barcode FROM product_barcodes WHERE product_id = ?`).all(p.id).map((r) => r.barcode);
  return p;
}

// ---- Prodotti ----
catalogRouter.get('/products', requires('products.view'), (req, res) => {
  const where = [];
  const args = [];
  if (req.query.q) {
    where.push(`(p.name LIKE ? OR p.code LIKE ? OR p.barcode LIKE ? OR p.id IN (SELECT product_id FROM product_barcodes WHERE barcode LIKE ?))`);
    const like = `%${req.query.q}%`;
    args.push(like, like, like, like);
  }
  if (req.query.group_id) { where.push(`p.group_id = ?`); args.push(req.query.group_id); }
  if (req.query.favorite === '1') where.push(`p.favorite = 1`);
  if (req.query.low === '1') where.push(`p.track_stock = 1 AND p.stock <= p.min_stock`);
  if (req.query.all !== '1') where.push(`p.active = 1`);
  const limit = Math.min(Number(req.query.limit) || 1000, 5000);
  res.json(db.prepare(`${PRODUCT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name LIMIT ${limit}`).all(...args));
});

// Ricerca per codice a barre / codice: usata dalla cassa (lettore)
catalogRouter.get('/products/lookup/:code', requires('products.view'), (req, res) => {
  const code = req.params.code;
  const p = db.prepare(`${PRODUCT_SELECT} WHERE p.active = 1 AND (p.barcode = ? OR p.code = ? OR p.id IN (SELECT product_id FROM product_barcodes WHERE barcode = ?)) LIMIT 1`).get(code, code, code);
  if (!p) return res.status(404).json({ error: 'Prodotto non trovato' });
  res.json(p);
});

catalogRouter.get('/products/:id', requires('products.view'), (req, res) => {
  const p = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Prodotto non trovato' });
  res.json(withBarcodes(p));
});

function writeProduct(id, body) {
  const f = productFromBody(body);
  try {
    if (id) {
      db.prepare(`UPDATE products SET ${Object.keys(f).map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...f, id });
    } else {
      id = db.prepare(`INSERT INTO products (${Object.keys(f).join(', ')}) VALUES (${Object.keys(f).map((k) => '@' + k).join(', ')})`).run(f).lastInsertRowid;
      const initial = num(body.stock);
      if (initial !== 0 && f.track_stock) {
        db.prepare(`UPDATE products SET stock = ? WHERE id = ?`).run(initial, id);
        db.prepare(`INSERT INTO stock_movements (product_id, qty, reason) VALUES (?, ?, 'giacenza iniziale')`).run(id, initial);
      }
    }
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new PosError('Esiste già un prodotto con questo codice');
    throw e;
  }
  if (body.extra_barcodes) saveExtraBarcodes(id, body.extra_barcodes);
  return id;
}

catalogRouter.post('/products', requires('products.edit'), (req, res) => {
  res.status(201).json(withBarcodes(db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(writeProduct(null, req.body))));
});

catalogRouter.put('/products/:id', requires('products.edit'), (req, res) => {
  if (!db.prepare(`SELECT 1 FROM products WHERE id = ?`).get(req.params.id)) return res.status(404).json({ error: 'Prodotto non trovato' });
  writeProduct(Number(req.params.id), req.body);
  res.json(withBarcodes(db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(req.params.id)));
});

catalogRouter.delete('/products/:id', requires('products.edit'), (req, res) => {
  const used = db.prepare(`SELECT 1 FROM document_items WHERE product_id = ? LIMIT 1`).get(req.params.id);
  if (used) {
    db.prepare(`UPDATE products SET active = 0 WHERE id = ?`).run(req.params.id);
    return res.json({ archived: true });
  }
  db.prepare(`DELETE FROM products WHERE id = ?`).run(req.params.id);
  res.json({ deleted: true });
});

// Importazione in blocco (CSV letto dal browser): aggiorna per codice, altrimenti crea
catalogRouter.post('/products/import', requires('products.edit'), (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const groups = new Map(db.prepare(`SELECT id, name FROM product_groups`).all().map((g) => [g.name.toLowerCase(), g.id]));
  const taxes = new Map(db.prepare(`SELECT id, rate FROM taxes`).all().map((t) => [Number(t.rate), t.id]));
  let created = 0, updated = 0;
  const errors = [];
  db.transaction(() => {
    rows.forEach((r, i) => {
      try {
        let group_id = null;
        if (text(r.group)) {
          const key = String(r.group).trim().toLowerCase();
          if (!groups.has(key)) groups.set(key, db.prepare(`INSERT INTO product_groups (name) VALUES (?)`).run(String(r.group).trim()).lastInsertRowid);
          group_id = groups.get(key);
        }
        const body = { ...r, group_id, tax_id: r.tax_rate !== undefined && r.tax_rate !== '' ? taxes.get(num(r.tax_rate)) ?? null : null };
        const existing = text(r.code) && db.prepare(`SELECT id FROM products WHERE code = ?`).get(String(r.code).trim());
        writeProduct(existing ? existing.id : null, body);
        existing ? updated++ : created++;
      } catch (e) {
        errors.push({ row: i + 1, error: e.message });
      }
    });
  })();
  res.json({ created, updated, errors });
});

// ---- Gruppi ----
catalogRouter.get('/groups', requires('products.view'), (req, res) => {
  res.json(db.prepare(`SELECT g.*, (SELECT COUNT(*) FROM products WHERE group_id = g.id AND active = 1) AS products FROM product_groups g ORDER BY g.name`).all());
});
catalogRouter.post('/groups', requires('products.edit'), (req, res) => {
  const name = text(req.body.name);
  if (!name) throw new PosError('Il nome è obbligatorio');
  try {
    const id = db.prepare(`INSERT INTO product_groups (name, color) VALUES (?, ?)`).run(name, text(req.body.color) || '#3b82f6').lastInsertRowid;
    res.status(201).json(db.prepare(`SELECT * FROM product_groups WHERE id = ?`).get(id));
  } catch { throw new PosError('Gruppo già esistente'); }
});
catalogRouter.put('/groups/:id', requires('products.edit'), (req, res) => {
  const name = text(req.body.name);
  if (!name) throw new PosError('Il nome è obbligatorio');
  try {
    db.prepare(`UPDATE product_groups SET name = ?, color = ? WHERE id = ?`).run(name, text(req.body.color) || '#3b82f6', req.params.id);
  } catch { throw new PosError('Gruppo già esistente'); }
  res.json(db.prepare(`SELECT * FROM product_groups WHERE id = ?`).get(req.params.id));
});
catalogRouter.delete('/groups/:id', requires('products.edit'), (req, res) => {
  db.prepare(`DELETE FROM product_groups WHERE id = ?`).run(req.params.id);
  res.json({ deleted: true });
});

// ---- Aliquote e metodi di pagamento (lettura per tutti, scrittura con impostazioni) ----
catalogRouter.get('/taxes', (req, res) => res.json(db.prepare(`SELECT * FROM taxes ORDER BY rate DESC`).all()));
catalogRouter.post('/taxes', requires('settings.manage'), (req, res) => {
  const name = text(req.body.name);
  if (!name) throw new PosError('Il nome è obbligatorio');
  const rate = num(req.body.rate);
  if (rate < 0 || rate > 100) throw new PosError('Aliquota non valida');
  try {
    const id = db.prepare(`INSERT INTO taxes (name, rate) VALUES (?, ?)`).run(name, rate).lastInsertRowid;
    res.status(201).json(db.prepare(`SELECT * FROM taxes WHERE id = ?`).get(id));
  } catch { throw new PosError('Aliquota già esistente'); }
});
catalogRouter.put('/taxes/:id', requires('settings.manage'), (req, res) => {
  const rate = num(req.body.rate);
  if (rate < 0 || rate > 100) throw new PosError('Aliquota non valida');
  db.prepare(`UPDATE taxes SET name = ?, rate = ?, active = ? WHERE id = ?`).run(text(req.body.name), rate, bool(req.body.active ?? true), req.params.id);
  res.json(db.prepare(`SELECT * FROM taxes WHERE id = ?`).get(req.params.id));
});
catalogRouter.delete('/taxes/:id', requires('settings.manage'), (req, res) => {
  if (db.prepare(`SELECT 1 FROM products WHERE tax_id = ? LIMIT 1`).get(req.params.id)) {
    db.prepare(`UPDATE taxes SET active = 0 WHERE id = ?`).run(req.params.id);
    return res.json({ archived: true });
  }
  db.prepare(`DELETE FROM taxes WHERE id = ?`).run(req.params.id);
  res.json({ deleted: true });
});

catalogRouter.get('/payment-types', (req, res) => res.json(db.prepare(`SELECT * FROM payment_types ORDER BY position, id`).all()));
catalogRouter.post('/payment-types', requires('settings.manage'), (req, res) => {
  const name = text(req.body.name);
  if (!name) throw new PosError('Il nome è obbligatorio');
  try {
    const id = db.prepare(`INSERT INTO payment_types (name, is_cash, position) VALUES (?, ?, ?)`).run(name, bool(req.body.is_cash), num(req.body.position, 99)).lastInsertRowid;
    res.status(201).json(db.prepare(`SELECT * FROM payment_types WHERE id = ?`).get(id));
  } catch { throw new PosError('Metodo già esistente'); }
});
catalogRouter.put('/payment-types/:id', requires('settings.manage'), (req, res) => {
  db.prepare(`UPDATE payment_types SET name = ?, is_cash = ?, active = ?, position = ? WHERE id = ?`)
    .run(text(req.body.name), bool(req.body.is_cash), bool(req.body.active ?? true), num(req.body.position, 99), req.params.id);
  res.json(db.prepare(`SELECT * FROM payment_types WHERE id = ?`).get(req.params.id));
});
catalogRouter.delete('/payment-types/:id', requires('settings.manage'), (req, res) => {
  if (db.prepare(`SELECT 1 FROM payments WHERE payment_type_id = ? LIMIT 1`).get(req.params.id)) {
    db.prepare(`UPDATE payment_types SET active = 0 WHERE id = ?`).run(req.params.id);
    return res.json({ archived: true });
  }
  db.prepare(`DELETE FROM payment_types WHERE id = ?`).run(req.params.id);
  res.json({ deleted: true });
});
