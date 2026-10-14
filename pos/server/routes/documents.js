import { Router } from 'express';
import { db } from '../db.js';
import { PosError, saveDocument, getDocument, addPayments, voidDocument, deleteHeld, stockCount } from '../lib/documents.js';
import { requires } from '../lib/auth.js';

export const documentsRouter = Router();

documentsRouter.get('/documents', (req, res) => {
  const where = [];
  const args = [];
  const { type, status, from, to, partner_id, q, user_id, unpaid } = req.query;
  // Chi non ha i permessi di report vede solo i propri documenti
  if (!req.user.can('reports.view')) { where.push(`d.user_id = ?`); args.push(req.user.id); }
  else if (user_id) { where.push(`d.user_id = ?`); args.push(user_id); }
  if (type) { where.push(`d.type = ?`); args.push(type); }
  where.push(status ? `d.status = ?` : `d.status != 'held'`);
  if (status) args.push(status);
  if (from) { where.push(`date(COALESCE(d.completed_at, d.created_at), 'localtime') >= ?`); args.push(from); }
  if (to) { where.push(`date(COALESCE(d.completed_at, d.created_at), 'localtime') <= ?`); args.push(to); }
  if (partner_id) { where.push(`d.partner_id = ?`); args.push(partner_id); }
  if (unpaid === '1') where.push(`d.status = 'completed' AND d.type IN ('invoice','purchase') AND d.total - d.paid > 0.004`);
  if (q) { where.push(`(d.number LIKE ? OR p.name LIKE ? OR d.note LIKE ?)`); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(db.prepare(`
    SELECT d.id, d.type, d.status, d.number, d.total, d.paid, d.tax_total, d.discount_total, d.note, d.ref_id,
           COALESCE(d.completed_at, d.created_at) AS date, u.name AS user_name, p.name AS partner_name,
           (SELECT COUNT(*) FROM document_items WHERE document_id = d.id) AS lines
    FROM documents d LEFT JOIN users u ON u.id = d.user_id LEFT JOIN partners p ON p.id = d.partner_id
    WHERE ${where.join(' AND ')} ORDER BY d.id DESC LIMIT ${limit}`).all(...args));
});

// Documenti in sospeso (cassa)
documentsRouter.get('/documents/held', requires('pos.sell'), (req, res) => {
  res.json(db.prepare(`
    SELECT d.id, d.type, d.total, d.note, d.created_at, d.partner_id, p.name AS partner_name, u.name AS user_name,
           (SELECT COUNT(*) FROM document_items WHERE document_id = d.id) AS lines
    FROM documents d LEFT JOIN partners p ON p.id = d.partner_id LEFT JOIN users u ON u.id = d.user_id
    WHERE d.status = 'held' ORDER BY d.id DESC`).all());
});

documentsRouter.get('/documents/:id', (req, res) => {
  const doc = getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Documento non trovato' });
  if (!req.user.can('reports.view') && doc.user_id !== req.user.id) return res.status(403).json({ error: 'Permesso negato' });
  // Per i resi, quanto è già stato reso di ciascun prodotto
  if (['sale', 'invoice'].includes(doc.type)) {
    const refunded = db.prepare(`
      SELECT i.product_id, SUM(i.qty) AS q FROM document_items i JOIN documents d ON d.id = i.document_id
      WHERE d.ref_id = ? AND d.type = 'refund' AND d.status = 'completed' GROUP BY i.product_id`).all(doc.id);
    const map = new Map(refunded.map((r) => [r.product_id, r.q]));
    for (const it of doc.items) it.refunded_qty = map.get(it.product_id) || 0;
  }
  res.json(doc);
});

documentsRouter.post('/documents', (req, res) => {
  res.status(201).json(saveDocument(req.body, req.user));
});

documentsRouter.post('/documents/:id/payments', requires('pos.sell'), (req, res) => {
  res.json(addPayments(Number(req.params.id), req.body.payments, req.user));
});

documentsRouter.post('/documents/:id/void', (req, res) => {
  res.json(voidDocument(Number(req.params.id), req.user));
});

documentsRouter.delete('/documents/:id', requires('pos.sell'), (req, res) => {
  deleteHeld(Number(req.params.id));
  res.json({ deleted: true });
});

// ---- Magazzino ----
documentsRouter.get('/stock/movements', requires('products.view'), (req, res) => {
  const args = [];
  let where = '1=1';
  if (req.query.product_id) { where += ` AND m.product_id = ?`; args.push(req.query.product_id); }
  res.json(db.prepare(`
    SELECT m.*, p.name AS product_name, u.name AS user_name, d.number AS document_number
    FROM stock_movements m JOIN products p ON p.id = m.product_id
    LEFT JOIN users u ON u.id = m.user_id LEFT JOIN documents d ON d.id = m.document_id
    WHERE ${where} ORDER BY m.id DESC LIMIT 300`).all(...args));
});

documentsRouter.post('/stock/count', (req, res) => {
  res.json(stockCount(req.body.counts, req.user));
});

documentsRouter.post('/stock/adjust', requires('stock.adjust'), (req, res) => {
  const { product_id, qty, note } = req.body;
  if (!Number(qty)) throw new PosError('Indica la variazione');
  res.status(201).json(saveDocument({ type: 'adjustment', note: note || 'Rettifica', items: [{ product_id, qty: Number(qty) }] }, req.user));
});
