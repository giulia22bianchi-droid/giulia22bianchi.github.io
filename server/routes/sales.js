import { Router } from 'express';
import { db } from '../db.js';
import { InventoryError, registerSale, getSale, cancelSale, quote } from '../lib/inventory.js';

export const salesRouter = Router();

function today() {
  return new Date().toLocaleDateString('sv-SE'); // formato YYYY-MM-DD
}

// Preventivo: risponde prezzo e disponibilità senza toccare il magazzino
salesRouter.get('/quote', (req, res) => {
  const itemId = Number(req.query.item_id);
  if (!itemId) throw new InventoryError('item_id obbligatorio');
  res.json(quote(itemId, Number(req.query.quantity ?? 1)));
});

salesRouter.get('/daily', (req, res) => {
  const date = String(req.query.date ?? today());
  const sales = db
    .prepare(
      `SELECT * FROM sales WHERE date(created_at, 'localtime') = ? ORDER BY created_at DESC`,
    )
    .all(date);
  const lines = db
    .prepare(
      `SELECT sl.*, s.created_at, s.channel, s.customer_phone, s.customer_name
       FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
       WHERE date(s.created_at, 'localtime') = ?
       ORDER BY s.created_at DESC, sl.id`,
    )
    .all(date);

  res.json({
    date,
    vendite: sales.length,
    pezzi: lines.reduce((s, l) => s + l.quantity, 0),
    totale: Number(sales.reduce((s, v) => s + v.total, 0).toFixed(2)),
    per_canale: aggregate(lines, (l) => l.channel),
    righe: lines,
  });
});

salesRouter.get('/summary', (req, res) => {
  const date = String(req.query.date ?? today());
  const lines = db
    .prepare(
      `SELECT sl.*, s.channel, s.created_at FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
       WHERE date(s.created_at, 'localtime') = ?`,
    )
    .all(date);
  const sales = db
    .prepare(`SELECT * FROM sales WHERE date(created_at, 'localtime') = ?`)
    .all(date);

  const sottoScorta = db
    .prepare(
      `SELECT i.id, b.name AS brand_name, m.name AS model_name, c.name AS category_name,
              q.name AS quality_name, i.color, i.quantity, i.min_stock
       FROM items i
       JOIN models m ON m.id = i.model_id
       JOIN brands b ON b.id = m.brand_id
       JOIN categories c ON c.id = i.category_id
       LEFT JOIN qualities q ON q.id = i.quality_id
       WHERE i.active = 1 AND i.quantity <= i.min_stock
       ORDER BY i.quantity, b.name, m.name`,
    )
    .all();

  const carichi = db
    .prepare(
      `SELECT COUNT(DISTINCT i.id) AS documenti, COALESCE(SUM(il.qty_loaded), 0) AS pezzi
       FROM intakes i JOIN intake_lines il ON il.intake_id = i.id
       WHERE date(i.created_at, 'localtime') = ?`,
    )
    .get(date);

  res.json({
    date,
    vendite: sales.length,
    pezzi_venduti: lines.reduce((s, l) => s + l.quantity, 0),
    totale: Number(lines.reduce((s, l) => s + l.line_total, 0).toFixed(2)),
    per_canale: aggregate(lines, (l) => l.channel),
    per_categoria: aggregate(lines, (l) => l.category_name),
    prodotti: topProducts(lines),
    carichi,
    sotto_scorta: sottoScorta,
    sotto_scorta_totale: sottoScorta.length,
  });
});

salesRouter.get('/', (req, res) => {
  const { from, to, channel, customer_phone: phone, limit = 200 } = req.query;
  const where = [];
  const params = [];
  if (from) {
    where.push(`date(created_at, 'localtime') >= ?`);
    params.push(from);
  }
  if (to) {
    where.push(`date(created_at, 'localtime') <= ?`);
    params.push(to);
  }
  if (channel) {
    where.push('channel = ?');
    params.push(channel);
  }
  if (phone) {
    where.push('customer_phone = ?');
    params.push(phone);
  }
  const sales = db
    .prepare(
      `SELECT * FROM sales ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(...params, Number(limit));
  for (const sale of sales) {
    sale.lines = db.prepare(`SELECT * FROM sale_lines WHERE sale_id = ? ORDER BY id`).all(sale.id);
  }
  res.json({ sales, total: sales.length });
});

// Conferma vendita: è il solo momento in cui il magazzino viene scaricato
salesRouter.post('/', (req, res) => {
  const {
    channel = 'banco', customer_phone: customerPhone = null, customer_name: customerName = null,
    note = null, lines = [], item_id: itemId, quantity, actor = null,
  } = req.body ?? {};

  // Scorciatoia per la vendita al banco di un solo pezzo
  const saleLines = lines.length ? lines : itemId ? [{ item_id: itemId, quantity: quantity ?? 1 }] : [];

  const sale = registerSale({
    channel,
    customerPhone,
    customerName,
    note,
    lines: saleLines,
    actor,
  });
  res.status(201).json(sale);
});

salesRouter.get('/:id', (req, res) => {
  const sale = getSale(Number(req.params.id));
  if (!sale) throw new InventoryError('Vendita non trovata', 404);
  res.json(sale);
});

salesRouter.delete('/:id', (req, res) => {
  res.json(cancelSale(Number(req.params.id), req.body?.actor ?? null));
});

function aggregate(lines, keyFn) {
  const map = new Map();
  for (const line of lines) {
    const key = keyFn(line) ?? '—';
    if (!map.has(key)) map.set(key, { nome: key, pezzi: 0, totale: 0 });
    const row = map.get(key);
    row.pezzi += line.quantity;
    row.totale = Number((row.totale + line.line_total).toFixed(2));
  }
  return [...map.values()].sort((a, b) => b.totale - a.totale);
}

function topProducts(lines) {
  const map = new Map();
  for (const line of lines) {
    const key = [line.brand_name, line.model_name, line.category_name, line.quality_name, line.color]
      .filter(Boolean)
      .join(' · ');
    if (!map.has(key)) map.set(key, { prodotto: key, pezzi: 0, totale: 0, prezzo_unitario: line.unit_price });
    const row = map.get(key);
    row.pezzi += line.quantity;
    row.totale = Number((row.totale + line.line_total).toFixed(2));
  }
  return [...map.values()].sort((a, b) => b.pezzi - a.pezzi);
}
