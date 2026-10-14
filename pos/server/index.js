import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { db, getSettings } from './db.js';
import { PosError } from './lib/documents.js';
import { authenticate, login, publicUser, changePassword } from './lib/auth.js';
import { catalogRouter } from './routes/catalog.js';
import { partnersRouter } from './routes/partners.js';
import { documentsRouter } from './routes/documents.js';
import { registerRouter } from './routes/register.js';
import { reportsRouter } from './routes/reports.js';
import { adminRouter } from './routes/admin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(resolve(__dirname, '../public')));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Limite semplice ai tentativi di accesso falliti, per indirizzo
const failures = new Map();
app.post('/api/login', (req, res) => {
  const key = req.ip;
  const f = failures.get(key);
  if (f && f.count >= 8 && Date.now() - f.last < 60_000) return res.status(429).json({ error: 'Troppi tentativi: riprova tra un minuto' });
  try {
    const r = login(req.body.username, req.body.password);
    failures.delete(key);
    res.json(r);
  } catch (e) {
    failures.set(key, { count: (f && Date.now() - f.last < 60_000 ? f.count : 0) + 1, last: Date.now() });
    throw e;
  }
});

app.use('/api', authenticate);

app.get('/api/me', (req, res) => res.json({ user: publicUser(req.user.id), settings: getSettings() }));
app.post('/api/logout', (req, res) => {
  db.prepare(`DELETE FROM sessions WHERE token = ?`).run(req.user.token);
  res.json({ ok: true });
});
app.post('/api/me/password', (req, res) => {
  const row = db.prepare(`SELECT 1 FROM users WHERE id = ?`).get(req.user.id);
  if (!row) throw new PosError('Utente non trovato', 404);
  // Richiede la password attuale, poi apre una nuova sessione (le altre vengono chiuse)
  login(req.user.username, req.body.current);
  changePassword(req.user.id, req.body.password);
  res.json(login(req.user.username, req.body.password));
});

app.use('/api', catalogRouter, partnersRouter, documentsRouter, registerRouter, reportsRouter, adminRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Non trovato' }));

// Gli errori di dominio rispondono con il loro codice; il resto è un errore interno
app.use((err, req, res, next) => {
  if (err instanceof PosError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Errore interno' });
});

const PORT = process.env.POS_PORT || process.env.PORT || 3100;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`Cassa POS pronta su http://localhost:${PORT}  (utente iniziale: admin / admin)`);
  });
}
