import { Router } from 'express';
import { readFileSync, writeFileSync } from 'node:fs';
import express from 'express';
import { db, DB_PATH, PERMISSIONS, getSettings, hashPassword } from '../db.js';
import { PosError } from '../lib/documents.js';
import { changePassword, requires } from '../lib/auth.js';

export const adminRouter = Router();

const SETTING_KEYS = [
  'company_name', 'company_address', 'company_tax_number', 'company_phone', 'currency', 'receipt_header', 'receipt_footer',
  'prices_include_tax', 'require_shift', 'allow_negative_stock',
  'sale_prefix', 'invoice_prefix', 'refund_prefix', 'purchase_prefix', 'adjustment_prefix',
];

adminRouter.get('/settings', (req, res) => res.json(getSettings()));
adminRouter.put('/settings', requires('settings.manage'), (req, res) => {
  const upsert = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  db.transaction(() => {
    for (const k of SETTING_KEYS) if (k in req.body) upsert.run(k, String(req.body[k] ?? ''));
  })();
  res.json(getSettings());
});

// ---- Utenti e ruoli ----
adminRouter.get('/permissions', requires('users.manage'), (req, res) => res.json(PERMISSIONS));

adminRouter.get('/roles', (req, res) => {
  res.json(db.prepare(`SELECT * FROM roles ORDER BY id`).all().map((r) => ({ ...r, permissions: JSON.parse(r.permissions) })));
});
function rolePerms(b) {
  const list = Array.isArray(b.permissions) ? b.permissions.filter((p) => p in PERMISSIONS) : [];
  return JSON.stringify([...new Set(list)]);
}
adminRouter.post('/roles', requires('users.manage'), (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new PosError('Il nome è obbligatorio');
  try {
    const id = db.prepare(`INSERT INTO roles (name, permissions) VALUES (?, ?)`).run(name, rolePerms(req.body)).lastInsertRowid;
    res.status(201).json({ id, name, permissions: JSON.parse(rolePerms(req.body)) });
  } catch { throw new PosError('Ruolo già esistente'); }
});
adminRouter.put('/roles/:id', requires('users.manage'), (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new PosError('Il nome è obbligatorio');
  const perms = rolePerms(req.body);
  // Non si può togliere la gestione utenti all'ultimo amministratore
  if (!JSON.parse(perms).includes('users.manage')) {
    const others = db.prepare(`
      SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.active = 1 AND r.id != ? AND r.permissions LIKE '%users.manage%'`).get(req.params.id).n;
    const here = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role_id = ? AND active = 1`).get(req.params.id).n;
    if (others === 0 && here > 0) throw new PosError('Deve restare almeno un utente che gestisce gli utenti');
  }
  db.prepare(`UPDATE roles SET name = ?, permissions = ? WHERE id = ?`).run(name, perms, req.params.id);
  res.json({ id: Number(req.params.id), name, permissions: JSON.parse(perms) });
});
adminRouter.delete('/roles/:id', requires('users.manage'), (req, res) => {
  if (db.prepare(`SELECT 1 FROM users WHERE role_id = ?`).get(req.params.id)) throw new PosError('Ci sono utenti con questo ruolo');
  db.prepare(`DELETE FROM roles WHERE id = ?`).run(req.params.id);
  res.json({ deleted: true });
});

adminRouter.get('/users', requires('users.manage'), (req, res) => {
  res.json(db.prepare(`
    SELECT u.id, u.username, u.name, u.role_id, u.active, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.name`).all());
});

function remainingAdmins(exceptId) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.active = 1 AND u.id != ? AND r.permissions LIKE '%users.manage%'`).get(exceptId).n;
}

adminRouter.post('/users', requires('users.manage'), (req, res) => {
  const { username, name, role_id, password } = req.body;
  if (!String(username || '').trim() || !String(name || '').trim()) throw new PosError('Nome utente e nome sono obbligatori');
  if (String(password || '').length < 4) throw new PosError('La password deve avere almeno 4 caratteri');
  if (!db.prepare(`SELECT 1 FROM roles WHERE id = ?`).get(role_id)) throw new PosError('Ruolo non valido');
  const { salt, hash } = hashPassword(password);
  try {
    const id = db.prepare(`INSERT INTO users (username, name, role_id, salt, hash) VALUES (?, ?, ?, ?, ?)`)
      .run(String(username).trim(), String(name).trim(), role_id, salt, hash).lastInsertRowid;
    res.status(201).json({ id });
  } catch { throw new PosError('Nome utente già in uso'); }
});

adminRouter.put('/users/:id', requires('users.manage'), (req, res) => {
  const id = Number(req.params.id);
  const { name, role_id, active, password } = req.body;
  const role = db.prepare(`SELECT permissions FROM roles WHERE id = ?`).get(role_id);
  if (!role) throw new PosError('Ruolo non valido');
  const stillAdmin = JSON.parse(role.permissions).includes('users.manage') && active !== false && active !== 0;
  if (!stillAdmin && remainingAdmins(id) === 0) throw new PosError('Deve restare almeno un utente che gestisce gli utenti');
  db.prepare(`UPDATE users SET name = ?, role_id = ?, active = ? WHERE id = ?`).run(String(name || '').trim(), role_id, active === false || active === 0 ? 0 : 1, id);
  if (password) changePassword(id, password);
  if (active === false || active === 0) db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(id);
  res.json({ id });
});

// ---- Backup e ripristino ----
adminRouter.get('/backup', requires('settings.manage'), (req, res) => {
  const buf = db.serialize();
  res.set({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="pos-backup-${new Date().toISOString().slice(0, 10)}.db"`,
  });
  res.send(buf);
});

adminRouter.post('/restore', requires('settings.manage'), express.raw({ type: '*/*', limit: '200mb' }), (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 100 || buf.subarray(0, 15).toString() !== 'SQLite format 3') throw new PosError('Il file non è un backup valido');
  writeFileSync(`${DB_PATH}.restore`, buf);
  res.json({ ok: true, message: 'Backup caricato: riavvia il server per completare il ripristino.' });
});
