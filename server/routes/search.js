import { Router } from 'express';
import { db } from '../db.js';
import { ITEM_SELECT, InventoryError } from '../lib/inventory.js';
import { assist } from '../lib/assistant.js';

export const searchRouter = Router();

// Ricerca da banco: stessa logica che userà l'assistente WhatsApp
searchRouter.get('/', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) throw new InventoryError('Parametro q obbligatorio');

  const result = assist(q, {
    channel: String(req.query.channel ?? 'web'),
    logMisses: req.query.log === '1',
  });

  // Il codice ricambio del fornitore (SKU) è una scorciatoia diretta all'articolo
  const bySku = db
    .prepare(`${ITEM_SELECT} WHERE i.active = 1 AND i.sku IS NOT NULL AND upper(i.sku) = upper(?)`)
    .all(q);
  if (bySku.length) {
    result.sku_match = bySku;
    if (result.status === 'modello_non_riconosciuto') {
      result.status = bySku[0].quantity > 0 ? 'disponibile' : 'esaurito';
      result.question = null;
      result.item = bySku[0];
      result.items = bySku;
      result.price = bySku[0].price;
      result.quantity = bySku[0].quantity;
    }
  }

  res.json(result);
});
