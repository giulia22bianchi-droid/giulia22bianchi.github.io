import { Router } from 'express';
import { db } from '../db.js';
import { PosError, partnerBalance } from '../lib/documents.js';
import { requires } from '../lib/auth.js';

export const partnersRouter = Router();

const text = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

function fields(b, type) {
  const name = text(b.name);
  if (!name) throw new PosError('Il nome è obbligatorio');
  const discount = Number(b.discount_pct) || 0;
  if (discount < 0 || discount > 100) throw new PosError('Sconto non valido');
  return {
    type, name, code: text(b.code), tax_number: text(b.tax_number), address: text(b.address), city: text(b.city),
    phone: text(b.phone), email: text(b.email), discount_pct: type === 'customer' ? discount : 0,
    notes: text(b.notes), active: b.active === false || b.active === 0 ? 0 : 1,
  };
}

for (const [path, type] of [['customers', 'customer'], ['suppliers', 'supplier']]) {
  partnersRouter.get(`/${path}`, (req, res) => {
    const args = [type];
    let sql = `SELECT * FROM partners WHERE type = ?`;
    if (req.query.all !== '1') sql += ` AND active = 1`;
    if (req.query.q) {
      sql += ` AND (name LIKE ? OR phone LIKE ? OR tax_number LIKE ? OR email LIKE ? OR code LIKE ?)`;
      const like = `%${req.query.q}%`;
      args.push(like, like, like, like, like);
    }
    const rows = db.prepare(`${sql} ORDER BY name LIMIT 1000`).all(...args);
    for (const r of rows) r.balance = partnerBalance(r.id);
    res.json(rows);
  });

  partnersRouter.post(`/${path}`, requires('partners.edit'), (req, res) => {
    const f = fields(req.body, type);
    const id = db.prepare(`INSERT INTO partners (${Object.keys(f).join(', ')}) VALUES (${Object.keys(f).map((k) => '@' + k).join(', ')})`).run(f).lastInsertRowid;
    res.status(201).json(db.prepare(`SELECT * FROM partners WHERE id = ?`).get(id));
  });

  partnersRouter.put(`/${path}/:id`, requires('partners.edit'), (req, res) => {
    const f = fields(req.body, type);
    db.prepare(`UPDATE partners SET ${Object.keys(f).map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id AND type = @type`).run({ ...f, id: req.params.id });
    res.json(db.prepare(`SELECT * FROM partners WHERE id = ?`).get(req.params.id));
  });

  partnersRouter.delete(`/${path}/:id`, requires('partners.edit'), (req, res) => {
    if (db.prepare(`SELECT 1 FROM documents WHERE partner_id = ? LIMIT 1`).get(req.params.id)) {
      db.prepare(`UPDATE partners SET active = 0 WHERE id = ?`).run(req.params.id);
      return res.json({ archived: true });
    }
    db.prepare(`DELETE FROM partners WHERE id = ?`).run(req.params.id);
    res.json({ deleted: true });
  });
}

// Storico documenti di un cliente/fornitore
partnersRouter.get('/partners/:id/documents', (req, res) => {
  res.json(db.prepare(`
    SELECT id, type, number, status, total, paid, completed_at FROM documents
    WHERE partner_id = ? AND status != 'held' ORDER BY completed_at DESC LIMIT 200`).all(req.params.id));
});
