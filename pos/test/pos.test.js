import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pos-test-'));
process.env.POS_DB_PATH = join(dir, 'pos.db');
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

let base;
let server;
let token;
let cashierToken;

async function api(method, path, body, tk = token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

before(async () => {
  const { app } = await import('../server/index.js');
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  token = (await api('POST', '/api/login', { username: 'admin', password: 'admin' }, null)).body.token;
  const roles = (await api('GET', '/api/roles')).body;
  const cashier = roles.find((r) => r.name === 'Cassiere');
  await api('POST', '/api/users', { username: 'anna', name: 'Anna', role_id: cashier.id, password: 'segreta' });
  cashierToken = (await api('POST', '/api/login', { username: 'anna', password: 'segreta' }, null)).body.token;
});

after(() => {
  server?.closeAllConnections?.();
  server?.close();
});

describe('accesso', () => {
  test('senza token le API rifiutano', async () => {
    assert.equal((await api('GET', '/api/products', null, null)).status, 401);
  });
  test('password errata', async () => {
    assert.equal((await api('POST', '/api/login', { username: 'admin', password: 'x' }, null)).status, 401);
  });
  test('il cassiere non vede gli utenti né i report', async () => {
    assert.equal((await api('GET', '/api/users', null, cashierToken)).status, 403);
    assert.equal((await api('GET', '/api/reports/summary', null, cashierToken)).status, 403);
  });
});

describe('vendite', () => {
  let product;
  let cash;
  let card;

  before(async () => {
    const taxes = (await api('GET', '/api/taxes')).body;
    const t22 = taxes.find((t) => t.rate === 22);
    product = (await api('POST', '/api/products', { name: 'Cavo USB', code: 'CAV1', barcode: '8000001', price: 12.2, cost: 5, tax_id: t22.id, stock: 10, extra_barcodes: ['999'] })).body;
    const pts = (await api('GET', '/api/payment-types')).body;
    cash = pts.find((p) => p.is_cash);
    card = pts.find((p) => p.name === 'Carta');
  });

  test('si trova il prodotto da codice a barre, anche aggiuntivo', async () => {
    assert.equal((await api('GET', '/api/products/lookup/8000001')).body.id, product.id);
    assert.equal((await api('GET', '/api/products/lookup/999')).body.id, product.id);
    assert.equal((await api('GET', '/api/products/lookup/nope')).status, 404);
  });

  test('senza turno aperto non si vende', async () => {
    const r = await api('POST', '/api/documents', { type: 'sale', items: [{ product_id: product.id, qty: 1 }], payments: [{ payment_type_id: cash.id, amount: 20 }] });
    assert.equal(r.status, 409);
  });

  test('vendita con resto, IVA scorporata e magazzino scalato', async () => {
    assert.equal((await api('POST', '/api/shifts/open', { opening_cash: 100 })).status, 201);
    const r = await api('POST', '/api/documents', {
      type: 'sale', items: [{ product_id: product.id, qty: 2 }], payments: [{ payment_type_id: cash.id, amount: 30 }],
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.total, 24.4);
    assert.equal(r.body.tax_total, 4.4);
    assert.equal(r.body.change_given, 5.6);
    assert.equal(r.body.payments[0].amount, 24.4);
    assert.match(r.body.number, /^S\d{6}$/);
    assert.equal((await api('GET', `/api/products/${product.id}`)).body.stock, 8);
  });

  test('sconto documento in percentuale e importo', async () => {
    const pct = await api('POST', '/api/documents', {
      type: 'sale', items: [{ product_id: product.id, qty: 1 }], discount: { type: 'pct', value: 10 }, payments: [{ payment_type_id: card.id, amount: 10.98 }],
    });
    assert.equal(pct.body.total, 10.98);
    const amount = await api('POST', '/api/documents', {
      type: 'sale', items: [{ product_id: product.id, qty: 1 }], discount: { type: 'amount', value: 2.2 }, payments: [{ payment_type_id: card.id, amount: 10 }],
    });
    assert.equal(amount.body.total, 10);
    assert.equal(amount.body.discount_total, 2.2);
  });

  test('pagamento insufficiente e resto su carta sono rifiutati', async () => {
    const lowPay = await api('POST', '/api/documents', { type: 'sale', items: [{ product_id: product.id, qty: 1 }], payments: [{ payment_type_id: cash.id, amount: 5 }] });
    assert.equal(lowPay.status, 400);
    const cardChange = await api('POST', '/api/documents', { type: 'sale', items: [{ product_id: product.id, qty: 1 }], payments: [{ payment_type_id: card.id, amount: 50 }] });
    assert.equal(cardChange.status, 400);
  });

  test('giacenza insufficiente', async () => {
    const r = await api('POST', '/api/documents', { type: 'sale', items: [{ product_id: product.id, qty: 500 }], payments: [{ payment_type_id: cash.id, amount: 99999 }] });
    assert.equal(r.status, 409);
  });

  test('il cassiere non può cambiare prezzo', async () => {
    await api('POST', '/api/shifts/open', { opening_cash: 0 }, cashierToken);
    const r = await api('POST', '/api/documents', { type: 'sale', items: [{ product_id: product.id, qty: 1, price: 1 }], payments: [{ payment_type_id: cash.id, amount: 1 }] }, cashierToken);
    assert.equal(r.status, 403);
  });

  test('in sospeso, ripresa e completamento', async () => {
    const held = await api('POST', '/api/documents', { type: 'sale', hold: true, items: [{ product_id: product.id, qty: 1 }] });
    assert.equal(held.body.status, 'held');
    assert.equal(held.body.number, null);
    const stockBefore = (await api('GET', `/api/products/${product.id}`)).body.stock;
    const done = await api('POST', '/api/documents', {
      id: held.body.id, type: 'sale', items: [{ product_id: product.id, qty: 3 }], payments: [{ payment_type_id: cash.id, amount: 40 }],
    });
    assert.equal(done.body.id, held.body.id);
    assert.equal(done.body.status, 'completed');
    assert.equal((await api('GET', `/api/products/${product.id}`)).body.stock, stockBefore - 3);
  });

  test('reso parziale rimette a magazzino e non supera il venduto', async () => {
    const sale = (await api('POST', '/api/documents', { type: 'sale', items: [{ product_id: product.id, qty: 2 }], payments: [{ payment_type_id: cash.id, amount: 24.4 }] })).body;
    const stock = (await api('GET', `/api/products/${product.id}`)).body.stock;
    const refund = await api('POST', '/api/documents', { type: 'refund', ref_id: sale.id, items: [{ product_id: product.id, qty: 1 }] });
    assert.equal(refund.status, 201);
    assert.equal(refund.body.total, 12.2);
    assert.equal((await api('GET', `/api/products/${product.id}`)).body.stock, stock + 1);
    const tooMuch = await api('POST', '/api/documents', { type: 'refund', ref_id: sale.id, items: [{ product_id: product.id, qty: 2 }] });
    assert.equal(tooMuch.status, 400);
    // Con un reso attivo la vendita non è annullabile
    assert.equal((await api('POST', `/api/documents/${sale.id}/void`)).status, 409);
  });

  test('annullamento ripristina la giacenza', async () => {
    const sale = (await api('POST', '/api/documents', { type: 'sale', items: [{ product_id: product.id, qty: 1 }], payments: [{ payment_type_id: cash.id, amount: 12.2 }] })).body;
    const before = (await api('GET', `/api/products/${product.id}`)).body.stock;
    const v = await api('POST', `/api/documents/${sale.id}/void`);
    assert.equal(v.body.status, 'void');
    assert.equal((await api('GET', `/api/products/${product.id}`)).body.stock, before + 1);
  });

  test('chiusura turno: contante atteso e riepilogo', async () => {
    await api('POST', '/api/shifts/cash-movement', { type: 'out', amount: 10, reason: 'Pulizie' });
    const report = (await api('GET', '/api/shifts/current')).body;
    assert.equal(report.cash_out, 10);
    const closed = await api('POST', '/api/shifts/close', { counted_cash: report.expected_cash });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.shift.counted_cash, report.expected_cash);
    assert.equal((await api('GET', '/api/shifts/current')).body, null);
  });

  test('i report quadrano con le vendite', async () => {
    const s = (await api('GET', '/api/reports/summary')).body;
    assert.ok(s.documents >= 5);
    assert.equal(s.net, Math.round((s.gross - s.refunded) * 100) / 100);
    assert.ok(s.profit > 0);
    const products = (await api('GET', '/api/reports/products')).body;
    assert.equal(products[0].name, 'Cavo USB');
  });
});

describe('acquisti, fatture e inventario', () => {
  test('acquisto aumenta giacenza e aggiorna costo; fattura con incasso successivo', async () => {
    const supplier = (await api('POST', '/api/suppliers', { name: 'Fornitore SPA' })).body;
    const customer = (await api('POST', '/api/customers', { name: 'Mario Rossi', tax_number: 'RSSMRA80A01H501U', discount_pct: 5 })).body;
    const p = (await api('POST', '/api/products', { name: 'Penna', price: 1.22, cost: 0.5, stock: 0 })).body;
    const purchase = await api('POST', '/api/documents', { type: 'purchase', partner_id: supplier.id, items: [{ product_id: p.id, qty: 100, price: 0.4 }] });
    assert.equal(purchase.status, 201);
    const after = (await api('GET', `/api/products/${p.id}`)).body;
    assert.equal(after.stock, 100);
    assert.equal(after.cost, 0.4);

    const noCustomer = await api('POST', '/api/documents', { type: 'invoice', items: [{ product_id: p.id, qty: 1 }] });
    assert.equal(noCustomer.status, 400);
    await api('POST', '/api/shifts/open', { opening_cash: 0 });
    const inv = (await api('POST', '/api/documents', { type: 'invoice', partner_id: customer.id, items: [{ product_id: p.id, qty: 10 }] })).body;
    assert.equal(inv.paid, 0);
    const list = (await api('GET', '/api/customers')).body;
    assert.equal(list.find((c) => c.id === customer.id).balance, inv.total);
    const cash = (await api('GET', '/api/payment-types')).body.find((x) => x.is_cash);
    const paid = await api('POST', `/api/documents/${inv.id}/payments`, { payments: [{ payment_type_id: cash.id, amount: inv.total }] });
    assert.equal(paid.body.paid, inv.total);
    assert.equal((await api('POST', `/api/documents/${inv.id}/payments`, { payments: [{ payment_type_id: cash.id, amount: 1 }] })).status, 400);
  });

  test('conta fisica registra solo le differenze', async () => {
    const p = (await api('POST', '/api/products', { name: 'Quaderno', price: 2, stock: 5 })).body;
    const r = await api('POST', '/api/stock/count', { counts: [{ product_id: p.id, counted: 3 }] });
    assert.equal(r.body.changed, 1);
    assert.equal((await api('GET', `/api/products/${p.id}`)).body.stock, 3);
    assert.equal((await api('POST', '/api/stock/count', { counts: [{ product_id: p.id, counted: 3 }] })).body.changed, 0);
  });

  test('importazione prodotti crea gruppi e aggiorna per codice', async () => {
    const rows = [{ name: 'A', code: 'IMP1', price: '3,5'.replace(',', '.'), group: 'Bibite', tax_rate: 10 }, { name: 'B', code: 'IMP2', price: 1 }];
    const first = (await api('POST', '/api/products/import', { rows })).body;
    assert.equal(first.created, 2);
    const second = (await api('POST', '/api/products/import', { rows })).body;
    assert.equal(second.updated, 2);
    assert.ok((await api('GET', '/api/groups')).body.some((g) => g.name === 'Bibite'));
  });

  test('non si può togliere il ruolo all\'ultimo amministratore', async () => {
    const users = (await api('GET', '/api/users')).body;
    const admin = users.find((u) => u.username === 'admin');
    const cashierRole = (await api('GET', '/api/roles')).body.find((r) => r.name === 'Cassiere');
    const r = await api('PUT', `/api/users/${admin.id}`, { name: 'Admin', role_id: cashierRole.id, active: true });
    assert.equal(r.status, 400);
  });

  test('backup restituisce un file SQLite', async () => {
    const res = await fetch(`${base}/api/backup`, { headers: { Authorization: `Bearer ${token}` } });
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(0, 15).toString(), 'SQLite format 3');
  });
});
