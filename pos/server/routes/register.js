import { Router } from 'express';
import { db } from '../db.js';
import { PosError, round2 } from '../lib/documents.js';
import { requires } from '../lib/auth.js';

export const registerRouter = Router();

const openShift = (userId) => db.prepare(`SELECT * FROM shifts WHERE user_id = ? AND closed_at IS NULL`).get(userId);

/** Dati del turno: totali per metodo di pagamento, movimenti e contante atteso in cassetto. */
export function shiftReport(shiftId) {
  const shift = db.prepare(`
    SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(shiftId);
  if (!shift) return null;
  const byPayment = db.prepare(`
    SELECT pt.id AS payment_type_id, pt.name, pt.is_cash,
      SUM(CASE WHEN d.type = 'refund' THEN 0 ELSE pay.amount END) AS sales,
      SUM(CASE WHEN d.type = 'refund' THEN pay.amount ELSE 0 END) AS refunds
    FROM payments pay JOIN documents d ON d.id = pay.document_id AND d.status = 'completed'
    JOIN payment_types pt ON pt.id = pay.payment_type_id
    WHERE pay.shift_id = ? GROUP BY pt.id ORDER BY pt.position`).all(shiftId)
    .map((r) => ({ ...r, sales: round2(r.sales), refunds: round2(r.refunds) }));
  const movements = db.prepare(`SELECT * FROM cash_movements WHERE shift_id = ? ORDER BY id`).all(shiftId);
  const cashIn = round2(movements.filter((m) => m.type === 'in').reduce((s, m) => s + m.amount, 0));
  const cashOut = round2(movements.filter((m) => m.type === 'out').reduce((s, m) => s + m.amount, 0));
  const cash = byPayment.filter((p) => p.is_cash).reduce((s, p) => s + p.sales - p.refunds, 0);
  const docs = db.prepare(`
    SELECT COUNT(CASE WHEN type != 'refund' THEN 1 END) AS count, COUNT(CASE WHEN type = 'refund' THEN 1 END) AS refund_count,
      COALESCE(SUM(CASE WHEN type != 'refund' THEN total END), 0) AS gross,
      COALESCE(SUM(CASE WHEN type = 'refund' THEN total END), 0) AS refunded,
      COALESCE(SUM(CASE WHEN type != 'refund' THEN tax_total ELSE -tax_total END), 0) AS tax,
      COALESCE(SUM(CASE WHEN type != 'refund' THEN discount_total END), 0) AS discounts
    FROM documents WHERE shift_id = ? AND status = 'completed'`).get(shiftId);
  return {
    shift, by_payment: byPayment, movements,
    cash_in: cashIn, cash_out: cashOut,
    expected_cash: round2(shift.opening_cash + cash + cashIn - cashOut),
    documents: { ...docs, gross: round2(docs.gross), refunded: round2(docs.refunded), tax: round2(docs.tax), discounts: round2(docs.discounts), net: round2(docs.gross - docs.refunded) },
  };
}

registerRouter.get('/shifts/current', (req, res) => {
  const s = openShift(req.user.id);
  res.json(s ? shiftReport(s.id) : null);
});

registerRouter.post('/shifts/open', requires('pos.sell'), (req, res) => {
  if (openShift(req.user.id)) throw new PosError('Hai già un turno aperto', 409);
  const cash = Number(req.body.opening_cash) || 0;
  if (cash < 0) throw new PosError('Fondo cassa non valido');
  const id = db.prepare(`INSERT INTO shifts (user_id, opening_cash) VALUES (?, ?)`).run(req.user.id, cash).lastInsertRowid;
  res.status(201).json(shiftReport(id));
});

registerRouter.post('/shifts/close', requires('register.manage'), (req, res) => {
  const s = openShift(req.user.id);
  if (!s) throw new PosError('Nessun turno aperto', 409);
  if (db.prepare(`SELECT 1 FROM documents WHERE shift_id = ? AND status = 'held'`).get(s.id)) {
    // I sospesi non bloccano la chiusura ma non appartengono più al turno
    db.prepare(`UPDATE documents SET shift_id = NULL WHERE shift_id = ? AND status = 'held'`).run(s.id);
  }
  const report = shiftReport(s.id);
  const counted = req.body.counted_cash === undefined || req.body.counted_cash === '' ? null : Number(req.body.counted_cash);
  if (counted !== null && !(counted >= 0)) throw new PosError('Contante contato non valido');
  db.prepare(`UPDATE shifts SET closed_at = datetime('now'), expected_cash = ?, counted_cash = ?, note = ? WHERE id = ?`)
    .run(report.expected_cash, counted, req.body.note || null, s.id);
  res.json(shiftReport(s.id));
});

registerRouter.post('/shifts/cash-movement', requires('register.manage'), (req, res) => {
  const s = openShift(req.user.id);
  if (!s) throw new PosError('Apri prima un turno', 409);
  const amount = round2(req.body.amount);
  const type = req.body.type === 'out' ? 'out' : 'in';
  if (!(amount > 0)) throw new PosError('Importo non valido');
  if (type === 'out' && amount > shiftReport(s.id).expected_cash + 0.005) throw new PosError('Il cassetto non contiene abbastanza contante');
  db.prepare(`INSERT INTO cash_movements (shift_id, user_id, type, amount, reason) VALUES (?, ?, ?, ?, ?)`)
    .run(s.id, req.user.id, type, amount, req.body.reason || null);
  res.status(201).json(shiftReport(s.id));
});

registerRouter.get('/shifts', requires('reports.view'), (req, res) => {
  res.json(db.prepare(`
    SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 100`).all());
});

registerRouter.get('/shifts/:id/report', (req, res) => {
  const report = shiftReport(req.params.id);
  if (!report) return res.status(404).json({ error: 'Turno non trovato' });
  if (report.shift.user_id !== req.user.id && !req.user.can('reports.view')) return res.status(403).json({ error: 'Permesso negato' });
  res.json(report);
});
