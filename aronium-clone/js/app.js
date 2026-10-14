import * as S from './store.js';
import { h, toast, modal, confirmBox, download, icon } from './ui.js';

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

// ---------------- sessione e routing ----------------
let session = null; // { user }
const backoffice = {
  prodotti: ['Prodotti', productsView], magazzino: ['Magazzino', stockView], documenti: ['Documenti', documentsView],
  clienti: ['Clienti', customersView], report: ['Report', reportsView], impostazioni: ['Impostazioni', settingsView],
};
let current = 'cassa';
const isAdmin = () => session && session.user.role === 'admin';
function go(name) { current = name === 'cassa' || (backoffice[name] && isAdmin()) ? name : 'cassa'; location.hash = current; render(); }
function logout() { session = null; clearCart(); current = 'cassa'; render(); }

function render() {
  const app = document.getElementById('app');
  if (!session) { app.replaceChildren(loginView()); return; }
  if (current === 'cassa') { app.replaceChildren(posView()); return; }
  const nav = h('nav', null, h('div', { class: 'brand' }, 'aronium clone'),
    h('a', { onclick: () => go('cassa') }, '← Cassa'),
    Object.entries(backoffice).map(([k, [label]]) => h('a', { class: k === current ? 'on' : '', onclick: () => go(k) }, label)),
    h('div', { class: 'sp' }), h('a', { onclick: logout }, `Esci (${session.user.name})`));
  app.replaceChildren(h('div', { class: 'bo' }, nav, h('main', { id: 'view' }, backoffice[current][1]())));
}
window.addEventListener('hashchange', () => { const n = location.hash.slice(1); if (session && n !== current && (n === 'cassa' || (backoffice[n] && isAdmin()))) { current = n; render(); } });

// ---------------- login con tastiera su schermo ----------------
const KB = {
  sym: [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'BACK'], ['!', '@', '#', '/', '^', '&', '*', '(', ')', '"', 'ENTER'], ['SHIFT', '-', '_', '[', ']', '|', '<', '>', '+', '=', '~', 'SHIFT']],
  abc: [['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', 'BACK'], ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ENTER'], ['SHIFT', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', 'SHIFT']],
};
function loginView() {
  let mode = 'sym', shift = false;
  const err = h('div', { class: 'err', role: 'alert' });
  const input = h('input', { type: 'password', 'aria-label': 'Password', autocomplete: 'off' });
  const submit = () => {
    const u = st().users.find((x) => x.password === input.value);
    if (!u) { err.textContent = 'Password errata'; input.value = ''; return; }
    session = { user: u }; current = 'cassa'; render();
  };
  input.addEventListener('keydown', (e) => { err.textContent = ''; if (e.key === 'Enter') submit(); });
  const kbBox = h('div', { class: 'osk' });
  const type = (t) => { const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a; input.setRangeText(t, a, b, 'end'); err.textContent = ''; input.focus(); };
  const key = (label, cls, fn) => h('button', { class: cls, tabindex: '-1', onmousedown: (e) => e.preventDefault(), onclick: fn }, label);
  const drawKb = () => {
    kbBox.replaceChildren(...KB[mode].map((row) => h('div', { class: 'row' }, row.map((k) => {
      if (k === 'BACK') return key(icon('backspace', 28), 'w', () => { const a = input.selectionStart, b = input.selectionEnd; if (a === b && a > 0) input.setRangeText('', a - 1, a, 'end'); else input.setRangeText('', a, b, 'end'); input.focus(); });
      if (k === 'ENTER') return key('enter', 'w', submit);
      if (k === 'SHIFT') return key(icon('arrow', 26), 'dim' + (shift ? ' on' : ''), () => { shift = !shift; drawKb(); });
      return key(shift ? k.toUpperCase() : k, '', () => { type(shift ? k.toUpperCase() : k); if (shift) { shift = false; drawKb(); } });
    }))),
    h('div', { class: 'row' },
      key('▾', 'dim', () => { kbBox.style.display = 'none'; input.focus(); }),
      key(mode === 'sym' ? 'ABC' : '123', '', () => { mode = mode === 'sym' ? 'abc' : 'sym'; drawKb(); }),
      key('.', '', () => type('.')), key('', 'sp', () => type(' ')),
      key('prev', 'dim', () => { input.setSelectionRange(0, 0); input.focus(); }), key('next', 'dim', () => { const n = input.value.length; input.setSelectionRange(n, n); input.focus(); }),
      key('‹', '', () => { const a = Math.max(0, input.selectionStart - 1); input.setSelectionRange(a, a); input.focus(); }),
      key('›', '', () => { const a = Math.min(input.value.length, input.selectionEnd + 1); input.setSelectionRange(a, a); input.focus(); })));
  };
  drawKb();
  input.addEventListener('focus', () => { kbBox.style.display = ''; });
  setTimeout(() => input.focus(), 0);
  return h('div', { class: 'login' },
    h('button', { class: 'power', 'aria-label': 'Chiudi', onclick: () => toast('Chiudi la scheda del browser per uscire') }, icon('power', 32, 2)),
    h('div', { class: 'brand' }, h('span', { style: 'color:var(--cyan)' }, icon('hexagon', 96, 1.8)), h('div', { class: 'word' }, 'aronium', h('small', null, 'CLONE'))),
    h('h2', null, 'Login'),
    h('div', { class: 'pw' }, input, h('button', { 'aria-label': 'Accedi', onclick: submit }, icon('arrow', 22, 2))),
    h('a', { onclick: () => toast('Le password si cambiano da Impostazioni > Utenti (admin)') }, 'Password dimenticata?'), err, kbBox);
}

// ---------------- cassa ----------------
const cart = { lines: [], discount: 0, customerId: '', service: '', selected: -1 };
let searchMode = 'all';
const SERVICES = ['', 'Dine-in', 'Take-away'];
const plain = (n) => new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

function cartItems() { return cart.lines.map((l) => { const p = byId(st().products, l.productId); return { ...l, price: l.price ?? p.price, taxRate: S.taxRate(st(), p.taxId) }; }); }
function clearCart() { Object.assign(cart, { lines: [], discount: 0, customerId: '', service: '', selected: -1 }); }
function addToCart(p, q = 1) {
  const l = cart.lines.find((x) => x.productId === p.id && x.price === undefined && !x.discount);
  if (l) { l.qty = Math.round((l.qty + q) * 1000) / 1000; cart.selected = cart.lines.indexOf(l); }
  else { cart.lines.push({ productId: p.id, qty: q, discount: 0 }); cart.selected = cart.lines.length - 1; }
  render();
}
function focusSearch() { const i = document.getElementById('scan'); if (i) i.focus(); }
const selLine = () => cart.lines[cart.selected];
const matches = (p, q) => {
  q = q.toLowerCase();
  const f = { barcode: p.barcode, code: p.code, name: p.name, all: `${p.name} ${p.barcode} ${p.code}` }[searchMode];
  return p.active && String(f).toLowerCase().includes(q);
};

function posView() {
  const s = st(), items = cartItems(), t = S.calcTotals(items, cart.discount), has = cart.lines.length > 0, sel = selLine();
  const results = h('div', { class: 'results', style: 'display:none', role: 'listbox' });
  const scan = h('input', { id: 'scan', placeholder: 'Search products by name, code or barcode', autocomplete: 'off', 'aria-label': 'Cerca prodotti' });
  const showResults = () => {
    const q = scan.value.trim();
    const list = q ? s.products.filter((p) => matches(p, q)).slice(0, 30) : [];
    results.style.display = list.length ? '' : 'none';
    results.replaceChildren(...list.map((p) => h('button', { onclick: () => addToCart(p) }, h('span', null, p.name, h('small', { class: 'muted' }, `  ${p.barcode || p.code}`)), h('span', null, money(p.price)))));
  };
  scan.addEventListener('input', showResults);
  scan.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { scan.value = ''; showResults(); return; }
    if (e.key !== 'Enter') return;
    const v = scan.value.trim(); if (!v) return;
    const exact = s.products.find((p) => p.active && (p.barcode === v || p.code === v));
    const list = s.products.filter((p) => matches(p, v));
    const hit = exact || (list.length === 1 ? list[0] : null);
    if (hit) addToCart(hit); else toast(list.length ? 'Più risultati: scegli dall\'elenco' : 'Prodotto non trovato');
  });
  const mode = (m, ic, label) => h('button', { class: 'mode' + (searchMode === m ? ' on' : ''), title: label, 'aria-label': label, 'aria-pressed': String(searchMode === m), onclick: () => { searchMode = m; render(); } }, icon(ic, 24));
  const top = h('div', { class: 'topbar' }, mode('all', 'asterisk', 'Cerca ovunque'), mode('barcode', 'barcode', 'Cerca per barcode'), mode('code', 'hash', 'Cerca per codice'), mode('name', 'tag', 'Cerca per nome'),
    h('div', { class: 'search' }, icon('search', 22), scan), results);

  const body = has ? cart.lines.map((l, i) => {
    const it = items[i], p = byId(s.products, l.productId);
    return h('div', { class: 'ln' + (i === cart.selected ? ' sel' : ''), onclick: () => { cart.selected = i === cart.selected ? -1 : i; render(); } },
      h('span', null, p.name, l.discount ? h('small', null, `Sconto ${l.discount}%`) : null), h('span', { class: 'n' }, qtyFmt(l.qty)), h('span', { class: 'n' }, plain(it.price)), h('span', { class: 'n' }, plain(S.calcLine(it).gross)));
  }) : h('div', { class: 'none' }, h('b', null, 'Nessun articolo'), h('span', null, 'Aggiungi prodotti alla ricevuta utilizzando il codice a barre, il codice prodotto o la ricerca premendo il bottone F3'));
  const orders = h('div', { class: 'orders' },
    h('div', { class: 'head' }, h('span', null, 'Nome del prodotto'), h('span', { class: 'n' }, 'Quantità'), h('span', { class: 'n' }, 'Prezzo'), h('span', { class: 'n' }, 'Totale')),
    h('div', { class: 'body' }, body),
    h('div', { class: 'totals', 'aria-live': 'polite' }, h('div', { class: 'r' }, h('span', null, 'Totale parziale'), h('span', null, plain(t.subtotal))),
      cart.discount ? h('div', { class: 'r' }, h('span', null, `Sconto ${cart.discount}%`), h('span', null, '−' + plain(t.discountAmount))) : null,
      h('div', { class: 'r' }, h('span', null, 'IVA'), h('span', null, plain(t.tax))), h('div', { class: 'r t' }, h('span', null, 'TOTALE'), h('span', null, plain(t.total)))));

  // k(): pulsante del pannello. `big` mostra il tasto F in grande (F9/F10) invece dell'icona.
  const k = (label, ic, fk, fn, opt = {}) => h('button', { class: 'k ' + (opt.cls || ''), disabled: opt.disabled, onclick: fn, title: fk || label },
    fk && !opt.big ? h('span', { class: 'f' }, fk) : null, opt.big ? h('span', { class: 'fk' }, fk) : null, ic ? icon(ic, 36) : null, h('span', null, label));
  const cust = byId(s.customers, cart.customerId);
  const pm = s.paymentTypes.slice(0, 3).map((pt, i) => h('button', { class: 'k pm' + (pt.allowsChange ? ' cash' : ''), disabled: !has, onclick: () => payWith(pt.id) }, i === 0 ? h('span', { class: 'f' }, 'F12') : null, pt.name));
  const keys = h('div', { class: 'keys' },
    k('Cancella', 'x', '', removeSelected, { disabled: !sel }), k('Cerca', 'search', 'F3', searchDialog), k('Quantità', 'basket', 'F4', setQty, { disabled: !sel }), k('Nuova vendita', 'plus', 'F8', newSale),
    pm, h('div', { class: 'spacer' }), h('div', { class: 'logo' }, icon('hexagon', 150, 1.1)),
    k('Cassetto contanti', 'drawer', '', () => toast('Cassetto contanti aperto')),
    k(cart.service || 'Service type', cart.service === 'Dine-in' ? 'dine' : cart.service ? 'transfer' : 'question', '', () => { cart.service = SERVICES[(SERVICES.indexOf(cart.service) + 1) % SERVICES.length]; render(); }), h('div', { class: 'gap' }),
    k('Sconto', 'percent', 'F2', discount), k('Price', 'tag', '', setPrice, { disabled: !sel }), k(cust ? cust.name : 'Customer', 'customer', '', pickCustomer), k(session.user.name, 'person', '', () => toast(`Utente: ${session.user.name}`)),
    k('Salva la vendita', null, 'F9', holdCart, { big: true, disabled: !has }), k('Rimborsa', 'refund', '', refundDialog), k('Pagamento', null, 'F10', () => payDialog(t), { big: true, cls: 'pay', disabled: !has }),
    k('Blocco', 'lock', '', logout), k(`Sospesi${s.held.length ? ` (${s.held.length})` : ''}`, 'transfer', 'F7', showHeld), k('Annulla ordine', 'trash', '', cancelOrder, { cls: 'cancel', disabled: !has && !cart.customerId }), k('', 'dots', '', moreMenu));
  setTimeout(focusSearch, 0);
  return h('div', { class: 'pos' }, top, h('div', { class: 'posmain' }, orders, keys));
}

function removeSelected() { if (!selLine()) return; cart.lines.splice(cart.selected, 1); cart.selected = Math.min(cart.selected, cart.lines.length - 1); render(); }
function setQty() { const l = selLine(); if (l) askNumber('Quantità', l.qty, (v) => { if (v > 0) l.qty = v; else removeSelected(); render(); }); }
function setPrice() { const l = selLine(); if (l) askNumber('Prezzo unitario (IVA incl.)', l.price ?? byId(st().products, l.productId).price, (v) => { l.price = S.round2(v); render(); }); }
function discount() {
  const l = selLine();
  if (l) askNumber('Sconto sulla riga (%)', l.discount, (v) => { l.discount = Math.min(100, v); render(); });
  else if (cart.lines.length) askNumber('Sconto sul documento (%)', cart.discount, (v) => { cart.discount = Math.min(100, v); render(); });
  else toast('Aggiungi un articolo prima');
}
function newSale() { if (cart.lines.length) holdCart(); else toast('La vendita corrente è già vuota'); }
function cancelOrder() { confirmBox('Annullare l\'ordine corrente?', () => { clearCart(); render(); }, 'Annulla ordine'); }
function pickCustomer() {
  modal('Cliente', (close) => ({
    body: h('div', null, h('button', { class: 'listbtn', onclick: () => { cart.customerId = ''; close(); render(); } }, 'Cliente generico'),
      st().customers.map((c) => h('button', { class: 'listbtn', onclick: () => { cart.customerId = c.id; close(); render(); } }, h('span', null, c.name), h('span', { class: 'muted' }, c.phone)))),
    buttons: [h('button', { onclick: close }, 'Chiudi')],
  }));
}
function searchDialog() {
  modal('Cerca prodotto', (close) => {
    const inp = h('input', { placeholder: 'Nome, codice o barcode', style: 'width:100%;margin-bottom:8px' }), out = h('div');
    const draw = () => {
      const q = inp.value.trim().toLowerCase();
      out.replaceChildren(...st().products.filter((p) => p.active && (!q || `${p.name} ${p.barcode} ${p.code}`.toLowerCase().includes(q))).slice(0, 40)
        .map((p) => h('button', { class: 'listbtn', onclick: () => { close(); addToCart(p); } }, h('span', null, p.name), h('span', null, money(p.price)))));
    };
    inp.addEventListener('input', draw); draw();
    return { body: h('div', null, inp, out), buttons: [h('button', { onclick: close }, 'Chiudi')] };
  });
}
function refundDialog() {
  const sales = st().documents.filter((d) => d.type === 'sale').slice(-20).reverse();
  modal('Rimborsa', (close) => ({
    body: sales.length ? h('div', null, sales.map((d) => h('button', { class: 'listbtn', onclick: () => { close(); docDialog(d); } }, h('span', null, `${d.number}  ${dt(d.date)}`), h('span', null, money(d.totals.total))))) : h('div', { class: 'empty' }, 'Nessuna vendita da rimborsare'),
    buttons: [h('button', { onclick: close }, 'Chiudi')],
  }));
}
function moreMenu() {
  modal('Menu', (close) => {
    const last = st().documents.filter((d) => d.type === 'sale').pop();
    const go2 = (n) => () => { close(); go(n); };
    return { body: h('div', { class: 'menu' },
      isAdmin() ? Object.entries(backoffice).map(([key, [label]]) => h('button', { onclick: go2(key) }, label)) : null,
      h('button', { disabled: !last, onclick: () => { close(); printReceipt(last); } }, 'Ristampa ultimo scontrino'), h('button', { onclick: () => { close(); logout(); } }, 'Esci')),
      buttons: [h('button', { onclick: close }, 'Chiudi')] };
  });
}
function holdCart() {
  if (!cart.lines.length) return;
  st().held.push({ id: 'h' + Date.now(), at: new Date().toISOString(), cart: JSON.parse(JSON.stringify(cart)) }); clearCart(); store.save(); render(); toast('Vendita salvata');
}
function showHeld() {
  modal('Vendite sospese', (close) => ({
    body: st().held.length ? h('div', null, st().held.map((o) => h('div', { class: 'bar' },
      h('span', { class: 'grow' }, `${dt(o.at)} — ${o.cart.lines.length} righe`),
      h('button', { disabled: cart.lines.length > 0, title: cart.lines.length ? 'Svuota o salva la vendita corrente' : '', onclick: () => { Object.assign(cart, o.cart, { selected: -1 }); st().held = st().held.filter((x) => x.id !== o.id); store.save(); close(); render(); } }, 'Riprendi'),
      h('button', { class: 'danger', onclick: () => { st().held = st().held.filter((x) => x.id !== o.id); store.save(); close(); render(); } }, 'Elimina')))) : h('div', { class: 'empty' }, 'Nessuna vendita sospesa'),
    buttons: [h('button', { onclick: close }, 'Chiudi')],
  }));
}

function askNumber(title, initial, onOk) {
  modal(title, (close) => {
    const inp = h('input', { value: initial || '', inputmode: 'decimal', style: 'width:100%' });
    const ok = () => { const v = num(inp.value || 0); if (Number.isNaN(v) || v < 0) return toast('Valore non valido'); close(); onOk(v); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    return { body: inp, buttons: [h('button', { onclick: close }, 'Annulla'), h('button', { class: 'primary', onclick: ok }, 'OK')] };
  });
}

function finalizeSale(payments) {
  const doc = S.createSale(st(), { items: cartItems(), customerId: cart.customerId, discount: cart.discount, payments, userId: session.user.id, service: cart.service });
  store.save(); clearCart(); render(); toast(`Vendita ${doc.number} registrata`); printReceipt(doc);
}
function payWith(typeId) {
  const t = S.calcTotals(cartItems(), cart.discount), type = byId(st().paymentTypes, typeId);
  if (type.allowsChange) return payDialog(t, typeId);
  guard(() => finalizeSale([{ typeId, amount: t.total }]));
}
function payDialog(totals, preset) {
  const s = st();
  modal('Pagamento', (close) => {
    const inputs = {}, status = h('div', { class: 'total' }), err = h('div', { class: 'err' });
    const upd = () => {
      const diff = S.round2(Object.values(inputs).reduce((a, i) => a + (num(i.value || 0) || 0), 0) - totals.total);
      status.textContent = diff >= 0 ? `Resto ${money(diff)}` : `Mancano ${money(-diff)}`; status.style.color = diff >= 0 ? '#7ed17f' : '#ff7b7b';
    };
    const first = preset || s.paymentTypes[0].id;
    const rows = s.paymentTypes.map((pt) => {
      const inp = h('input', { inputmode: 'decimal', value: pt.id === first ? totals.total.toFixed(2) : '', oninput: upd });
      inputs[pt.id] = inp;
      return [h('label', null, pt.name), h('div', { class: 'bar' }, inp, h('button', { onclick: () => { inp.value = S.round2(Math.max(0, totals.total - otherPaid(inputs, pt.id))).toFixed(2); upd(); } }, 'Esatto'))];
    });
    upd();
    const confirm = () => {
      const payments = Object.entries(inputs).map(([typeId, i]) => ({ typeId, amount: num(i.value || 0) || 0 })).filter((p) => p.amount > 0);
      try { finalizeSale(payments); close(); } catch (e) { err.textContent = e.message; }
    };
    return { body: h('div', null, h('div', { class: 'total' }, money(totals.total)), h('div', { class: 'form' }, rows), status, err),
      buttons: [h('button', { onclick: close }, 'Annulla'), h('button', { class: 'ok', onclick: confirm }, 'Conferma e stampa')] };
  });
}
const otherPaid = (inputs, skip) => Object.entries(inputs).filter(([k]) => k !== skip).reduce((a, [, i]) => a + (num(i.value || 0) || 0), 0);

function printReceipt(doc) {
  const s = st(), set = s.settings, cust = byId(s.customers, doc.customerId), user = byId(s.users, doc.userId);
  const r = document.getElementById('receipt');
  const row = (a, b) => h('div', { class: 'r' }, h('span', null, a), h('span', null, b));
  r.replaceChildren(h('div', null,
    h('h4', null, set.company), set.address ? h('div', { class: 'c' }, set.address) : null, set.taxId ? h('div', { class: 'c' }, 'P.IVA ' + set.taxId) : null,
    h('hr'), row(typeLabel[doc.type] + ' ' + doc.number, dt(doc.date)), cust ? h('div', null, 'Cliente: ' + cust.name) : null, user ? h('div', null, 'Operatore: ' + user.name) : null, doc.service ? h('div', null, doc.service) : null, h('hr'),
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
    h('h2', null, 'Utenti'),
    h('table', null, h('tbody', null, s.users.map((u) => h('tr', null,
      h('td', null, h('input', { value: u.name, 'aria-label': 'Nome utente', onchange: (e) => { if (e.target.value.trim()) { u.name = e.target.value.trim(); store.save(); toast('Salvato'); } } })),
      h('td', null, h('input', { value: u.password, 'aria-label': 'Password', onchange: (e) => { if (!e.target.value) { e.target.value = u.password; return toast('Password obbligatoria'); } if (s.users.some((x) => x !== u && x.password === e.target.value)) { e.target.value = u.password; return toast('Password già usata da un altro utente'); } u.password = e.target.value; store.save(); toast('Salvato'); } })),
      h('td', null, h('select', { 'aria-label': 'Ruolo', onchange: (e) => { if (u.role === 'admin' && e.target.value !== 'admin' && s.users.filter((x) => x.role === 'admin').length < 2) { e.target.value = 'admin'; return toast('Serve almeno un amministratore'); } u.role = e.target.value; store.save(); } }, h('option', { value: 'admin', selected: u.role === 'admin' }, 'Amministratore'), h('option', { value: 'cashier', selected: u.role === 'cashier' }, 'Cassiere'))),
      h('td', { class: 'n' }, h('button', { class: 'danger', onclick: () => { if (u.role === 'admin' && s.users.filter((x) => x.role === 'admin').length < 2) return toast('Serve almeno un amministratore'); if (u === session.user) return toast('Non puoi eliminare l\'utente attivo'); s.users.splice(s.users.indexOf(u), 1); store.save(); render(); } }, '✕')))))),
    h('div', { class: 'bar', style: 'margin-top:8px' }, h('button', { onclick: () => { let n = 1, pw; do { pw = String(1000 + n++); } while (s.users.some((x) => x.password === pw)); s.users.push({ id: 'u' + Date.now(), name: 'Nuovo utente', password: pw, role: 'cashier' }); store.save(); render(); } }, '+ Utente'), h('span', { class: 'muted' }, 'Il login usa solo la password: deve essere unica. Serve a bloccare la cassa, non è una protezione dei dati.')),
    h('h2', null, 'Dati'),
    h('div', { class: 'bar' },
      h('button', { onclick: () => download(`backup-${dayKey(new Date())}.json`, store.exportJSON(), 'application/json') }, 'Esporta backup'),
      h('button', { onclick: () => importer.click() }, 'Importa backup'), importer,
      h('button', { onclick: () => confirmBox('Ripristinare i dati di esempio? Tutti i dati attuali andranno persi.', () => { store.reset(true); clearCart(); render(); }, 'Ripristina') }, 'Dati di esempio'),
      h('button', { class: 'danger', onclick: () => confirmBox('Cancellare TUTTI i dati (prodotti, clienti, documenti)?', () => { store.reset(false); clearCart(); render(); }, 'Cancella tutto') }, 'Svuota tutto')),
    h('p', { class: 'muted' }, storage ? 'I dati sono salvati nel browser di questo dispositivo: fai backup periodici.' : 'Archiviazione del browser non disponibile: i dati si perdono alla chiusura.'));
}

// ---------------- avvio ----------------
document.addEventListener('keydown', (e) => {
  if (!session || current !== 'cassa' || document.querySelector('#modal-root .back')) return;
  const has = cart.lines.length > 0;
  const map = { F2: discount, F3: searchDialog, F4: setQty, F7: showHeld, F8: newSale, F9: holdCart, F10: () => has && payDialog(S.calcTotals(cartItems(), cart.discount)), F12: () => has && payWith('cash') };
  if (map[e.key]) { e.preventDefault(); map[e.key](); }
});
render();
