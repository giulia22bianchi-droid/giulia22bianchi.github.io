import { Router } from 'express';
import { db } from '../db.js';

export const statsRouter = Router();

statsRouter.get('/', (req, res) => {
  const to = String(req.query.to ?? new Date().toLocaleDateString('sv-SE'));
  const from = String(
    req.query.from ?? new Date(Date.now() - 29 * 86400000).toLocaleDateString('sv-SE'),
  );
  const range = [from, to];
  const period = `date(s.created_at, 'localtime') BETWEEN ? AND ?`;

  const riepilogo = db
    .prepare(
      `SELECT COUNT(DISTINCT s.id) AS vendite,
              COALESCE(SUM(sl.quantity), 0) AS pezzi,
              COALESCE(SUM(sl.line_total), 0) AS totale
       FROM sales s LEFT JOIN sale_lines sl ON sl.sale_id = s.id
       WHERE ${period}`,
    )
    .get(...range);
  riepilogo.totale = Number(riepilogo.totale.toFixed(2));
  riepilogo.scontrino_medio = riepilogo.vendite
    ? Number((riepilogo.totale / riepilogo.vendite).toFixed(2))
    : 0;

  const topProdotti = db
    .prepare(
      `SELECT sl.brand_name, sl.model_name, sl.category_name, sl.quality_name, sl.color,
              SUM(sl.quantity) AS pezzi, ROUND(SUM(sl.line_total), 2) AS totale
       FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
       WHERE ${period}
       GROUP BY sl.brand_name, sl.model_name, sl.category_name, sl.quality_name, sl.color
       ORDER BY pezzi DESC, totale DESC LIMIT 20`,
    )
    .all(...range);

  const topModelli = db
    .prepare(
      `SELECT sl.brand_name, sl.model_name, SUM(sl.quantity) AS pezzi, ROUND(SUM(sl.line_total), 2) AS totale
       FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
       WHERE ${period}
       GROUP BY sl.brand_name, sl.model_name ORDER BY pezzi DESC LIMIT 20`,
    )
    .all(...range);

  const perCategoria = db
    .prepare(
      `SELECT sl.category_name AS nome, SUM(sl.quantity) AS pezzi, ROUND(SUM(sl.line_total), 2) AS totale
       FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
       WHERE ${period}
       GROUP BY sl.category_name ORDER BY totale DESC`,
    )
    .all(...range);

  const perCanale = db
    .prepare(
      `SELECT s.channel AS nome, COUNT(DISTINCT s.id) AS vendite,
              COALESCE(SUM(sl.quantity), 0) AS pezzi, ROUND(COALESCE(SUM(sl.line_total), 0), 2) AS totale
       FROM sales s LEFT JOIN sale_lines sl ON sl.sale_id = s.id
       WHERE ${period} GROUP BY s.channel ORDER BY totale DESC`,
    )
    .all(...range);

  const andamento = db
    .prepare(
      `SELECT date(s.created_at, 'localtime') AS giorno,
              COUNT(DISTINCT s.id) AS vendite,
              COALESCE(SUM(sl.quantity), 0) AS pezzi,
              ROUND(COALESCE(SUM(sl.line_total), 0), 2) AS totale
       FROM sales s LEFT JOIN sale_lines sl ON sl.sale_id = s.id
       WHERE ${period} GROUP BY giorno ORDER BY giorno`,
    )
    .all(...range);

  // Articoli fermi: a magazzino ma senza vendite nel periodo
  const pocoMovimentati = db
    .prepare(
      `SELECT i.id, b.name AS brand_name, m.name AS model_name, c.name AS category_name,
              q.name AS quality_name, i.color, i.quantity, i.price,
              COALESCE((SELECT SUM(sl.quantity) FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
                        WHERE sl.item_id = i.id AND date(s.created_at, 'localtime') BETWEEN ? AND ?), 0) AS venduti,
              (SELECT MAX(s.created_at) FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
               WHERE sl.item_id = i.id) AS ultima_vendita
       FROM items i
       JOIN models m ON m.id = i.model_id
       JOIN brands b ON b.id = m.brand_id
       JOIN categories c ON c.id = i.category_id
       LEFT JOIN qualities q ON q.id = i.quality_id
       WHERE i.active = 1 AND i.quantity > 0
       ORDER BY venduti ASC, i.quantity DESC LIMIT 30`,
    )
    .all(...range);

  const magazzino = db
    .prepare(
      `SELECT COUNT(*) AS varianti,
              COALESCE(SUM(quantity), 0) AS pezzi,
              ROUND(COALESCE(SUM(quantity * price), 0), 2) AS valore_vendita,
              ROUND(COALESCE(SUM(quantity * COALESCE(cost, 0)), 0), 2) AS valore_costo,
              SUM(CASE WHEN quantity <= 0 THEN 1 ELSE 0 END) AS esauriti,
              SUM(CASE WHEN quantity > 0 AND quantity <= min_stock THEN 1 ELSE 0 END) AS sotto_scorta
       FROM items WHERE active = 1`,
    )
    .get();

  const carichi = db
    .prepare(
      `SELECT COUNT(DISTINCT i.id) AS documenti, COALESCE(SUM(il.qty_loaded), 0) AS pezzi
       FROM intakes i JOIN intake_lines il ON il.intake_id = i.id
       WHERE date(i.created_at, 'localtime') BETWEEN ? AND ?`,
    )
    .get(...range);

  res.json({
    periodo: { from, to },
    riepilogo,
    magazzino,
    carichi,
    top_prodotti: topProdotti,
    top_modelli: topModelli,
    per_categoria: perCategoria,
    per_canale: perCanale,
    andamento,
    poco_movimentati: pocoMovimentati,
  });
});
