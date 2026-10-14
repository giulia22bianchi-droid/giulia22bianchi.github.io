// Livello dati dell'app: nessuna dipendenza dal DOM, quindi testabile con node --test.
// I prezzi sono IVA inclusa (come nel default di Aronium).

const KEY = 'aronium-clone-v2';

export const round2 = (n) => (Math.round((Number(n) + Number.EPSILON) * 100) / 100) || 0; // || 0 elimina il -0

export function seedState() {
  return {
    settings: {
      company: 'La Mia Attività', address: '', taxId: '', currency: '€',
      receiptFooter: 'Grazie e arrivederci!', lowStockDefault: 5,
    },
    counters: { product: 0, customer: 0, group: 0, document: { sale: 0, refund: 0, purchase: 0, adjust: 0 } },
    taxes: [
      { id: 't22', name: 'IVA 22%', rate: 22 },
      { id: 't10', name: 'IVA 10%', rate: 10 },
      { id: 't4', name: 'IVA 4%', rate: 4 },
      { id: 't0', name: 'Esente', rate: 0 },
    ],
    paymentTypes: [
      { id: 'cash', name: 'Cash', allowsChange: true },
      { id: 'card', name: 'Card', allowsChange: false },
      { id: 'check', name: 'Check', allowsChange: false },
    ],
    // Login a sola password come in Aronium. Credenziali iniziali: admin / 1234 (cambiarle da Impostazioni).
    users: [
      { id: 'u1', name: 'Admin', password: 'admin', role: 'admin' },
      { id: 'u2', name: 'Cassiere', password: '1234', role: 'cashier' },
    ],
    groups: [], products: [], customers: [], documents: [], held: [],
  };
}

export function demoState() {
  const s = seedState();
  const g = (name) => addGroup(s, name).id;
  const bev = g('Bevande'), food = g('Alimentari'), bak = g('Panetteria');
  const p = (name, group, price, cost, tax, stock, barcode) =>
    addProduct(s, { name, groupId: group, price, cost, taxId: tax, stock, barcode });
  p('Acqua naturale 0,5L', bev, 0.8, 0.3, 't10', 120, '8000000000011');
  p('Caffè espresso', bev, 1.2, 0.25, 't10', 500, '8000000000028');
  p('Cola 33cl', bev, 1.8, 0.7, 't22', 80, '8000000000035');
  p('Pane casereccio', bak, 2.5, 1.0, 't4', 30, '8000000000042');
  p('Cornetto', bak, 1.3, 0.5, 't10', 40, '8000000000059');
  p('Pasta 500g', food, 1.4, 0.8, 't4', 60, '8000000000066');
  p('Olio EVO 1L', food, 8.9, 5.5, 't10', 25, '8000000000073');
  p('Biscotti', food, 2.2, 1.1, 't22', 3, '8000000000080');
  addCustomer(s, { name: 'Mario Rossi', phone: '333 1234567', email: 'mario@example.com', taxId: '' });
  return s;
}

export function createStore(storage = null) {
  let state;
  const load = () => {
    try { const raw = storage && storage.getItem(KEY); if (raw) return JSON.parse(raw); } catch { /* ignora */ }
    return null;
  };
  state = { ...seedState(), ...(load() || demoState()) };
  const listeners = new Set();
  const save = () => {
    try { storage && storage.setItem(KEY, JSON.stringify(state)); } catch { /* quota/privato */ }
    listeners.forEach((f) => f());
  };
  save();
  return {
    get state() { return state; },
    save,
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
    reset(demo = false) { state = demo ? demoState() : seedState(); save(); },
    exportJSON() { return JSON.stringify(state, null, 2); },
    importJSON(text) {
      const obj = JSON.parse(text);
      if (!obj || !Array.isArray(obj.products) || !Array.isArray(obj.documents)) throw new Error('File non valido');
      state = { ...seedState(), ...obj }; save();
    },
  };
}

// ---------- anagrafiche ----------
export function addGroup(s, name) {
  const g = { id: 'g' + (++s.counters.group), name: String(name).trim() };
  if (!g.name) throw new Error('Nome gruppo obbligatorio');
  s.groups.push(g); return g;
}

export function addProduct(s, d) {
  const name = String(d.name || '').trim();
  if (!name) throw new Error('Nome prodotto obbligatorio');
  const price = Number(d.price), cost = Number(d.cost || 0);
  if (!(price >= 0)) throw new Error('Prezzo non valido');
  if (d.barcode && s.products.some((p) => p.barcode === d.barcode && p.id !== d.id)) throw new Error('Barcode già in uso');
  const p = {
    id: d.id || 'p' + (++s.counters.product), code: d.code || String(s.counters.product).padStart(4, '0'),
    name, barcode: d.barcode || '', groupId: d.groupId || '', taxId: d.taxId || 't22',
    price: round2(price), cost: round2(cost), stock: Number(d.stock || 0),
    trackStock: d.trackStock !== false, minStock: Number(d.minStock ?? s.settings.lowStockDefault),
    unit: d.unit || 'pz', active: d.active !== false, favorite: !!d.favorite,
  };
  s.products.push(p); return p;
}

export function updateProduct(s, id, d) {
  const i = s.products.findIndex((p) => p.id === id);
  if (i < 0) throw new Error('Prodotto inesistente');
  if (d.barcode && s.products.some((p) => p.barcode === d.barcode && p.id !== id)) throw new Error('Barcode già in uso');
  if (d.name !== undefined && !String(d.name).trim()) throw new Error('Nome prodotto obbligatorio');
  const num = ['price', 'cost', 'stock', 'minStock'];
  for (const k of num) if (d[k] !== undefined) d[k] = k === 'stock' || k === 'minStock' ? Number(d[k]) : round2(d[k]);
  Object.assign(s.products[i], d); return s.products[i];
}

export function deleteProduct(s, id) {
  const used = s.documents.some((doc) => doc.items.some((it) => it.productId === id));
  if (used) { updateProduct(s, id, { active: false }); return 'archived'; }
  s.products = s.products.filter((p) => p.id !== id); return 'deleted';
}

export function addCustomer(s, d) {
  const name = String(d.name || '').trim();
  if (!name) throw new Error('Nome cliente obbligatorio');
  const c = { id: 'c' + (++s.counters.customer), name, phone: d.phone || '', email: d.email || '', taxId: d.taxId || '', address: d.address || '' };
  s.customers.push(c); return c;
}

// ---------- calcoli ----------
export function taxRate(s, taxId) { return (s.taxes.find((t) => t.id === taxId) || { rate: 0 }).rate; }

// Riga: prezzo IVA inclusa, sconto % di riga.
export function calcLine(item) {
  const gross = round2(item.qty * item.price * (1 - (item.discount || 0) / 100));
  const net = round2(gross / (1 + item.taxRate / 100));
  return { gross, net, tax: round2(gross - net) };
}

export function calcTotals(items, docDiscount = 0) {
  const lines = items.map(calcLine);
  const sub = round2(lines.reduce((a, l) => a + l.gross, 0));
  const factor = 1 - Math.min(Math.max(docDiscount, 0), 100) / 100;
  const total = round2(sub * factor);
  const net = round2(lines.reduce((a, l) => a + l.net, 0) * factor);
  return { subtotal: sub, discountAmount: round2(sub - total), total, net, tax: round2(total - net) };
}

// ---------- documenti ----------
const prefix = { sale: 'V', refund: 'R', purchase: 'A', adjust: 'M' };
function nextNumber(s, type) {
  const n = ++s.counters.document[type];
  return `${prefix[type]}-${String(n).padStart(5, '0')}`;
}

function applyStock(s, items, sign) {
  for (const it of items) {
    const p = s.products.find((x) => x.id === it.productId);
    if (p && p.trackStock) p.stock = Math.round((p.stock + sign * it.qty) * 1000) / 1000;
  }
}

function snapshotItems(s, items) {
  return items.map((it) => {
    const p = s.products.find((x) => x.id === it.productId);
    if (!p) throw new Error('Prodotto inesistente nel documento');
    if (!(it.qty > 0) && it.qty !== undefined && it.qty !== 0) throw new Error('Quantità non valida');
    return {
      productId: p.id, name: p.name, qty: Number(it.qty), price: round2(it.price ?? p.price),
      cost: p.cost, taxRate: taxRate(s, p.taxId), discount: Number(it.discount || 0), unit: p.unit,
    };
  });
}

export function createSale(s, { items, customerId = '', discount = 0, payments, note = '', allowNegative = true, userId = '', service = '' }) {
  if (!items || !items.length) throw new Error('Carrello vuoto');
  const snap = snapshotItems(s, items);
  if (snap.some((i) => !(i.qty > 0))) throw new Error('Quantità non valida');
  if (!allowNegative) {
    for (const it of snap) {
      const p = s.products.find((x) => x.id === it.productId);
      if (p.trackStock && p.stock < it.qty) throw new Error(`Scorte insufficienti: ${p.name}`);
    }
  }
  const totals = calcTotals(snap, discount);
  const paid = round2((payments || []).reduce((a, p) => a + Number(p.amount), 0));
  if (paid < totals.total) throw new Error('Pagamento insufficiente');
  const change = round2(paid - totals.total);
  // Il resto può uscire solo dai pagamenti che lo consentono (contanti).
  const cashPaid = (payments || []).filter((p) => (s.paymentTypes.find((t) => t.id === p.typeId) || {}).allowsChange)
    .reduce((a, p) => a + Number(p.amount), 0);
  if (change > cashPaid) throw new Error('Resto non consentito per questo metodo di pagamento');
  const doc = {
    id: 'd' + Date.now() + Math.random().toString(36).slice(2, 6), type: 'sale', number: nextNumber(s, 'sale'),
    date: new Date().toISOString(), customerId, userId, service, items: snap, discount, totals, note,
    payments: payments.map((p) => ({ typeId: p.typeId, amount: round2(p.amount) })), change,
  };
  applyStock(s, snap, -1);
  s.documents.push(doc); return doc;
}

export function refundSale(s, docId, lines /* [{productId, qty}] opzionale: default tutto */) {
  const orig = s.documents.find((d) => d.id === docId);
  if (!orig || orig.type !== 'sale') throw new Error('Vendita inesistente');
  const already = {};
  s.documents.filter((d) => d.type === 'refund' && d.refOf === docId)
    .forEach((d) => d.items.forEach((i) => { already[i.productId] = (already[i.productId] || 0) + i.qty; }));
  const items = [];
  for (const it of orig.items) {
    const want = lines ? (lines.find((l) => l.productId === it.productId) || { qty: 0 }).qty : it.qty - (already[it.productId] || 0);
    if (!(want > 0)) continue;
    if (want + (already[it.productId] || 0) > it.qty + 1e-9) throw new Error(`Reso eccede la quantità venduta: ${it.name}`);
    items.push({ ...it, qty: want });
  }
  if (!items.length) throw new Error('Niente da rendere');
  const totals = calcTotals(items, orig.discount);
  const doc = {
    id: 'd' + Date.now() + Math.random().toString(36).slice(2, 6), type: 'refund', number: nextNumber(s, 'refund'),
    date: new Date().toISOString(), customerId: orig.customerId, refOf: docId, items, discount: orig.discount,
    totals, payments: [], note: `Reso su ${orig.number}`,
  };
  applyStock(s, items, +1); s.documents.push(doc); return doc;
}

export function createPurchase(s, { items, supplier = '', note = '' }) {
  if (!items || !items.length) throw new Error('Nessun articolo');
  const snap = items.map((it) => {
    const p = s.products.find((x) => x.id === it.productId);
    if (!p) throw new Error('Prodotto inesistente');
    if (!(Number(it.qty) > 0)) throw new Error('Quantità non valida');
    return { productId: p.id, name: p.name, qty: Number(it.qty), price: p.price, cost: round2(it.cost ?? p.cost), taxRate: taxRate(s, p.taxId), discount: 0, unit: p.unit };
  });
  const total = round2(snap.reduce((a, i) => a + i.qty * i.cost, 0));
  for (const it of snap) { // il costo del prodotto segue l'ultimo acquisto
    const p = s.products.find((x) => x.id === it.productId); p.cost = it.cost;
  }
  const doc = {
    id: 'd' + Date.now() + Math.random().toString(36).slice(2, 6), type: 'purchase', number: nextNumber(s, 'purchase'),
    date: new Date().toISOString(), supplier, items: snap, totals: { total, subtotal: total, discountAmount: 0, net: total, tax: 0 }, payments: [], note,
  };
  applyStock(s, snap, +1); s.documents.push(doc); return doc;
}

// Rettifica inventario: imposta la giacenza reale, registra la differenza.
export function adjustStock(s, productId, newStock, note = 'Inventario') {
  const p = s.products.find((x) => x.id === productId);
  if (!p) throw new Error('Prodotto inesistente');
  const target = Number(newStock);
  if (!(target >= 0)) throw new Error('Giacenza non valida');
  const delta = Math.round((target - p.stock) * 1000) / 1000;
  if (delta === 0) return null;
  const doc = {
    id: 'd' + Date.now() + Math.random().toString(36).slice(2, 6), type: 'adjust', number: nextNumber(s, 'adjust'),
    date: new Date().toISOString(), items: [{ productId: p.id, name: p.name, qty: delta, price: p.price, cost: p.cost, taxRate: 0, discount: 0, unit: p.unit }],
    totals: { total: 0, subtotal: 0, discountAmount: 0, net: 0, tax: 0 }, payments: [], note,
  };
  p.stock = target; s.documents.push(doc); return doc;
}

// ---------- reportistica ----------
const inRange = (d, from, to) => (!from || d.date >= from) && (!to || d.date <= to);

export function salesReport(s, from, to) {
  const docs = s.documents.filter((d) => (d.type === 'sale' || d.type === 'refund') && inRange(d, from, to));
  const sign = (d) => (d.type === 'refund' ? -1 : 1);
  const byDay = {}, byProduct = {}, byPayment = {}, byGroup = {};
  let revenue = 0, tax = 0, cost = 0, count = 0;
  for (const d of docs) {
    const k = sign(d);
    revenue += k * d.totals.total; tax += k * d.totals.tax; if (d.type === 'sale') count++;
    const day = d.date.slice(0, 10);
    byDay[day] = round2((byDay[day] || 0) + k * d.totals.total);
    const f = 1 - (d.discount || 0) / 100;
    for (const it of d.items) {
      const line = calcLine(it).gross * f;
      cost += k * it.qty * it.cost;
      const row = byProduct[it.productId] || (byProduct[it.productId] = { name: it.name, qty: 0, revenue: 0 });
      row.qty += k * it.qty; row.revenue = round2(row.revenue + k * line);
      const p = s.products.find((x) => x.id === it.productId);
      const gname = (s.groups.find((g) => g.id === (p && p.groupId)) || { name: 'Senza gruppo' }).name;
      byGroup[gname] = round2((byGroup[gname] || 0) + k * line);
    }
    if (d.type === 'sale') {
      // il resto viene sottratto dal primo pagamento che lo consente (contanti)
      let change = d.change || 0;
      for (const pay of d.payments) {
        let amt = pay.amount;
        const t = s.paymentTypes.find((x) => x.id === pay.typeId);
        if (change > 0 && t && t.allowsChange) { const c = Math.min(change, amt); amt -= c; change -= c; }
        byPayment[pay.typeId] = round2((byPayment[pay.typeId] || 0) + amt);
      }
    }
  }
  revenue = round2(revenue); cost = round2(cost);
  return {
    revenue, tax: round2(tax), cost, profit: round2(revenue - tax - cost), count,
    average: count ? round2(revenue / count) : 0, byDay, byGroup,
    byProduct: Object.values(byProduct).sort((a, b) => b.revenue - a.revenue),
    byPayment,
  };
}

export function lowStock(s) {
  return s.products.filter((p) => p.active && p.trackStock && p.stock <= p.minStock);
}

export function stockValue(s) {
  const act = s.products.filter((p) => p.active && p.trackStock);
  return { cost: round2(act.reduce((a, p) => a + p.stock * p.cost, 0)), retail: round2(act.reduce((a, p) => a + p.stock * p.price, 0)) };
}

export function toCSV(rows) {
  const esc = (v) => { const t = String(v ?? ''); return /[",;\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  return rows.map((r) => r.map(esc).join(';')).join('\n');
}
