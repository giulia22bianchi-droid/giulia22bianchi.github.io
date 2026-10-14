import { h, state, money, qtyFmt, parseNum, can, toast, modal, confirmBox, field, select, debounce } from './ui.js';
import { get, post, del } from './api.js';
import { printDocument, printA4 } from './print.js';

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Stessa formula del server (lib/documents.js): serve solo per l'anteprima del carrello. */
export function calcCart(items, discount) {
  const inclusive = state.settings.prices_include_tax === '1';
  const raw = items.map((l) => l.qty * l.price * (1 - (l.discount_pct || 0) / 100));
  const sum = raw.reduce((s, v) => s + v, 0);
  let docPct = 0;
  if (discount?.value > 0) docPct = discount.type === 'amount' ? (sum > 0 ? (Math.min(discount.value, sum) / sum) * 100 : 0) : Math.min(discount.value, 100);
  let total = 0, tax = 0, finalSum = 0;
  items.forEach((l, i) => {
    const final = round2(raw[i] * (1 - docPct / 100));
    const rate = (l.tax_rate || 0) / 100;
    finalSum += final;
    if (inclusive) { total += final; tax += round2(final - round2(final / (1 + rate))); }
    else { const t = round2(final * rate); total += round2(final + t); tax += t; }
  });
  const subtotal = round2(items.reduce((s, l) => s + l.qty * l.price, 0));
  return { subtotal, discount: round2(subtotal - finalSum), tax: round2(tax), total: round2(total) };
}

export async function renderPos(root) {
  root.classList.add('flush');
  const cart = { id: null, items: [], partner: null, discount: { type: 'pct', value: 0 }, note: '', selected: -1 };
  let products = [];
  let groups = [];
  let shift = await get('/shifts/current');
  let activeGroup = 'fav';
  let filter = '';

  const [prods, grps] = await Promise.all([get('/products?limit=5000'), get('/groups')]);
  products = prods;
  groups = grps;

  const tiles = h('div', { class: 'tiles' });
  const tabs = h('div', { class: 'group-tabs' });
  const cartEl = h('div', { class: 'cart' });
  const sumEl = h('div', { class: 'cart-sum' });
  const headEl = h('div', { class: 'cart-head' });
  const shiftBar = h('div', { class: 'shift-bar' });
  const payBtn = h('button', { class: 'primary pay-btn', onclick: () => openPay() }, 'Incassa');
  const search = h('input', { placeholder: 'Cerca prodotto o scansiona codice a barre…', autocomplete: 'off', 'aria-label': 'Cerca prodotto' });

  const hasFavs = products.some((p) => p.favorite);
  if (!hasFavs) activeGroup = 'all';

  function drawTabs() {
    tabs.replaceChildren(
      ...(hasFavs ? [h('button', { class: activeGroup === 'fav' ? 'active' : '', onclick: () => { activeGroup = 'fav'; drawTabs(); drawTiles(); } }, '★ Preferiti')] : []),
      h('button', { class: activeGroup === 'all' ? 'active' : '', onclick: () => { activeGroup = 'all'; drawTabs(); drawTiles(); } }, 'Tutti'),
      ...groups.map((g) => h('button', {
        class: activeGroup === g.id ? 'active' : '', style: { '--gc': g.color },
        onclick: () => { activeGroup = g.id; drawTabs(); drawTiles(); },
      }, g.name)));
  }

  function drawTiles() {
    const q = filter.trim().toLowerCase();
    let list = products;
    if (q) list = list.filter((p) => [p.name, p.code, p.barcode].some((v) => v && String(v).toLowerCase().includes(q)));
    else if (activeGroup === 'fav') list = list.filter((p) => p.favorite);
    else if (activeGroup !== 'all') list = list.filter((p) => p.group_id === activeGroup);
    tiles.replaceChildren(...list.slice(0, 300).map((p) => h('button', {
      class: `tile${p.track_stock && p.stock <= 0 ? ' out' : ''}`, style: { '--gc': p.group_color || 'var(--primary)' }, onclick: () => addProduct(p),
    }, h('span', { class: 't-name' }, p.name),
    h('span', { class: 't-meta' }, h('b', {}, money(p.price)), p.track_stock ? h('small', {}, qtyFmt(p.stock)) : null))));
    if (!list.length) tiles.append(h('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, 'Nessun prodotto'));
  }

  function addProduct(p, qty = 1) {
    const existing = cart.items.findIndex((l) => l.product_id === p.id && !l.discount_pct && l.price === p.price);
    if (existing >= 0) { cart.items[existing].qty = round2(cart.items[existing].qty + qty); cart.selected = existing; }
    else {
      cart.items.push({ product_id: p.id, name: p.name, qty, price: p.price, discount_pct: 0, tax_rate: p.tax_rate, unit: p.unit, allow_price_change: p.allow_price_change });
      cart.selected = cart.items.length - 1;
    }
    drawCart();
  }

  search.addEventListener('input', debounce(() => { filter = search.value; drawTiles(); }, 120));
  search.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const code = search.value.trim();
    if (!code) return;
    // "3*codice" aggiunge più pezzi
    const m = code.match(/^(\d+(?:[.,]\d+)?)\*(.+)$/);
    const qty = m ? parseNum(m[1]) : 1;
    const key = m ? m[2] : code;
    try {
      addProduct(await get(`/products/lookup/${encodeURIComponent(key)}`, { quiet: true }), qty);
      search.value = ''; filter = ''; drawTiles();
    } catch {
      const q = key.toLowerCase();
      const matches = products.filter((p) => p.name.toLowerCase().includes(q));
      if (matches.length === 1) { addProduct(matches[0], qty); search.value = ''; filter = ''; drawTiles(); }
      else toast(matches.length ? 'Più prodotti trovati: scegli dall\'elenco' : 'Prodotto non trovato', matches.length ? 'ok' : 'error');
    }
  });

  function drawShift() {
    shiftBar.replaceChildren(
      h('span', {}, shift ? `Turno #${shift.shift.id} · fondo ${money(shift.shift.opening_cash)} · incasso ${money(shift.documents.net)}` : 'Nessun turno aperto'),
      h('span', { class: 'row' },
        shift ? h('a', { href: '#/register', class: 'muted' }, 'Cassa e chiusura') : h('button', { onclick: openShiftModal }, 'Apri turno')));
  }

  function drawHead() {
    headEl.replaceChildren(...[
      h('button', { onclick: pickCustomer }, cart.partner ? `👤 ${cart.partner.name}` : '👤 Cliente'),
      can('pos.discount') ? h('button', { onclick: discountModal }, cart.discount.value > 0 ? `Sconto ${cart.discount.type === 'pct' ? cart.discount.value + '%' : money(cart.discount.value)}` : 'Sconto') : null,
      h('button', { onclick: holdCart, disabled: !cart.items.length }, '⏸ Sospendi'),
      h('button', { onclick: heldList }, '📋 Sospesi'),
      h('button', { onclick: noteModal }, cart.note ? '📝 Nota ✓' : '📝 Nota'),
      h('button', { onclick: freeItemModal, disabled: !can('pos.price_change') }, '＋ Libero'),
      h('button', { class: 'ghost', onclick: clearCart, disabled: !cart.items.length && !cart.partner }, '🗑 Svuota')].filter(Boolean));
  }

  function drawCart() {
    cartEl.replaceChildren(...(cart.items.length ? cart.items.map((l, i) => {
      const lineTotal = l.qty * l.price * (1 - (l.discount_pct || 0) / 100);
      return h('div', { class: `cart-line${i === cart.selected ? ' sel' : ''}`, onclick: () => { cart.selected = i; drawCart(); editLine(i); } },
        h('span', { class: 'l-name' }, l.name),
        h('span', { class: 'l-total' }, money(lineTotal)),
        h('span', { class: 'l-sub' }, `${qtyFmt(l.qty)} ${l.unit || ''} × ${money(l.price)}${l.discount_pct ? ` · -${l.discount_pct}%` : ''}`),
        h('span', { class: 'row', style: { justifyContent: 'flex-end', gap: '4px' } },
          h('button', { class: 'icon', 'aria-label': 'Meno', onclick: (e) => { e.stopPropagation(); changeQty(i, -1); } }, '−'),
          h('button', { class: 'icon', 'aria-label': 'Più', onclick: (e) => { e.stopPropagation(); changeQty(i, 1); } }, '+')));
    }) : [h('div', { class: 'empty', style: { margin: '14px', border: 'none' } }, 'Il carrello è vuoto')]));
    const t = calcCart(cart.items, cart.discount);
    sumEl.replaceChildren(...[
      h('div', { class: 'r' }, h('span', {}, `Articoli: ${qtyFmt(cart.items.reduce((s, l) => s + l.qty, 0))}`), h('span', {}, `Subtotale ${money(t.subtotal)}`)),
      t.discount > 0 ? h('div', { class: 'r' }, h('span', {}, 'Sconti'), h('span', {}, `-${money(t.discount)}`)) : null,
      h('div', { class: 'r' }, h('span', {}, 'di cui IVA'), h('span', {}, money(t.tax))),
      h('div', { class: 'big' }, h('span', {}, 'Totale'), h('span', {}, money(t.total)))].filter(Boolean));
    payBtn.disabled = cart.items.length === 0;
    drawHead();
  }

  function changeQty(i, d) {
    const l = cart.items[i];
    l.qty = round2(l.qty + d);
    if (l.qty <= 0) { cart.items.splice(i, 1); cart.selected = -1; }
    drawCart();
  }

  function editLine(i) {
    const l = cart.items[i];
    const qty = h('input', { type: 'text', inputmode: 'decimal', value: String(l.qty) });
    const price = h('input', { type: 'text', inputmode: 'decimal', value: String(l.price), disabled: !(can('pos.price_change') || l.allow_price_change) });
    const disc = h('input', { type: 'text', inputmode: 'decimal', value: String(l.discount_pct || 0), disabled: !can('pos.discount') });
    modal(l.name, (close) => {
      const apply = () => {
        const q = parseNum(qty.value);
        if (!(q > 0)) return toast('Quantità non valida', 'error');
        const d = parseNum(disc.value);
        if (d < 0 || d > 100) return toast('Sconto non valido', 'error');
        Object.assign(l, { qty: q, price: Math.max(0, parseNum(price.value)), discount_pct: d });
        close(); drawCart(); search.focus();
      };
      return h('form', { onsubmit: (e) => { e.preventDefault(); apply(); } },
        h('div', { class: 'form-grid' }, field('Quantità', qty), field('Prezzo unitario', price), field('Sconto riga %', disc)),
        h('div', { class: 'row between' },
          h('button', { type: 'button', class: 'danger', onclick: () => { cart.items.splice(i, 1); cart.selected = -1; close(); drawCart(); } }, 'Rimuovi'),
          h('button', { class: 'primary' }, 'Applica')));
    });
  }

  function freeItemModal() {
    const name = h('input', { placeholder: 'Descrizione' });
    const price = h('input', { inputmode: 'decimal', placeholder: '0,00' });
    const tax = select([{ value: 0, label: 'Esente' }], 0);
    get('/taxes').then((ts) => { tax.replaceChildren(...ts.filter((t) => t.active).map((t) => h('option', { value: t.rate }, t.name))); });
    modal('Riga libera', (close) => h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        if (!name.value.trim()) return toast('Inserisci una descrizione', 'error');
        cart.items.push({ product_id: null, name: name.value.trim(), qty: 1, price: parseNum(price.value), discount_pct: 0, tax_rate: Number(tax.value) });
        cart.selected = cart.items.length - 1;
        close(); drawCart();
      },
    }, field('Descrizione', name), field('Prezzo', price), field('IVA', tax), h('div', { class: 'row end' }, h('button', { class: 'primary' }, 'Aggiungi'))));
  }

  function discountModal() {
    const type = select([{ value: 'pct', label: '%' }, { value: 'amount', label: state.settings.currency || '€' }], cart.discount.type);
    const value = h('input', { inputmode: 'decimal', value: cart.discount.value || '' });
    modal('Sconto sul documento', (close) => h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        const v = Math.max(0, parseNum(value.value));
        if (type.value === 'pct' && v > 100) return toast('Percentuale non valida', 'error');
        cart.discount = { type: type.value, value: v };
        close(); drawCart();
      },
    }, h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Valore', value)), h('div', { style: { width: '90px' } }, field('Tipo', type))),
    h('div', { class: 'row end' }, h('button', { type: 'button', onclick: () => { cart.discount = { type: 'pct', value: 0 }; drawCart(); } }, 'Azzera'), h('button', { class: 'primary' }, 'Applica'))));
  }

  function noteModal() {
    const note = h('textarea', { rows: 3, value: cart.note });
    modal('Nota del documento', (close) => h('div', {}, field('Nota', note),
      h('div', { class: 'row end' }, h('button', { class: 'primary', onclick: () => { cart.note = note.value; close(); drawCart(); } }, 'Salva'))));
  }

  async function pickCustomer() {
    const list = h('div');
    const q = h('input', { placeholder: 'Cerca cliente…' });
    const load = async () => {
      const rows = await get(`/customers?q=${encodeURIComponent(q.value)}`);
      list.replaceChildren(...rows.map((c) => h('button', { style: { display: 'block', width: '100%', textAlign: 'left', marginTop: '6px' }, onclick: () => choose(c) },
        h('b', {}, c.name), c.discount_pct ? h('small', {}, `  sconto ${c.discount_pct}%`) : null, c.balance ? h('small', {}, `  da incassare ${money(c.balance)}`) : null)));
      if (!rows.length) list.append(h('div', { class: 'empty' }, 'Nessun cliente'));
    };
    let closeFn;
    const choose = (c) => {
      cart.partner = c;
      if (c.discount_pct > 0 && can('pos.discount')) cart.discount = { type: 'pct', value: c.discount_pct };
      closeFn(); drawCart();
    };
    closeFn = modal('Cliente', (close) => h('div', {}, q, list,
      h('div', { class: 'row end' },
        cart.partner ? h('button', { onclick: () => { cart.partner = null; close(); drawCart(); } }, 'Togli cliente') : null,
        h('button', { onclick: () => newCustomer(close) }, 'Nuovo cliente'))));
    q.addEventListener('input', debounce(load, 200));
    load();
  }

  function newCustomer(closePrev) {
    const name = h('input'); const tax = h('input'); const phone = h('input');
    modal('Nuovo cliente', (close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const c = await post('/customers', { name: name.value, tax_number: tax.value, phone: phone.value });
        close(); closePrev(); cart.partner = c; drawCart();
      },
    }, field('Nome', name), field('P.IVA / Codice fiscale', tax), field('Telefono', phone), h('div', { class: 'row end' }, h('button', { class: 'primary' }, 'Salva'))));
  }

  function clearCart() {
    Object.assign(cart, { id: null, items: [], partner: null, discount: { type: 'pct', value: 0 }, note: '', selected: -1 });
    drawCart();
  }

  async function holdCart() {
    if (!cart.items.length) return;
    try {
      await post('/documents', buildPayload({ hold: true }));
      toast('Documento messo in sospeso');
      clearCart();
    } catch { /* l'errore è già mostrato */ }
  }

  function buildPayload(extra = {}) {
    return {
      id: cart.id || undefined, type: 'sale', partner_id: cart.partner?.id || null, note: cart.note || null, discount: cart.discount,
      items: cart.items.map((l) => ({ product_id: l.product_id, name: l.name, qty: l.qty, price: l.price, discount_pct: l.discount_pct, tax_rate: l.tax_rate })),
      ...extra,
    };
  }

  async function heldList() {
    const rows = await get('/documents/held');
    modal('Documenti in sospeso', (close) => rows.length ? h('div', {}, rows.map((d) => h('div', { class: 'card row between', style: { marginBottom: '8px' } },
      h('div', {}, h('b', {}, money(d.total)), h('div', { class: 'muted' }, `${d.lines} righe · ${d.partner_name || 'Nessun cliente'} · ${d.user_name || ''}`)),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: async () => { await recall(d.id); close(); } }, 'Riprendi'),
        h('button', { class: 'danger', onclick: async () => { if (await confirmBox('Eliminare il documento in sospeso?', { danger: true, ok: 'Elimina' })) { await del(`/documents/${d.id}`); close(); heldList(); } } }, '✕'))))) : h('div', { class: 'empty' }, 'Nessun documento in sospeso'));
  }

  async function recall(id) {
    if (cart.items.length && !(await confirmBox('Il carrello attuale verrà sostituito. Continuare?'))) return;
    const d = await get(`/documents/${id}`);
    const partner = d.partner_id ? (await get('/customers')).find((c) => c.id === d.partner_id) || { id: d.partner_id, name: d.partner_name } : null;
    Object.assign(cart, {
      id: d.id, partner, note: d.note || '', discount: { type: d.discount_type, value: d.discount_value }, selected: -1,
      items: d.items.map((l) => ({ product_id: l.product_id, name: l.name, qty: l.qty, price: l.price, discount_pct: l.discount_pct, tax_rate: l.tax_rate })),
    });
    drawCart();
  }

  function openShiftModal() {
    const cash = h('input', { inputmode: 'decimal', value: '0' });
    modal('Apri turno di cassa', (close) => h('form', {
      onsubmit: async (e) => { e.preventDefault(); shift = await post('/shifts/open', { opening_cash: parseNum(cash.value) }); close(); drawShift(); search.focus(); },
    }, field('Fondo cassa iniziale', cash), h('div', { class: 'row end' }, h('button', { class: 'primary' }, 'Apri turno'))));
  }

  async function openPay() {
    if (!cart.items.length) return;
    if (!shift && state.settings.require_shift === '1') return openShiftModal();
    const types = (await get('/payment-types')).filter((p) => p.active);
    const t = calcCart(cart.items, cart.discount);
    const rows = [{ type: types.find((p) => p.is_cash) || types[0], amount: t.total }];
    let invoice = false;
    const body = h('div');
    let closeFn;

    const paidSum = () => round2(rows.reduce((s, r) => s + r.amount, 0));
    const draw = () => {
      const sum = paidSum();
      const diff = round2(sum - t.total);
      const canInvoice = Boolean(cart.partner);
      body.replaceChildren(
        h('div', { class: 'amount-big' }, money(t.total)),
        canInvoice ? h('label', { class: 'field check' }, h('input', { type: 'checkbox', checked: invoice, onchange: (e) => { invoice = e.target.checked; draw(); } }), h('span', {}, 'Emetti fattura')) : null,
        ...rows.map((r, i) => h('div', { class: 'row', style: { marginBottom: '6px' } },
          select(types.map((p) => ({ value: p.id, label: p.name })), r.type.id, { onchange: (e) => { r.type = types.find((p) => p.id === Number(e.target.value)); draw(); } }),
          h('input', { inputmode: 'decimal', value: String(r.amount), onchange: (e) => { r.amount = Math.max(0, round2(parseNum(e.target.value))); draw(); }, style: { textAlign: 'right' } }),
          rows.length > 1 ? h('button', { class: 'icon', onclick: () => { rows.splice(i, 1); draw(); } }, '✕') : null)),
        h('div', { class: 'quick' },
          ...(rows[0].type.is_cash ? [t.total, ...[5, 10, 20, 50, 100, 200].map((v) => Math.ceil(t.total / v) * v)].filter((v, i, a) => a.indexOf(v) === i).slice(0, 5)
            .map((v) => h('button', { onclick: () => { rows[0].amount = v; draw(); } }, money(v))) : []),
          h('button', { onclick: () => { const left = round2(t.total - paidSum()); if (left > 0) rows.push({ type: types.find((p) => !p.is_cash) || types[0], amount: left }); draw(); } }, '＋ Dividi pagamento')),
        diff > 0.004 ? h('div', { class: 'change' }, `Resto ${money(diff)}`) : diff < -0.004 ? h('div', { class: 'change', style: { color: 'var(--danger)' } }, `Mancano ${money(-diff)}`) : null,
        h('div', { class: 'row end' },
          h('button', { onclick: () => closeFn() }, 'Annulla'),
          h('button', { class: 'primary', id: 'confirm-pay', disabled: sum < t.total - 0.004 && !invoice, onclick: confirm }, invoice ? 'Emetti fattura' : 'Conferma pagamento')));
      document.getElementById('confirm-pay')?.focus();
    };

    async function confirm() {
      const btn = document.getElementById('confirm-pay');
      btn.disabled = true;
      try {
        const doc = await post('/documents', buildPayload({
          type: invoice ? 'invoice' : 'sale',
          payments: rows.filter((r) => r.amount > 0).map((r) => ({ payment_type_id: r.type.id, amount: r.amount })),
        }));
        closeFn();
        clearCart();
        products = await get('/products?limit=5000');
        drawTiles();
        shift = await get('/shifts/current');
        drawShift();
        done(doc);
      } catch { btn.disabled = false; }
    }

    closeFn = modal('Pagamento', () => body);
    draw();
  }

  function done(doc) {
    let autoPrint = false;
    try { autoPrint = localStorage.getItem('pos_autoprint') === '1'; } catch { /* ignora */ }
    if (autoPrint) printDocument(doc);
    modal(`Documento ${doc.number}`, (close) => h('div', {},
      doc.change_given > 0 ? h('div', { class: 'change', style: { fontSize: '30px', margin: '10px 0' } }, `Resto ${money(doc.change_given)}`) : h('div', { class: 'change' }, 'Pagamento registrato'),
      h('div', { class: 'row end' },
        h('button', { onclick: () => printDocument(doc) }, '🖨 Stampa'),
        doc.type === 'invoice' ? h('button', { onclick: () => printA4(doc) }, '📄 Fattura A4') : null,
        h('button', { class: 'primary', onclick: () => { close(); search.focus(); } }, 'Nuova vendita'))));
  }

  document.addEventListener('keydown', onHotkey);
  function onHotkey(e) {
    if (!document.body.contains(root)) return document.removeEventListener('keydown', onHotkey);
    if (document.querySelector('.overlay')) return;
    if (e.key === 'F2') { e.preventDefault(); openPay(); }
    if (e.key === 'F4') { e.preventDefault(); search.focus(); search.select(); }
    if (e.key === 'F6') { e.preventDefault(); holdCart(); }
  }

  root.replaceChildren(h('div', { class: 'pos' },
    h('div', { class: 'pos-left' }, h('div', { class: 'pos-top' }, search), tabs, tiles),
    h('div', { class: 'pos-right' }, shiftBar, headEl, cartEl,
      h('div', { class: 'cart-tools' },
        h('button', { onclick: () => cart.selected >= 0 && editLine(cart.selected), disabled: false }, 'Modifica riga'),
        h('label', { class: 'row', style: { fontSize: '13px' } },
          h('input', { type: 'checkbox', checked: (() => { try { return localStorage.getItem('pos_autoprint') === '1'; } catch { return false; } })(), onchange: (e) => { try { localStorage.setItem('pos_autoprint', e.target.checked ? '1' : '0'); } catch { /* ignora */ } } }),
          'Stampa automatica')),
      sumEl, payBtn)));
  drawTabs(); drawTiles(); drawCart(); drawShift();
  search.focus();
  if (!shift && state.settings.require_shift === '1') openShiftModal();
}
