import { Router } from 'express';
import { db } from '../db.js';
import { round2 } from '../lib/documents.js';
import { requires } from '../lib/auth.js';

export const reportsRouter = Router();
reportsRouter.use('/reports', requires('reports.view'));

const SIGN = `(CASE WHEN d.type = 'refund' THEN -1 ELSE 1 END)`;
const SALES = `d.status = 'completed' AND d.type IN ('sale', 'invoice', 'refund')`;
const DAY = `date(d.completed_at, 'localtime')`;

function range(req) {
  const today = new Date().toISOString().slice(0, 10);
  return { from: req.query.from || today, to: req.query.to || today };
}

const rounded = (rows, keys) => rows.map((r) => {
  for (const k of keys) if (typeof r[k] === 'number') r[k] = round2(r[k]);
  return r;
});

reportsRouter.get('/reports/summary', (req, res) => {
  const { from, to } = range(req);
  const base = `FROM documents d WHERE ${SALES} AND ${DAY} BETWEEN ? AND ?`;
  const totals = db.prepare(`
    SELECT COUNT(CASE WHEN type != 'refund' THEN 1 END) AS documents, COUNT(CASE WHEN type = 'refund' THEN 1 END) AS refunds_count,
      COALESCE(SUM(CASE WHEN type != 'refund' THEN total END), 0) AS gross,
      COALESCE(SUM(CASE WHEN type = 'refund' THEN total END), 0) AS refunded,
      COALESCE(SUM(${SIGN} * tax_total), 0) AS tax,
      COALESCE(SUM(CASE WHEN type != 'refund' THEN discount_total END), 0) AS discounts
    ${base}`).get(from, to);
  const cost = db.prepare(`
    SELECT COALESCE(SUM(${SIGN} * i.cost * i.qty), 0) AS cost, COALESCE(SUM(${SIGN} * i.net), 0) AS net
    FROM document_items i JOIN documents d ON d.id = i.document_id
    WHERE ${SALES} AND ${DAY} BETWEEN ? AND ?`).get(from, to);
  const payments = db.prepare(`
    SELECT pt.name, SUM(${SIGN} * pay.amount) AS amount
    FROM payments pay JOIN documents d ON d.id = pay.document_id JOIN payment_types pt ON pt.id = pay.payment_type_id
    WHERE ${SALES} AND ${DAY} BETWEEN ? AND ? GROUP BY pt.id ORDER BY amount DESC`).all(from, to);
  const purchases = db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS count FROM documents d
    WHERE d.status = 'completed' AND d.type = 'purchase' AND ${DAY} BETWEEN ? AND ?`).get(from, to);
  const due = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type = 'invoice' THEN total - paid END), 0) AS receivable,
           COALESCE(SUM(CASE WHEN type = 'purchase' THEN total - paid END), 0) AS payable
    FROM documents WHERE status = 'completed' AND type IN ('invoice', 'purchase')`).get();
  const net = round2(totals.gross - totals.refunded);
  res.json({
    from, to, documents: totals.documents, refunds_count: totals.refunds_count,
    gross: round2(totals.gross), refunded: round2(totals.refunded), net,
    tax: round2(totals.tax), discounts: round2(totals.discounts),
    net_of_tax: round2(cost.net), cost: round2(cost.cost), profit: round2(cost.net - cost.cost),
    average_ticket: totals.documents ? round2(totals.gross / totals.documents) : 0,
    payments: rounded(payments, ['amount']),
    purchases: { total: round2(purchases.total), count: purchases.count },
    receivable: round2(due.receivable), payable: round2(due.payable),
  });
});

reportsRouter.get('/reports/daily', (req, res) => {
  const { from, to } = range(req);
  res.json(rounded(db.prepare(`
    SELECT ${DAY} AS day, COUNT(CASE WHEN d.type != 'refund' THEN 1 END) AS documents,
      SUM(${SIGN} * d.total) AS total, SUM(${SIGN} * d.tax_total) AS tax
    FROM documents d WHERE ${SALES} AND ${DAY} BETWEEN ? AND ? GROUP BY day ORDER BY day`).all(from, to), ['total', 'tax']));
});

reportsRouter.get('/reports/hourly', (req, res) => {
  const { from, to } = range(req);
  res.json(rounded(db.prepare(`
    SELECT strftime('%H', d.completed_at, 'localtime') AS hour, COUNT(*) AS documents, SUM(d.total) AS total
    FROM documents d WHERE ${SALES} AND d.type != 'refund' AND ${DAY} BETWEEN ? AND ? GROUP BY hour ORDER BY hour`).all(from, to), ['total']));
});

function itemReport(groupExpr, joins = '', extraWhere = '') {
  return (req, res) => {
    const { from, to } = range(req);
    res.json(rounded(db.prepare(`
      SELECT ${groupExpr} AS name, SUM(${SIGN} * i.qty) AS qty, SUM(${SIGN} * i.total) AS total,
        SUM(${SIGN} * i.net) AS net, SUM(${SIGN} * (i.net - i.cost * i.qty)) AS profit
      FROM document_items i JOIN documents d ON d.id = i.document_id ${joins}
      WHERE ${SALES} AND ${DAY} BETWEEN ? AND ? ${extraWhere}
      GROUP BY ${groupExpr === 'i.name' ? 'COALESCE(i.product_id, i.name)' : groupExpr} ORDER BY total DESC LIMIT 500`).all(from, to), ['qty', 'total', 'net', 'profit']));
  };
}
reportsRouter.get('/reports/products', itemReport('i.name'));
reportsRouter.get('/reports/groups', itemReport(`COALESCE(g.name, 'Senza gruppo')`, 'LEFT JOIN products p ON p.id = i.product_id LEFT JOIN product_groups g ON g.id = p.group_id'));

reportsRouter.get('/reports/users', (req, res) => {
  const { from, to } = range(req);
  res.json(rounded(db.prepare(`
    SELECT u.name, COUNT(CASE WHEN d.type != 'refund' THEN 1 END) AS documents, SUM(${SIGN} * d.total) AS total, SUM(${SIGN} * d.discount_total) AS discounts
    FROM documents d JOIN users u ON u.id = d.user_id WHERE ${SALES} AND ${DAY} BETWEEN ? AND ?
    GROUP BY u.id ORDER BY total DESC`).all(from, to), ['total', 'discounts']));
});

reportsRouter.get('/reports/customers', (req, res) => {
  const { from, to } = range(req);
  res.json(rounded(db.prepare(`
    SELECT p.name, COUNT(CASE WHEN d.type != 'refund' THEN 1 END) AS documents, SUM(${SIGN} * d.total) AS total
    FROM documents d JOIN partners p ON p.id = d.partner_id WHERE ${SALES} AND ${DAY} BETWEEN ? AND ?
    GROUP BY p.id ORDER BY total DESC LIMIT 200`).all(from, to), ['total']));
});

reportsRouter.get('/reports/taxes', (req, res) => {
  const { from, to } = range(req);
  res.json(rounded(db.prepare(`
    SELECT i.tax_rate AS rate, SUM(${SIGN} * i.net) AS net, SUM(${SIGN} * i.tax) AS tax, SUM(${SIGN} * i.total) AS total
    FROM document_items i JOIN documents d ON d.id = i.document_id
    WHERE ${SALES} AND ${DAY} BETWEEN ? AND ? GROUP BY i.tax_rate ORDER BY i.tax_rate DESC`).all(from, to), ['rate', 'net', 'tax', 'total']));
});

reportsRouter.get('/reports/stock', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.code, p.unit, p.stock, p.min_stock, p.cost, p.price, g.name AS group_name,
      ROUND(p.stock * p.cost, 2) AS cost_value, ROUND(p.stock * p.price, 2) AS retail_value
    FROM products p LEFT JOIN product_groups g ON g.id = p.group_id
    WHERE p.active = 1 AND p.track_stock = 1 ORDER BY p.name`).all();
  res.json({
    products: rows,
    cost_value: round2(rows.reduce((s, r) => s + Math.max(0, r.cost_value), 0)),
    retail_value: round2(rows.reduce((s, r) => s + Math.max(0, r.retail_value), 0)),
    low: rows.filter((r) => r.stock <= r.min_stock),
  });
});
