import * as S from './store.js';
import { h, toast, modal, confirmBox, download } from './ui.js';

let storage = null;
try { storage = window.localStorage; storage.getItem('x'); } catch { storage = null; }
const store = S.createStore(storage);
const st = () => store.state;

const money = (n) => {
  const cur = st().settings.currency || '€';
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0) + ' ' + cur;
};
const qtyFmt = (n) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 3 }).format(n);
const dt = (iso) => new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
const dayKey = (d) => d.toISOString().slice(0, 10);
const typeLabel = { sale: 'Vendita', refund: 'Reso', purchase: 'Acquisto', adjust: 'Rettifica' };
const byId = (arr, id) => arr.find((x) => x.id === id);
const num = (v) => Number(String(v).replace(',', '.'));
const guard = (fn) => { try { fn(); } catch (e) { toast(e.message); } };

// ---------------- routing ----------------
const routes = {
  cassa: ['Cassa', posView], prodotti: ['Prodotti', productsView], magazzino: ['Magazzino', stockView],
  documenti: ['Documenti', documentsView], clienti: ['Clienti', customersView],
  report: ['Report', reportsView], impostazioni: ['Impostazioni', settingsView],
};
let current = 'cassa';
function go(name) { current = routes[name] ? name : 'cassa'; location.hash = current; render(); }
function render() {
  const nav = document.getElementById('nav'); nav.replaceChildren(h('div', { class: 'brand' }, 'Aronium Clone'));
  for (const [k, [label]] of Object.entries(routes)) nav.append(h('a', { class: k === current ? 'on' : '', onclick: () => go(k) }, label));
  const view = document.getElementById('view'); view.replaceChildren(routes[current][1]());
}
window.addEventListener('hashchange', () => { const n = location.hash.slice(1); if (routes[n] && n !== current) { current = n; render(); } });

// ---------------- cassa ----------------
const cart = { lines: [], discount: 0, customerId: '' };
let posGroup = '', posSearch = '';

function cartItems() { return cart.lines.map((l) => ({ ...l, price: l.price ?? byId(st().products, l.productId).price, taxRate: S.taxRate(st(), byId(st().products, l.productId).taxId) })); }

function addToCart(p, q = 1) {
  const l = cart.lines.find((x) => x.productId === p.id);
  if (l) l.qty = Math.round((l.qty + q) * 1000) / 1000; else cart.lines.push({ productId: p.id, qty: q, discount: 0 });
  render(); refocusScan();
}
function refocusScan() { const i = document.getElementById('scan'); if (i) i.focus(); }

function posView() {
  const s = st();
  const prods = s.products.filter((p) => p.active && (!posGroup || p.groupId === posGroup)
    && (!posSearch || (p.name + ' ' + p.barcode + ' ' + p.code).toLowerCase().includes(posSearch.toLowerCase())));
  const items = cartItems();
  const t = S.calcTotals(items, cart.discount);

  const scan = h('input', {
    id: 'scan', class: 'grow', placeholder: 'Cerca o scansiona codice a barre + Invio', value: posSearch, autocomplete: 'off',
    oninput: (e) => { posSearch = e.target.value; const pos = e.target.selectionStart; render(); const i = document.getElementById('scan'); i.focus(); i.setSelectionRange(pos, pos); },
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      const v = e.target.value.trim(); if (!v) return;
      const exact = s.products.find((p) => p.active && (p.barcode === v || p.code === v));
      const only = prods.length === 1 ? prods[0] : null;
      const hit = exact || only;
      if (hit) { posSearch = ''; addToCart(hit); } else toast('Prodotto non trovato');
    },
  });

  const left = h('div', { class: 'left' },
    h('div', { class: 'bar' }, scan),
    h('div', { class: 'groups' },
      h('button', { class: posGroup ? '' : 'on', onclick: () => { posGroup = ''; render(); } }, 'Tutti'),
      s.groups.map((g) => h('button', { class: posGroup === g.id ? 'on' : '', onclick: () => { posGroup = g.id; render(); } }, g.name))),
    prods.length ? h('div', { class: 'tiles' }, prods.map((p) =>
      h('button', { class: 'tile', onclick: () => addToCart(p) },
        h('b', null, p.name), h('span', { class: 'p' }, money(p.price)),
        p.trackStock ? h('small', null, `Giac. ${qtyFmt(p.stock)}`) : null)))
      : h('div', { class: 'empty' }, 'Nessun prodotto. Aggiungine dalla sezione Prodotti.'));

  const lines = cart.lines.length ? cart.lines.map((l, i) => {
    const it = items[i], p = byId(s.products, l.productId), c = S.calcLine(it);
    return h('div', { class: 'line' },
      h('div', null, h('b', null, p.name), h('div', { class: 'muted' }, `${money(it.price)}${l.discount ? ` −${l.discount}%` : ''}`)),
      h('div', { class: 'n' }, money(c.gross)),
      h('div', { class: 'q' },
        h('button', { 'aria-label': 'Diminuisci', onclick: () => { l.qty = Math.max(0, Math.round((l.qty - 1) * 1000) / 1000); if (l.qty <= 0) cart.lines.splice(i, 1); render(); } }, '−'),
        h('input', { value: l.qty, inputmode: 'decimal', 'aria-label': 'Quantità', onchange: (e) => { const v = num(e.target.value); if (v > 0) l.qty = v; else cart.lines.splice(i, 1); render(); } }),
        h('button', { 'aria-label': 'Aumenta', onclick: () => { l.qty += 1; render(); } }, '+'),
        h('button', { title: 'Sconto riga %', onclick: () => askNumber('Sconto riga (%)', l.discount, (v) => { l.discount = Math.min(100, Math.max(0, v)); render(); }) }, '%')),
      h('div', { class: 'n' }, h('button', { class: 'danger', 'aria-label': 'Rimuovi', onclick: () => { cart.lines.splice(i, 1); render(); } }, '✕')));
  }) : [h('div', { class: 'empty' }, 'Carrello vuoto')];

  const right = h('div', { class: 'card cart' },
    h('div', { class: 'bar' },
      h('select', { class: 'grow', 'aria-label': 'Cliente', onchange: (e) => { cart.customerId = e.target.value; } },
        h('option', { value: '' }, 'Cliente generico'),
        s.customers.map((c) => h('option', { value: c.id, selected: c.id === cart.customerId }, c.name))),
      h('button', { onclick: holdCart, disabled: !cart.lines.length }, 'Sospendi'),
      h('button', { onclick: showHeld, disabled: !s.held.length }, `Sospesi (${s.held.length})`)),
    h('div', { class: 'lines' }, lines),
    h('div', { class: 'sums' },
      h('span', null, 'Imponibile'), h('span', null, money(t.net)),
      h('span', null, 'IVA'), h('span', null, money(t.tax)),
      h('span', null, 'Sconto documento'), h('span', null, t.discountAmount ? '−' + money(t.discountAmount) : money(0))),
    h('div', { class: 'total', 'aria-live': 'polite' }, money(t.total)),
    h('div', { class: 'pay-btns' },
      h('button', { onclick: () => askNumber('Sconto documento (%)', cart.discount, (v) => { cart.discount = Math.min(100, Math.max(0, v)); render(); }), disabled: !cart.lines.length }, 'Sconto %'),
      h('button', { class: 'danger', onclick: () => { clearCart(); render(); }, disabled: !cart.lines.length }, 'Svuota'),
      h('button', { class: 'ok', style: 'grid-column:1/-1', onclick: () => payDialog(t), disabled: !cart.lines.length || t.total < 0 }, 'Paga')));

  return h('div', { class: 'pos' }, left, right);
}

function clearCart() { cart.lines = []; cart.discount = 0; cart.customerId = ''; }
function holdCart() { st().held.push({ id: 'h' + Date.now(), at: new Date().toISOString(), cart: JSON.parse(JSON.stringify(cart)) }); clearCart(); store.save(); render(); toast('Ordine sospeso'); }
function showHeld() {
  modal('Ordini sospesi', (close) => ({
    body: h('div', null, st().held.map((o) => h('div', { class: 'bar' },
      h('span', { class: 'grow' }, `${dt(o.at)} — ${o.cart.lines.length} righe`),
      h('button', { onclick: () => { Object.assign(cart, o.cart); st().held = st().held.filter((x) => x.id !== o.id); store.save(); close(); render(); } }, 'Riprendi'),
      h('button', { class: 'danger', onclick: () => { st().held = st().held.filter((x) => x.id !== o.id); store.save(); close(); render(); } }, 'Elimina')))),
    buttons: [h('button', { onclick: close }, 'Chiudi')],
  }));
}

function askNumber(title, initial, onOk) {
  modal(title, (close) => {
    const inp = h('input', { value: initial || '', inputmode: 'decimal' });
    const ok = () => { const v = num(inp.value || 0); if (Number.isNaN(v) || v < 0) return toast('Valore non valido'); close(); onOk(v); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    return { body: inp, buttons: [h('button', { onclick: close }, 'Annulla'), h('button', { class: 'primary', onclick: ok }, 'OK')] };
  });
}

function payDialog(totals) {
  const s = st();
  modal('Pagamento', (close) => {
    const inputs = {};
    const status = h('div', { class: 'total' });
    const err = h('div', { class: 'err' });
    const upd = () => {
      const paid = S.round2(Object.values(inputs).reduce((a, i) => a + (num(i.value || 0) || 0), 0));
      const diff = S.round2(paid - totals.total);
      status.textContent = diff >= 0 ? `Resto ${money(diff)}` : `Mancano ${money(-diff)}`;
      status.style.color = diff >= 0 ? 'var(--ok)' : 'var(--bad)';
    };
    const rows = s.paymentTypes.map((t, i) => {
      const inp = h('input', { inputmode: 'decimal', value: i === 0 ? totals.total.toFixed(2) : '', oninput: upd });
      inputs[t.id] = inp;
      return [h('label', null, t.name), h('div', { class: 'bar' }, inp, h('button', { onclick: () => { inp.value = S.round2(Math.max(0, totals.total - otherPaid(inputs, t.id))).toFixed(2); upd(); } }, 'Importo esatto'))];
    });
    upd();
    const confirm = () => {
      const payments = Object.entries(inputs).map(([typeId, i]) => ({ typeId, amount: num(i.value || 0) || 0 })).filter((p) => p.amount > 0);
      try {
        const doc = S.createSale(s, { items: cartItems(), customerId: cart.customerId, discount: cart.discount, payments });
        store.save(); clearCart(); close(); printReceipt(doc); toast(`Vendita ${doc.number} registrata`); render();
      } catch (e) { err.textContent = e.message; }
    };
    return {
      body: h('div', null, h('div', { class: 'total' }, money(totals.total)), h('div', { class: 'form' }, rows), status, err),
      buttons: [h('button', { onclick: close }, 'Annulla'), h('button', { class: 'ok', onclick: confirm }, 'Conferma e stampa')],
    };
  });
}
const otherPaid = (inputs, skip) => Object.entries(inputs).filter(([k]) => k !== skip).reduce((a, [, i]) => a + (num(i.value || 0) || 0), 0);

function printReceipt(doc) {
  const s = st(), set = s.settings, cust = byId(s.customers, doc.customerId);
  const r = document.getElementById('receipt');
  const row = (a, b) => h('div', { class: 'r' }, h('span', null, a), h('span', null, b));
  r.replaceChildren(h('div', null,
    h('h4', null, set.company), set.address ? h('div', { class: 'c' }, set.address) : null, set.taxId ? h('div', { class: 'c' }, 'P.IVA ' + set.taxId) : null,
    h('hr'), row(typeLabel[doc.type] + ' ' + doc.number, dt(doc.date)), cust ? h('div', null, 'Cliente: ' + cust.name) : null, h('hr'),
    doc.items.map((i) => [h('div', null, i.name), row(`${qtyFmt(i.qty)} x ${money(i.price)}${i.discount ? ` -${i.discount}%` : ''}`, money(S.calcLine(i).gross))]),
    h('hr'), doc.discount ? row('Sconto', doc.discount + '%') : null, row('TOTALE', money(doc.totals.total)), row('di cui IVA', money(doc.totals.tax)),
    doc.payments.map((p) => row((byId(s.paymentTypes, p.typeId) || {}).name || p.typeId, money(p.amount))),
    doc.change ? row('Resto', money(doc.change)) : null, h('hr'), h('div', { class: 'c' }, set.receiptFooter)));
  setTimeout(() => window.print(), 50);
}

// ---------------- prodotti ----------------
let prodFilter = '';
function productsView() {
  const s = st();
  const list = s.products.filter((p) => !prodFilter || (p.name + p.barcode + p.code).toLowerCase().includes(prodFilter.toLowerCase()));
  return h('div', null, h('h1', null, 'Prodotti'),
    h('div', { class: 'bar' },
      h('input', { class: 'grow', placeholder: 'Filtra per nome, codice o barcode', value: prodFilter, oninput: (e) => { prodFilter = e.target.value; const p = e.target.selectionStart; render(); const i = document.querySelector('#view input'); i.focus(); i.setSelectionRange(p, p); } }),
      h('button', { onclick: () => download('prodotti.csv', S.toCSV([['Codice', 'Nome', 'Barcode', 'Gruppo', 'Prezzo', 'Costo', 'Giacenza'], ...s.products.map((p) => [p.code, p.name, p.barcode, (byId(s.groups, p.groupId) || {}).name || '', p.price, p.cost, p.stock])]), 'text/csv') }, 'Esporta CSV'),
      h('button', { class: 'primary', onclick: () => productDialog() }, '+ Nuovo prodotto')),
    list.length ? h('table', null,
      h('thead', null, h('tr', null, ['Codice', 'Nome', 'Gruppo', 'IVA', 'Prezzo', 'Costo', 'Giacenza', ''].map((x, i) => h('th', { class: i >= 4 && i < 7 ? 'n' : '' }, x)))),
      h('tbody', null, list.map((p) => h('tr', null,
        h('td', null, p.code), h('td', null, p.name, ' ', p.active ? null : h('span', { class: 'tag' }, 'archiviato')),
        h('td', null, (byId(s.groups, p.groupId) || {}).name || '—'), h('td', null, S.taxRate(s, p.taxId) + '%'),
        h('td', { class: 'n' }, money(p.price)), h('td', { class: 'n' }, money(p.cost)),
        h('td', { class: 'n' }, p.trackStock ? h('span', { class: 'tag ' + (p.stock <= 0 ? 'bad' : p.stock <= p.minStock ? 'warn' : '') }, qtyFmt(p.stock)) : '—'),
        h('td', { class: 'n' }, h('button', { onclick: () => productDialog(p) }, 'Modifica'), ' ',
          h('button', { class: 'danger', onclick: () => confirmBox(`Eliminare "${p.name}"? Se ha movimenti verrà solo archiviato.`, () => { const r = S.deleteProduct(s, p.id); store.save(); toast(r === 'archived' ? 'Prodotto archiviato' : 'Prodotto eliminato'); render(); }, 'Elimina') }, '✕'))))))
      : h('div', { class: 'empty' }, 'Nessun prodotto trovato'));
}

function productDialog(p) {
  const s = st(), isNew = !p;
  modal(isNew ? 'Nuovo prodotto' : 'Modifica prodotto', (close) => {
    const f = {
      name: h('input', { value: p?.name || '' }), barcode: h('input', { value: p?.barcode || '' }),
      groupId: h('select', null, h('option', { value: '' }, '— nessuno —'), s.groups.map((g) => h('option', { value: g.id, selected: g.id === p?.groupId }, g.name))),
      taxId: h('select', null, s.taxes.map((t) => h('option', { value: t.id, selected: t.id === (p?.taxId || 't22') }, t.name))),
      price: h('input', { value: p?.price ?? '', inputmode: 'decimal' }), cost: h('input', { value: p?.cost ?? '', inputmode: 'decimal' }),
      stock: h('input', { value: p?.stock ?? 0, inputmode: 'decimal', disabled: !isNew }), minStock: h('input', { value: p?.minStock ?? s.settings.lowStockDefault, inputmode: 'decimal' }),
      unit: h('input', { value: p?.unit || 'pz' }), trackStock: h('input', { type: 'checkbox', checked: p ? p.trackStock : true }),
      active: h('input', { type: 'checkbox', checked: p ? p.active : true }),
    };
    const err = h('div', { class: 'err' });
    const L = (t, el) => [h('label', null, t), el];
    const save = () => {
      try {
        const d = { name: f.name.value, barcode: f.barcode.value.trim(), groupId: f.groupId.value, taxId: f.taxId.value, price: num(f.price.value), cost: num(f.cost.value || 0), minStock: num(f.minStock.value || 0), unit: f.unit.value || 'pz', trackStock: f.trackStock.checked, active: f.active.checked };
        if (Number.isNaN(d.price) || Number.isNaN(d.cost)) throw new Error('Prezzo o costo non valido');
        if (isNew) S.addProduct(s, { ...d, stock: num(f.stock.value || 0) }); else S.updateProduct(s, p.id, d);
        store.save(); close(); render();
      } catch (e) { err.textContent = e.message; }
    };
    return {
      body: h('div', null, h('div', { class: 'form' }, L('Nome', f.name), L('Barcode', f.barcode), L('Gruppo', f.groupId), L('IVA', f.taxId),
        L('Prezzo (IVA incl.)', f.price), L('Costo', f.cost), L(isNew ? 'Giacenza iniziale' : 'Giacenza (da Magazzino)', f.stock), L('Scorta minima', f.minStock),
        L('Unità', f.unit), L('Gestisci scorte', f.trackStock), L('Attivo', f.active)), err),
      buttons: [h('button', { onclick: close }, 'Annulla'), h('button', { class: 'primary', onclick: save }, 'Salva')],
    };
  });
}

// ---------------- magazzino ----------------
function stockView() {
  const s = st(), low = S.lowStock(s), val = S.stockValue(s);
  return h('div', null, h('h1', null, 'Magazzino'),
    h('div', { class: 'grid kpis' },
      kpi('Valore a costo', money(val.cost)), kpi('Valore a prezzo', money(val.retail)), kpi('Sotto scorta', String(low.length))),
    h('div', { class: 'bar', style: 'margin-top:12px' }, h('div', { class: 'grow' }),
      h('button', { class: 'primary', onclick: purchaseDialog }, '+ Carico merce (acquisto)')),
    h('table', null, h('thead', null, h('tr', null, ['Prodotto', 'Giacenza', 'Minima', 'Valore costo', ''].map((x, i) => h('th', { class: i && i < 4 ? 'n' : '' }, x)))),
      h('tbody', null, s.products.filter((p) => p.active && p.trackStock).map((p) => h('tr', null,
        h('td', null, p.name), h('td', { class: 'n' }, h('span', { class: 'tag ' + (p.stock <= 0 ? 'bad' : p.stock <= p.minStock ? 'warn' : 'ok') }, qtyFmt(p.stock))),
        h('td', { class: 'n' }, qtyFmt(p.minStock)), h('td', { class: 'n' }, money(p.stock * p.cost)),
        h('td', { class: 'n' }, h('button', { onclick: () => askNumber(`Giacenza reale di "${p.name}"`, p.stock, (v) => { guard(() => { const d = S.adjustStock(s, p.id, v); store.save(); toast(d ? `Rettifica ${d.number}` : 'Nessuna differenza'); render(); }); }) }, 'Inventario')))))));
}

function purchaseDialog() {
  const s = st(), rows = [];
  modal('Carico merce', (close) => {
    const supplier = h('input', { placeholder: 'Fornitore (facoltativo)' });
    const list = h('div');
    const err = h('div', { class: 'err' });
    const addRow = () => {
      const sel = h('select', null, s.products.filter((p) => p.active).map((p) => h('option', { value: p.id }, p.name)));
      const qty = h('input', { placeholder: 'Qtà', inputmode: 'decimal', style: 'width:80px' });
      const cost = h('input', { placeholder: 'Costo unit.', inputmode: 'decimal', style: 'width:100px' });
      sel.addEventListener('change', () => { cost.value = byId(s.products, sel.value).cost; });
      cost.value = byId(s.products, sel.value)?.cost ?? '';
      const row = { sel, qty, cost };
      rows.push(row);
      list.append(h('div', { class: 'bar' }, sel, qty, cost));
    };
    addRow();
    const save = () => {
      try {
        const items = rows.filter((r) => r.qty.value).map((r) => ({ productId: r.sel.value, qty: num(r.qty.value), cost: num(r.cost.value || 0) }));
        const d = S.createPurchase(s, { items, supplier: supplier.value }); store.save(); close(); toast(`Carico ${d.number} registrato`); render();
      } catch (e) { err.textContent = e.message; }
    };
    return { body: h('div', null, supplier, h('div', { style: 'height:8px' }), list, h('button', { onclick: addRow }, '+ Riga'), err),
      buttons: [h('button', { onclick: close }, 'Annulla'), h('button', { class: 'primary', onclick: save }, 'Registra')] };
  });
}

// ---------------- documenti ----------------
let docType = '';
function documentsView() {
  const s = st();
  const docs = s.documents.filter((d) => !docType || d.type === docType).slice().reverse();
  return h('div', null, h('h1', null, 'Documenti'),
    h('div', { class: 'bar' }, h('select', { onchange: (e) => { docType = e.target.value; render(); } },
      h('option', { value: '' }, 'Tutti i tipi'), Object.entries(typeLabel).map(([k, v]) => h('option', { value: k, selected: k === docType }, v)))),
    docs.length ? h('table', null, h('thead', null, h('tr', null, ['Numero', 'Tipo', 'Data', 'Cliente / Fornitore', 'Totale', ''].map((x, i) => h('th', { class: i === 4 ? 'n' : '' }, x)))),
      h('tbody', null, docs.map((d) => h('tr', null, h('td', null, d.number), h('td', null, h('span', { class: 'tag' }, typeLabel[d.type])), h('td', null, dt(d.date)),
        h('td', null, (byId(s.customers, d.customerId) || {}).name || d.supplier || '—'),
        h('td', { class: 'n' }, (d.type === 'refund' ? '−' : '') + money(d.totals.total)),
        h('td', { class: 'n' }, h('button', { onclick: () => docDialog(d) }, 'Apri')))))) : h('div', { class: 'empty' }, 'Nessun documento'));
}

function docDialog(d) {
  const s = st();
  modal(`${typeLabel[d.type]} ${d.number}`, (close) => ({
    body: h('div', null, h('div', { class: 'muted' }, dt(d.date) + (d.note ? ' — ' + d.note : '')),
      h('table', null, h('tbody', null, d.items.map((i) => h('tr', null, h('td', null, i.name), h('td', { class: 'n' }, qtyFmt(i.qty)),
        h('td', { class: 'n' }, d.type === 'adjust' ? '' : money(d.type === 'purchase' ? i.cost * i.qty : S.calcLine(i).gross)))))),
      d.type === 'adjust' ? null : h('div', { class: 'total' }, money(d.totals.total)),
      d.payments.length ? h('div', { class: 'muted' }, d.payments.map((p) => `${(byId(s.paymentTypes, p.typeId) || {}).name || p.typeId}: ${money(p.amount)}`).join(' · ') + (d.change ? ` · Resto ${money(d.change)}` : '')) : null),
    buttons: [h('button', { onclick: close }, 'Chiudi'),
      d.type === 'sale' || d.type === 'refund' ? h('button', { onclick: () => printReceipt(d) }, 'Ristampa') : null,
      d.type === 'sale' ? h('button', { class: 'danger', onclick: () => confirmBox('Registrare il reso di tutti gli articoli non ancora resi?', () => guard(() => { const r = S.refundSale(s, d.id); store.save(); close(); toast(`Reso ${r.number}`); render(); }), 'Reso') }, 'Reso') : null],
  }));
}

// ---------------- clienti ----------------
function customersView() {
  const s = st();
  const spent = (id) => S.round2(s.documents.filter((d) => d.customerId === id).reduce((a, d) => a + (d.type === 'sale' ? d.totals.total : d.type === 'refund' ? -d.totals.total : 0), 0));
  return h('div', null, h('h1', null, 'Clienti'),
    h('div', { class: 'bar' }, h('div', { class: 'grow' }), h('button', { class: 'primary', onclick: () => customerDialog() }, '+ Nuovo cliente')),
    s.customers.length ? h('table', null, h('thead', null, h('tr', null, ['Nome', 'Telefono', 'Email', 'P.IVA / CF', 'Acquisti', ''].map((x, i) => h('th', { class: i === 4 ? 'n' : '' }, x)))),
      h('tbody', null, s.customers.map((c) => h('tr', null, h('td', null, c.name), h('td', null, c.phone), h('td', null, c.email), h('td', null, c.taxId),
        h('td', { class: 'n' }, money(spent(c.id))),
        h('td', { class: 'n' }, h('button', { onclick: () => customerDialog(c) }, 'Modifica'), ' ',
          h('button', { class: 'danger', onclick: () => confirmBox(`Eliminare ${c.name}? I documenti passati restano.`, () => { s.customers = s.customers.filter((x) => x.id !== c.id); store.save(); render(); }, 'Elimina') }, '✕'))))))
      : h('div', { class: 'empty' }, 'Nessun cliente'));
}

function customerDialog(c) {
  const s = st();
  modal(c ? 'Modifica cliente' : 'Nuovo cliente', (close) => {
    const f = { name: h('input', { value: c?.name || '' }), phone: h('input', { value: c?.phone || '' }), email: h('input', { type: 'email', value: c?.email || '' }), taxId: h('input', { value: c?.taxId || '' }), address: h('input', { value: c?.address || '' }) };
    const err = h('div', { class: 'err' });
    const save = () => { try {
      const d = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
      if (c) { if (!d.name.trim()) throw new Error('Nome cliente obbligatorio'); Object.assign(c, d); } else S.addCustomer(s, d);
      store.save(); close(); render();
    } catch (e) { err.textContent = e.message; } };
    return { body: h('div', null, h('div', { class: 'form' }, h('label', null, 'Nome'), f.name, h('label', null, 'Telefono'), f.phone, h('label', null, 'Email'), f.email, h('label', null, 'P.IVA / CF'), f.taxId, h('label', null, 'Indirizzo'), f.address), err),
      buttons: [h('button', { onclick: close }, 'Annulla'), h('button', { class: 'primary', onclick: save }, 'Salva')] };
  });
}

// ---------------- report ----------------
let repFrom = dayKey(new Date(Date.now() - 29 * 864e5)), repTo = dayKey(new Date());
function reportsView() {
  const s = st();
  const r = S.salesReport(s, repFrom, repTo + 'T23:59:59.999Z');
  const maxDay = Math.max(1, ...Object.values(r.byDay).map(Math.abs));
  const barRows = (obj) => Object.entries(obj).map(([k, v]) => h('div', { class: 'row' }, h('span', null, k), h('div', null, h('div', { class: 'bar-fill', style: `width:${Math.max(0, v) / Math.max(1, ...Object.values(obj)) * 100}%` })), h('span', { class: 'n' }, money(v))));
  return h('div', null, h('h1', null, 'Report vendite'),
    h('div', { class: 'bar' }, h('label', null, 'Dal '), h('input', { type: 'date', value: repFrom, onchange: (e) => { repFrom = e.target.value; render(); } }),
      h('label', null, ' al '), h('input', { type: 'date', value: repTo, onchange: (e) => { repTo = e.target.value; render(); } }),
      h('div', { class: 'grow' }),
      h('button', { onclick: () => download('vendite-per-prodotto.csv', S.toCSV([['Prodotto', 'Quantità', 'Ricavo'], ...r.byProduct.map((p) => [p.name, p.qty, p.revenue])]), 'text/csv') }, 'Esporta CSV')),
    h('div', { class: 'grid kpis' }, kpi('Incasso', money(r.revenue)), kpi('Scontrini', String(r.count)), kpi('Scontrino medio', money(r.average)), kpi('IVA', money(r.tax)), kpi('Utile lordo (netto IVA)', money(r.profit))),
    h('h2', null, 'Per giorno'), h('div', { class: 'card bars' }, Object.keys(r.byDay).length ? Object.keys(r.byDay).sort().map((d) => h('div', { class: 'row' }, h('span', null, d), h('div', null, h('div', { class: 'bar-fill', style: `width:${Math.max(0, r.byDay[d]) / maxDay * 100}%` })), h('span', { class: 'n' }, money(r.byDay[d])))) : h('div', { class: 'empty' }, 'Nessuna vendita nel periodo')),
    h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(280px,1fr));margin-top:4px' },
      h('div', null, h('h2', null, 'Per metodo di pagamento'), h('div', { class: 'card bars' }, barRows(Object.fromEntries(Object.entries(r.byPayment).map(([k, v]) => [(byId(s.paymentTypes, k) || {}).name || k, v]))))),
      h('div', null, h('h2', null, 'Per gruppo'), h('div', { class: 'card bars' }, barRows(r.byGroup)))),
    h('h2', null, 'Prodotti più venduti'),
    r.byProduct.length ? h('table', null, h('thead', null, h('tr', null, h('th', null, 'Prodotto'), h('th', { class: 'n' }, 'Quantità'), h('th', { class: 'n' }, 'Ricavo'))),
      h('tbody', null, r.byProduct.slice(0, 15).map((p) => h('tr', null, h('td', null, p.name), h('td', { class: 'n' }, qtyFmt(p.qty)), h('td', { class: 'n' }, money(p.revenue)))))) : h('div', { class: 'empty' }, '—'));
}
const kpi = (l, v) => h('div', { class: 'card kpi' }, h('div', { class: 'l' }, l), h('div', { class: 'v' }, v));

// ---------------- impostazioni ----------------
function settingsView() {
  const s = st(), set = s.settings;
  const field = (label, key, type = 'text') => [h('label', null, label), h('input', { type, value: set[key], onchange: (e) => { set[key] = type === 'number' ? num(e.target.value) : e.target.value; store.save(); toast('Salvato'); } })];
  const importer = h('input', { type: 'file', accept: 'application/json', style: 'display:none', onchange: (e) => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then((t) => guard(() => { store.importJSON(t); toast('Dati importati'); render(); })); e.target.value = '';
  } });
  const listEditor = (title, arr, nameKey, addFn, extra) => h('div', null, h('h2', null, title),
    h('table', null, h('tbody', null, arr.map((x) => h('tr', null, h('td', null, x[nameKey], extra ? extra(x) : ''),
      h('td', { class: 'n' }, h('button', { class: 'danger', onclick: () => { const i = arr.indexOf(x); arr.splice(i, 1); store.save(); render(); } }, '✕')))))),
    h('div', { class: 'bar', style: 'margin-top:8px' }, addFn));
  const nameInput = (ph) => h('input', { placeholder: ph, class: 'grow' });
  const gIn = nameInput('Nuovo gruppo'); const pIn = nameInput('Nuovo metodo di pagamento');
  const tName = h('input', { placeholder: 'Nome (es. IVA 5%)', class: 'grow' }), tRate = h('input', { placeholder: 'Aliquota %', style: 'width:100px', inputmode: 'decimal' });
  return h('div', null, h('h1', null, 'Impostazioni'),
    h('div', { class: 'card' }, h('div', { class: 'form' }, field('Ragione sociale', 'company'), field('Indirizzo', 'address'), field('P.IVA', 'taxId'), field('Valuta', 'currency'), field('Piè scontrino', 'receiptFooter'), field('Scorta minima predef.', 'lowStockDefault', 'number'))),
    listEditor('Gruppi prodotto', s.groups, 'name', [gIn, h('button', { onclick: () => guard(() => { S.addGroup(s, gIn.value); store.save(); render(); }) }, 'Aggiungi')]),
    listEditor('Aliquote IVA', s.taxes, 'name', [tName, tRate, h('button', { onclick: () => guard(() => { const r = num(tRate.value); if (!tName.value.trim() || !(r >= 0 && r <= 100)) throw new Error('Nome e aliquota (0–100) richiesti'); s.taxes.push({ id: 't' + Date.now(), name: tName.value.trim(), rate: r }); store.save(); render(); }) }, 'Aggiungi')], (x) => ` (${x.rate}%)`),
    listEditor('Metodi di pagamento', s.paymentTypes, 'name', [pIn, h('button', { onclick: () => guard(() => { if (!pIn.value.trim()) throw new Error('Nome richiesto'); s.paymentTypes.push({ id: 'pt' + Date.now(), name: pIn.value.trim(), allowsChange: false }); store.save(); render(); }) }, 'Aggiungi')]),
    h('h2', null, 'Dati'),
    h('div', { class: 'bar' },
      h('button', { onclick: () => download(`backup-${dayKey(new Date())}.json`, store.exportJSON(), 'application/json') }, 'Esporta backup'),
      h('button', { onclick: () => importer.click() }, 'Importa backup'), importer,
      h('button', { onclick: () => confirmBox('Ripristinare i dati di esempio? Tutti i dati attuali andranno persi.', () => { store.reset(true); clearCart(); render(); }, 'Ripristina') }, 'Dati di esempio'),
      h('button', { class: 'danger', onclick: () => confirmBox('Cancellare TUTTI i dati (prodotti, clienti, documenti)?', () => { store.reset(false); clearCart(); render(); }, 'Cancella tutto') }, 'Svuota tutto')),
    h('p', { class: 'muted' }, storage ? 'I dati sono salvati nel browser di questo dispositivo: fai backup periodici.' : 'Archiviazione del browser non disponibile: i dati si perdono alla chiusura.'));
}

// ---------------- avvio ----------------
document.addEventListener('keydown', (e) => { if (e.key === 'F2' && current === 'cassa') { e.preventDefault(); refocusScan(); } });
current = routes[location.hash.slice(1)] ? location.hash.slice(1) : 'cassa';
render();
