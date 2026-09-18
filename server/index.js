import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { db } from './db.js';
import { InventoryError } from './lib/inventory.js';
import { addClient, clientCount } from './lib/events.js';
import { catalogRouter } from './routes/catalog.js';
import { itemsRouter } from './routes/items.js';
import { salesRouter } from './routes/sales.js';
import { stockRouter } from './routes/stock.js';
import { statsRouter } from './routes/stats.js';
import { searchRouter } from './routes/search.js';
import { missingRouter } from './routes/missing.js';
import { intakeRouter } from './routes/intake.js';
import { whatsappRouter } from './routes/whatsapp.js';
import { collegaAvvisiScorte } from './lib/whatsapp.js';
import { seed } from './seed/run.js';

// Al primo avvio (o su un hosting con database vuoto) il catalogo di base va caricato
if (db.prepare(`SELECT COUNT(*) AS n FROM categories`).get().n === 0) {
  console.log('Database vuoto: carico il catalogo iniziale...', seed());
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Il corpo grezzo serve a verificare la firma dei webhook WhatsApp
app.use(express.json({ limit: '2mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.static(resolve(__dirname, '../public')));

// Protezione opzionale: se ACCESS_CODE è impostato, le API rispondono solo a chi
// conosce il codice. Senza variabile il server resta aperto (uso in rete locale).
const ACCESS_CODE = process.env.ACCESS_CODE;

function codiceValido(req) {
  if (!ACCESS_CODE) return true;
  const atteso = Buffer.from(ACCESS_CODE);
  const ricevuto = Buffer.from(String(req.get('x-access-code') ?? req.query.code ?? ''));
  return ricevuto.length === atteso.length && timingSafeEqual(ricevuto, atteso);
}

// Controllo di stato per l'hosting: sempre raggiungibile, ma i numeri del
// magazzino li vede solo chi ha il codice.
app.get('/api/health', (req, res) => {
  if (!codiceValido(req)) return res.json({ ok: true });
  res.json({
    ok: true,
    articoli: db.prepare(`SELECT COUNT(*) AS n FROM items WHERE active = 1`).get().n,
    modelli: db.prepare(`SELECT COUNT(*) AS n FROM models`).get().n,
    codici: db.prepare(`SELECT COUNT(*) AS n FROM model_codes`).get().n,
    dispositivi_connessi: clientCount(),
  });
});

if (ACCESS_CODE) {
  app.use('/api', (req, res, next) => {
    // Il webhook di WhatsApp è autenticato da Meta con token e firma, non dal codice
    if (req.path.startsWith('/whatsapp/webhook')) return next();
    if (codiceValido(req)) return next();
    res.status(401).json({ error: 'Codice di accesso non valido' });
  });
}

// Sincronizzazione in tempo reale tra PC, telefono e tablet
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  addClient(res);

  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => clearInterval(ping));
});

app.use('/api/catalog', catalogRouter);
app.use('/api/items', itemsRouter);
app.use('/api/sales', salesRouter);
app.use('/api/stock', stockRouter);
app.use('/api/stats', statsRouter);
app.use('/api/search', searchRouter);
app.use('/api/missing', missingRouter);
app.use('/api/intake', intakeRouter);
app.use('/api/whatsapp', whatsappRouter);

collegaAvvisiScorte();

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint non trovato', path: req.path });
});

app.use((err, req, res, next) => {
  if (err instanceof InventoryError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File troppo grande (max 15 MB)' });
  }
  console.error(err);
  res.status(500).json({ error: 'Errore interno del server' });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`Magazzino ricambi in ascolto su http://localhost:${PORT}`);
});
