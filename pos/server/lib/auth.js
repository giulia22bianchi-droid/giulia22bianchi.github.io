import { randomBytes, timingSafeEqual, scryptSync } from 'node:crypto';
import { db, hashPassword } from '../db.js';
import { PosError } from './documents.js';

export function login(username, password) {
  const u = db.prepare(`SELECT * FROM users WHERE username = ? AND active = 1`).get(String(username || '').trim());
  // Calcolo comunque l'hash per non rivelare se l'utente esiste
  const salt = u?.salt ?? '00';
  const calc = scryptSync(String(password ?? ''), salt, 32);
  if (!u || !timingSafeEqual(calc, Buffer.from(u.hash, 'hex'))) throw new PosError('Credenziali non valide', 401);
  const token = randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (token, user_id) VALUES (?, ?)`).run(token, u.id);
  return { token, user: publicUser(u.id) };
}

export function publicUser(id) {
  const u = db.prepare(`
    SELECT u.id, u.username, u.name, u.role_id, r.name AS role, r.permissions
    FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`).get(id);
  if (!u) return null;
  return { ...u, permissions: JSON.parse(u.permissions) };
}

export function changePassword(userId, password) {
  if (String(password || '').length < 4) throw new PosError('La password deve avere almeno 4 caratteri');
  const { salt, hash } = hashPassword(password);
  db.prepare(`UPDATE users SET salt = ?, hash = ? WHERE id = ?`).run(salt, hash, userId);
  // Chiude le altre sessioni dell'utente
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
}

export function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : String(req.query.token || '');
  const row = token && db.prepare(`SELECT user_id FROM sessions WHERE token = ?`).get(token);
  const user = row && publicUser(row.user_id);
  const active = user && db.prepare(`SELECT active FROM users WHERE id = ?`).get(user.id).active;
  if (!user || !active) return res.status(401).json({ error: 'Accesso richiesto' });
  const perms = new Set(user.permissions);
  req.user = { ...user, token, can: (p) => perms.has(p) };
  next();
}

export const requires = (perm) => (req, res, next) =>
  req.user.can(perm) ? next() : res.status(403).json({ error: 'Permesso negato' });
