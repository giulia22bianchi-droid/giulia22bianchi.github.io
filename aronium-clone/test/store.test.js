import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/store.js';

const fresh = () => S.demoState();
const pid = (s, name) => s.products.find((p) => p.name === name).id;

test('calcolo IVA scorporata e sconto di riga', () => {
  const l = S.calcLine({ qty: 2, price: 12.2, discount: 0, taxRate: 22 });
  assert.equal(l.gross, 24.4); assert.equal(l.net, 20); assert.equal(l.tax, 4.4);
  assert.equal(S.calcLine({ qty: 1, price: 10, discount: 10, taxRate: 0 }).gross, 9);
});

test('totali con sconto documento', () => {
  const t = S.calcTotals([{ qty: 1, price: 100, discount: 0, taxRate: 22 }], 10);
  assert.equal(t.total, 90); assert.equal(t.discountAmount, 10); assert.equal(t.tax, 16.23);
});

test('vendita scala le scorte e calcola il resto', () => {
  const s = fresh(); const id = pid(s, 'Cola 33cl'); const before = s.products.find((p) => p.id === id).stock;
  const d = S.createSale(s, { items: [{ productId: id, qty: 3 }], payments: [{ typeId: 'cash', amount: 10 }] });
  assert.equal(d.totals.total, 5.4); assert.equal(d.change, 4.6); assert.equal(d.number, 'V-00001');
  assert.equal(s.products.find((p) => p.id === id).stock, before - 3);
});

test('rifiuta pagamento insufficiente, carrello vuoto e resto su carta', () => {
  const s = fresh(); const id = pid(s, 'Pane casereccio');
  assert.throws(() => S.createSale(s, { items: [], payments: [] }), /vuoto/);
  assert.throws(() => S.createSale(s, { items: [{ productId: id, qty: 2 }], payments: [{ typeId: 'cash', amount: 1 }] }), /insufficiente/);
  assert.throws(() => S.createSale(s, { items: [{ productId: id, qty: 1 }], payments: [{ typeId: 'card', amount: 10 }] }), /Resto/);
  assert.equal(s.documents.length, 0);
});

test('pagamento misto contanti + carta', () => {
  const s = fresh(); const id = pid(s, 'Olio EVO 1L');
  const d = S.createSale(s, { items: [{ productId: id, qty: 2 }], payments: [{ typeId: 'card', amount: 10 }, { typeId: 'cash', amount: 10 }] });
  assert.equal(d.totals.total, 17.8); assert.equal(d.change, 2.2);
  const r = S.salesReport(s);
  assert.equal(r.byPayment.card, 10); assert.equal(r.byPayment.cash, 7.8);
});

test('blocco scorte quando allowNegative = false', () => {
  const s = fresh(); const id = pid(s, 'Biscotti');
  assert.throws(() => S.createSale(s, { items: [{ productId: id, qty: 10 }], payments: [{ typeId: 'cash', amount: 100 }], allowNegative: false }), /Scorte/);
});

test('reso ripristina scorte e non supera il venduto', () => {
  const s = fresh(); const id = pid(s, 'Pasta 500g'); const st = s.products.find((p) => p.id === id).stock;
  const sale = S.createSale(s, { items: [{ productId: id, qty: 4 }], payments: [{ typeId: 'cash', amount: 20 }] });
  S.refundSale(s, sale.id, [{ productId: id, qty: 3 }]);
  assert.equal(s.products.find((p) => p.id === id).stock, st - 1);
  assert.throws(() => S.refundSale(s, sale.id, [{ productId: id, qty: 2 }]), /eccede/);
  S.refundSale(s, sale.id); // il resto
  assert.equal(s.products.find((p) => p.id === id).stock, st);
  assert.throws(() => S.refundSale(s, sale.id), /Niente/);
  assert.equal(S.salesReport(s).revenue, 0);
});

test('acquisto carica magazzino e aggiorna il costo; inventario rettifica', () => {
  const s = fresh(); const id = pid(s, 'Biscotti'); const st = s.products.find((p) => p.id === id).stock;
  S.createPurchase(s, { items: [{ productId: id, qty: 10, cost: 1.5 }] });
  const p = s.products.find((x) => x.id === id);
  assert.equal(p.stock, st + 10); assert.equal(p.cost, 1.5);
  const adj = S.adjustStock(s, id, 8); assert.equal(adj.items[0].qty, 8 - (st + 10)); assert.equal(p.stock, 8);
  assert.equal(S.adjustStock(s, id, 8), null);
});

test('prodotti: barcode univoco, archiviazione se usato', () => {
  const s = fresh();
  assert.throws(() => S.addProduct(s, { name: 'X', price: 1, barcode: '8000000000011' }), /Barcode/);
  assert.throws(() => S.addProduct(s, { name: ' ', price: 1 }), /obbligatorio/);
  const id = pid(s, 'Cornetto');
  S.createSale(s, { items: [{ productId: id, qty: 1 }], payments: [{ typeId: 'cash', amount: 2 }] });
  assert.equal(S.deleteProduct(s, id), 'archived');
  const n = S.addProduct(s, { name: 'Nuovo', price: 1 });
  assert.equal(S.deleteProduct(s, n.id), 'deleted');
});

test('report vendite, scorte basse e valore magazzino', () => {
  const s = fresh();
  S.createSale(s, { items: [{ productId: pid(s, 'Cola 33cl'), qty: 2 }, { productId: pid(s, 'Biscotti'), qty: 1 }], payments: [{ typeId: 'cash', amount: 6 }] });
  const r = S.salesReport(s);
  assert.equal(r.revenue, 5.8); assert.equal(r.count, 1); assert.equal(r.byProduct[0].name, 'Cola 33cl');
  assert.ok(S.lowStock(s).some((p) => p.name === 'Biscotti'));
  assert.ok(S.stockValue(s).retail > S.stockValue(s).cost);
});

test('persistenza, export/import e CSV', () => {
  const mem = new Map(); const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const a = S.createStore(storage); S.addGroup(a.state, 'Nuovo'); a.save();
  assert.ok(S.createStore(storage).state.groups.some((g) => g.name === 'Nuovo'));
  const b = S.createStore(null); b.importJSON(a.exportJSON()); assert.equal(b.state.products.length, a.state.products.length);
  assert.throws(() => b.importJSON('{"x":1}'), /non valido/);
  assert.equal(S.toCSV([['a;b', 'c"d', 1]]), '"a;b";"c""d";1');
});

test('utenti iniziali e migrazione di dati vecchi senza users', () => {
  const mem = new Map(); const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const old = S.demoState(); delete old.users; mem.set('aronium-clone-v2', JSON.stringify(old));
  const st = S.createStore(storage).state;
  assert.ok(st.users.some((u) => u.role === 'admin'));
  const d = S.createSale(st, { items: [{ productId: st.products[0].id, qty: 1 }], payments: [{ typeId: 'cash', amount: 5 }], userId: 'u1', service: 'Dine-in' });
  assert.equal(d.userId, 'u1');
});
