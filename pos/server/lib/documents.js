import { db, getSetting, nextNumber } from '../db.js';

export class PosError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

export const DOC_TYPES = ['sale', 'invoice', 'refund', 'purchase', 'adjustment'];
const STOCK_SIGN = { sale: -1, invoice: -1, refund: 1, purchase: 1, adjustment: 1 };

/**
 * Calcola righe e totali. I prezzi sono lordi (IVA inclusa) oppure netti
 * a seconda dell'impostazione `prices_include_tax`.
 * Lo sconto documento (percentuale o importo) viene ripartito in proporzione sulle righe.
 */
export function calcTotals(lines, discount, inclusive) {
  const raw = lines.map((l) => {
    const base = l.qty * l.price;
    return { base, value: base * (1 - (l.discount_pct || 0) / 100) };
  });
  const sumValue = raw.reduce((s, r) => s + r.value, 0);
  let docPct = 0;
  if (discount && discount.value > 0) {
    if (discount.type === 'amount') docPct = sumValue > 0 ? (Math.min(discount.value, sumValue) / sumValue) * 100 : 0;
    else docPct = Math.min(discount.value, 100);
  }
  const out = lines.map((l, i) => {
    const final = round2(raw[i].value * (1 - docPct / 100));
    const rate = (l.tax_rate || 0) / 100;
    let net, tax, total;
    if (inclusive) {
      total = final;
      net = round2(final / (1 + rate));
      tax = round2(total - net);
    } else {
      net = final;
      tax = round2(final * rate);
      total = round2(net + tax);
    }
    return { ...l, net, tax, total };
  });
  const subtotal = round2(raw.reduce((s, r) => s + r.base, 0));
  const finalSum = out.reduce((s, l) => s + (inclusive ? l.total : l.net), 0);
  return {
    items: out,
    subtotal,
    discount_total: round2(subtotal - finalSum),
    tax_total: round2(out.reduce((s, l) => s + l.tax, 0)),
    total: round2(out.reduce((s, l) => s + l.total, 0)),
  };
}

function openShiftOf(userId) {
  return db.prepare(`SELECT * FROM shifts WHERE user_id = ? AND closed_at IS NULL`).get(userId);
}

const getProduct = db.prepare(`
  SELECT p.*, COALESCE(t.rate, 0) AS tax_rate FROM products p LEFT JOIN taxes t ON t.id = p.tax_id WHERE p.id = ?`);

function resolveLines(input, type, can) {
  if (!Array.isArray(input.items) || input.items.length === 0) throw new PosError('Il documento non ha righe');
  return input.items.map((it) => {
    const qty = Number(it.qty);
    if (!Number.isFinite(qty) || qty === 0) throw new PosError('Quantità non valida');
    if (type !== 'adjustment' && qty < 0) throw new PosError('Quantità non valida');
    let line;
    if (it.product_id) {
      const p = getProduct.get(it.product_id);
      if (!p) throw new PosError('Prodotto non trovato', 404);
      const standard = type === 'purchase' ? p.cost : p.price;
      const price = it.price === undefined || it.price === null || it.price === '' ? standard : Number(it.price);
      if (type === 'sale' || type === 'invoice') {
        if (Math.abs(price - standard) > 0.004 && !can('pos.price_change') && !p.allow_price_change) {
          throw new PosError(`Non puoi modificare il prezzo di "${p.name}"`, 403);
        }
      }
      line = { product_id: p.id, name: it.name || p.name, price, cost: p.cost, tax_rate: p.tax_rate, track: p.track_stock, stock: p.stock };
    } else {
      if (!it.name) throw new PosError('Riga libera senza descrizione');
      if (!can('pos.price_change') && type !== 'purchase' && type !== 'adjustment') {
        throw new PosError('Non puoi inserire righe libere', 403);
      }
      line = { product_id: null, name: String(it.name), price: Number(it.price) || 0, cost: 0, tax_rate: Number(it.tax_rate) || 0, track: 0 };
    }
    if (!Number.isFinite(line.price) || (line.price < 0 && type !== 'adjustment')) throw new PosError('Prezzo non valido');
    const d = Number(it.discount_pct) || 0;
    if (d < 0 || d > 100) throw new PosError('Sconto non valido');
    if (d > 0 && !can('pos.discount')) throw new PosError('Non puoi applicare sconti', 403);
    return { ...line, qty: round3(qty), discount_pct: d, note: it.note || null };
  });
}

function checkPayments(payments) {
  const list = (payments || []).map((p) => ({ payment_type_id: Number(p.payment_type_id), amount: round2(p.amount) })).filter((p) => p.amount !== 0);
  for (const p of list) {
    if (!(p.amount > 0)) throw new PosError('Importo di pagamento non valido');
    if (!db.prepare(`SELECT 1 FROM payment_types WHERE id = ?`).get(p.payment_type_id)) throw new PosError('Metodo di pagamento sconosciuto');
  }
  return list;
}

function checkRefundLimits(refId, lines, selfId) {
  const orig = db.prepare(`SELECT * FROM documents WHERE id = ?`).get(refId);
  if (!orig || !['sale', 'invoice'].includes(orig.type) || orig.status !== 'completed') throw new PosError('Documento da stornare non valido');
  const sold = db.prepare(`SELECT product_id, SUM(qty) AS q FROM document_items WHERE document_id = ? GROUP BY product_id`).all(refId);
  const refunded = db.prepare(`
    SELECT i.product_id, SUM(i.qty) AS q FROM document_items i JOIN documents d ON d.id = i.document_id
    WHERE d.ref_id = ? AND d.type = 'refund' AND d.status = 'completed' AND d.id != ? GROUP BY i.product_id`).all(refId, selfId ?? 0);
  const soldMap = new Map(sold.map((r) => [r.product_id, r.q]));
  const refMap = new Map(refunded.map((r) => [r.product_id, r.q]));
  const asking = new Map();
  for (const l of lines) {
    if (!l.product_id) continue;
    asking.set(l.product_id, (asking.get(l.product_id) || 0) + l.qty);
  }
  for (const [pid, q] of asking) {
    const left = (soldMap.get(pid) || 0) - (refMap.get(pid) || 0);
    if (q > left + 1e-9) throw new PosError(`Reso superiore a quanto venduto (disponibili ${left})`);
  }
}

function moveStock(docId, type, lines, userId, sign = 1, reason) {
  const ins = db.prepare(`INSERT INTO stock_movements (product_id, document_id, user_id, qty, reason) VALUES (?, ?, ?, ?, ?)`);
  const upd = db.prepare(`UPDATE products SET stock = ROUND(stock + ?, 3) WHERE id = ?`);
  for (const l of lines) {
    if (!l.product_id || !l.track) continue;
    const delta = round3(l.qty * STOCK_SIGN[type] * sign);
    ins.run(l.product_id, docId, userId, delta, reason || type);
    upd.run(delta, l.product_id);
  }
}

function assertStock(type, lines) {
  if (!['sale', 'invoice'].includes(type) || getSetting('allow_negative_stock') === '1') return;
  const need = new Map();
  for (const l of lines) if (l.product_id && l.track) need.set(l.product_id, (need.get(l.product_id) || 0) + l.qty);
  for (const [pid, q] of need) {
    const p = db.prepare(`SELECT name, stock FROM products WHERE id = ?`).get(pid);
    if (p.stock < q - 1e-9) throw new PosError(`Giacenza insufficiente per "${p.name}" (disponibili ${p.stock})`, 409);
  }
}

/**
 * Salva un documento. Con `hold: true` resta "in sospeso" (nessun effetto su magazzino e cassa);
 * altrimenti viene completato: numerazione, magazzino, pagamenti.
 * `user` = { id, can(permission) }.
 */
export const saveDocument = db.transaction((input, user) => {
  const type = input.type;
  if (!DOC_TYPES.includes(type)) throw new PosError('Tipo documento non valido');
  const perm = { sale: 'pos.sell', invoice: 'pos.sell', refund: 'pos.refund', purchase: 'purchases.manage', adjustment: 'stock.adjust' }[type];
  if (!user.can(perm)) throw new PosError('Permesso negato', 403);

  const hold = Boolean(input.hold);
  if (hold && !['sale', 'invoice'].includes(type)) throw new PosError('Solo vendite e fatture possono restare in sospeso');

  let existing = null;
  if (input.id) {
    existing = db.prepare(`SELECT * FROM documents WHERE id = ?`).get(input.id);
    if (!existing || existing.status !== 'held') throw new PosError('Solo i documenti in sospeso sono modificabili', 409);
  }

  const lines = resolveLines(input, type, user.can);
  const inclusive = getSetting('prices_include_tax') === '1';

  const dType = input.discount?.type === 'amount' ? 'amount' : 'pct';
  const dValue = Math.max(0, Number(input.discount?.value) || 0);
  if (dValue > 0 && !user.can('pos.discount') && type !== 'purchase') throw new PosError('Non puoi applicare sconti', 403);
  const calc = calcTotals(lines, { type: dType, value: dValue }, inclusive);

  let partnerId = input.partner_id || null;
  if (partnerId) {
    const wanted = type === 'purchase' ? 'supplier' : 'customer';
    const partner = db.prepare(`SELECT id, type FROM partners WHERE id = ?`).get(partnerId);
    if (!partner || partner.type !== wanted) throw new PosError(type === 'purchase' ? 'Fornitore non valido' : 'Cliente non valido');
  }
  if (type === 'invoice' && !partnerId && !hold) throw new PosError('La fattura richiede un cliente');
  if (type === 'purchase' && !partnerId) throw new PosError('L\'acquisto richiede un fornitore');

  if (type === 'refund' && input.ref_id) checkRefundLimits(input.ref_id, lines, existing?.id);

  const status = hold ? 'held' : 'completed';
  const shift = openShiftOf(user.id);
  if (!hold && ['sale', 'refund'].includes(type) && !shift && getSetting('require_shift') === '1') {
    throw new PosError('Apri un turno di cassa prima di vendere', 409);
  }
  if (!hold) assertStock(type, lines);

  // Pagamenti
  let payments = checkPayments(input.payments);
  let paid = 0;
  let change = 0;
  if (!hold) {
    const total = calc.total;
    const sum = round2(payments.reduce((s, p) => s + p.amount, 0));
    if (type === 'sale') {
      if (sum < total - 0.005) throw new PosError('Il pagamento non copre il totale');
      change = round2(sum - total);
      if (change > 0) {
        const cashIds = new Set(db.prepare(`SELECT id FROM payment_types WHERE is_cash = 1`).all().map((r) => r.id));
        const cash = payments.filter((p) => cashIds.has(p.payment_type_id)).reduce((s, p) => s + p.amount, 0);
        if (cash < change - 0.005) throw new PosError('Il resto si può dare solo su pagamenti in contanti');
        let left = change;
        payments = payments.map((p) => {
          if (!cashIds.has(p.payment_type_id) || left <= 0) return p;
          const cut = Math.min(p.amount, left);
          left = round2(left - cut);
          return { ...p, amount: round2(p.amount - cut) };
        }).filter((p) => p.amount > 0);
      }
      paid = total;
    } else if (type === 'refund') {
      if (payments.length === 0 && total > 0) {
        const cash = db.prepare(`SELECT id FROM payment_types WHERE is_cash = 1 AND active = 1 ORDER BY position LIMIT 1`).get();
        if (!cash) throw new PosError('Indica come restituire il denaro');
        payments = [{ payment_type_id: cash.id, amount: total }];
      }
      const s = round2(payments.reduce((a, p) => a + p.amount, 0));
      if (Math.abs(s - total) > 0.005) throw new PosError('I rimborsi devono coprire il totale del reso');
      paid = total;
    } else if (type === 'invoice' || type === 'purchase') {
      paid = Math.min(sum, total);
      if (sum > total + 0.005) throw new PosError('Il pagamento supera il totale');
    } else {
      payments = [];
    }
  }

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const fields = {
    type, status, partner_id: partnerId, user_id: user.id,
    shift_id: !hold && shift && ['sale', 'invoice', 'refund'].includes(type) ? shift.id : (existing?.shift_id ?? null),
    ref_id: input.ref_id || null,
    discount_type: dType, discount_value: dValue,
    subtotal: calc.subtotal, discount_total: calc.discount_total, tax_total: calc.tax_total, total: calc.total,
    paid, change_given: change, note: input.note || null, due_date: input.due_date || null,
    completed_at: hold ? null : now,
  };

  let id;
  if (existing) {
    id = existing.id;
    db.prepare(`DELETE FROM document_items WHERE document_id = ?`).run(id);
    const keys = Object.keys(fields);
    db.prepare(`UPDATE documents SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...fields, id });
  } else {
    const keys = Object.keys(fields);
    id = db.prepare(`INSERT INTO documents (${keys.join(', ')}) VALUES (${keys.map((k) => '@' + k).join(', ')})`).run(fields).lastInsertRowid;
  }
  const insItem = db.prepare(`
    INSERT INTO document_items (document_id, product_id, name, qty, price, cost, discount_pct, tax_rate, net, tax, total, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const l of calc.items) insItem.run(id, l.product_id, l.name, l.qty, l.price, l.cost, l.discount_pct, l.tax_rate, l.net, l.tax, l.total, l.note);

  if (!hold) {
    db.prepare(`UPDATE documents SET number = ? WHERE id = ?`).run(nextNumber(type), id);
    moveStock(id, type, calc.items, user.id);
    const insPay = db.prepare(`INSERT INTO payments (document_id, payment_type_id, shift_id, amount) VALUES (?, ?, ?, ?)`);
    for (const p of payments) insPay.run(id, p.payment_type_id, fields.shift_id, p.amount);
    if (type === 'purchase') updateCostsFromPurchase(calc.items);
  }
  return getDocument(id);
});

function updateCostsFromPurchase(lines) {
  const upd = db.prepare(`UPDATE products SET cost = ? WHERE id = ?`);
  for (const l of lines) if (l.product_id && l.qty > 0) upd.run(round2(l.net / l.qty), l.product_id);
}

export function getDocument(id) {
  const doc = db.prepare(`
    SELECT d.*, u.name AS user_name, p.name AS partner_name, p.tax_number AS partner_tax_number,
           p.address AS partner_address, p.city AS partner_city, o.number AS ref_number
    FROM documents d
    LEFT JOIN users u ON u.id = d.user_id
    LEFT JOIN partners p ON p.id = d.partner_id
    LEFT JOIN documents o ON o.id = d.ref_id
    WHERE d.id = ?`).get(id);
  if (!doc) return null;
  doc.items = db.prepare(`SELECT * FROM document_items WHERE document_id = ? ORDER BY id`).all(id);
  doc.payments = db.prepare(`
    SELECT pay.*, pt.name AS payment_type_name, pt.is_cash FROM payments pay
    JOIN payment_types pt ON pt.id = pay.payment_type_id WHERE pay.document_id = ? ORDER BY pay.id`).all(id);
  return doc;
}

export const addPayments = db.transaction((docId, payments, user) => {
  const doc = db.prepare(`SELECT * FROM documents WHERE id = ?`).get(docId);
  if (!doc || doc.status !== 'completed' || !['invoice', 'purchase'].includes(doc.type)) throw new PosError('Documento non incassabile', 409);
  const list = checkPayments(payments);
  const sum = round2(list.reduce((s, p) => s + p.amount, 0));
  if (sum <= 0) throw new PosError('Indica un importo');
  if (sum > round2(doc.total - doc.paid) + 0.005) throw new PosError('Il pagamento supera il residuo');
  const shift = doc.type === 'invoice' ? openShiftOf(user.id) : null;
  const ins = db.prepare(`INSERT INTO payments (document_id, payment_type_id, shift_id, amount) VALUES (?, ?, ?, ?)`);
  for (const p of list) ins.run(docId, p.payment_type_id, shift?.id ?? null, p.amount);
  db.prepare(`UPDATE documents SET paid = ROUND(paid + ?, 2) WHERE id = ?`).run(sum, docId);
  return getDocument(docId);
});

export const voidDocument = db.transaction((docId, user) => {
  if (!user.can('pos.void')) throw new PosError('Permesso negato', 403);
  const doc = getDocument(docId);
  if (!doc) throw new PosError('Documento non trovato', 404);
  if (doc.status !== 'completed') throw new PosError('Documento non annullabile', 409);
  if (['sale', 'invoice'].includes(doc.type)) {
    const hasRefund = db.prepare(`SELECT 1 FROM documents WHERE ref_id = ? AND type = 'refund' AND status = 'completed'`).get(docId);
    if (hasRefund) throw new PosError('Il documento ha dei resi: annulla prima quelli', 409);
  }
  const lines = doc.items.map((l) => ({ product_id: l.product_id, qty: l.qty, track: l.product_id ? getProduct.get(l.product_id)?.track_stock : 0 }));
  moveStock(docId, doc.type, lines, user.id, -1, 'annullamento');
  db.prepare(`UPDATE documents SET status = 'void' WHERE id = ?`).run(docId);
  return getDocument(docId);
});

export const deleteHeld = (id) => {
  const doc = db.prepare(`SELECT status FROM documents WHERE id = ?`).get(id);
  if (!doc || doc.status !== 'held') throw new PosError('Solo i documenti in sospeso si possono eliminare', 409);
  db.prepare(`DELETE FROM documents WHERE id = ?`).run(id);
};

/** Conta fisica: porta la giacenza al valore contato e registra la differenza. */
export const stockCount = db.transaction((counts, user) => {
  if (!user.can('stock.adjust')) throw new PosError('Permesso negato', 403);
  const items = [];
  for (const c of counts || []) {
    const p = db.prepare(`SELECT id, stock FROM products WHERE id = ?`).get(c.product_id);
    if (!p) continue;
    const counted = Number(c.counted);
    if (!Number.isFinite(counted) || counted < 0) throw new PosError('Quantità contata non valida');
    const delta = round3(counted - p.stock);
    if (delta !== 0) items.push({ product_id: p.id, qty: delta });
  }
  if (items.length === 0) return { changed: 0 };
  const doc = saveDocument({ type: 'adjustment', note: 'Inventario', items }, user);
  return { changed: items.length, document: doc };
});

export function partnerBalance(partnerId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(total - paid), 0) AS due FROM documents
    WHERE partner_id = ? AND status = 'completed' AND type IN ('invoice', 'purchase')`).get(partnerId);
  return round2(row.due);
}
