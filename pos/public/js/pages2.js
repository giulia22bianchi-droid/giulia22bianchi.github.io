import { h, state, money, qtyFmt, parseNum, can, toast, modal, confirmBox, field, select, table, downloadCsv, debounce, dateFmt, todayStr } from './ui.js';
import { get, post, put, del, download, session } from './api.js';
import { printShiftReport, DOC_LABELS } from './print.js';
import { showDocument, statusBadge } from './pages.js';

const head = (title, ...actions) => h('div', { class: 'page-head' }, h('h2', {}, title), h('div', { class: 'row' }, ...actions));
const stat = (label, value, neg) => h('div', { class: 'card stat' }, h('div', { class: 'label' }, label), h('div', { class: `value${neg ? ' neg' : ''}` }, value));

// ---------------- Acquisti ----------------
export async function renderPurchases(root) {
  const [suppliers, payTypes] = await Promise.all([get('/suppliers'), get('/payment-types')]);
  const lines = [];
  const supplier = select([{ value: '', label: '— scegli fornitore —' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))], '');
  const note = h('input', { placeholder: 'Nota / numero DDT' });
  const search = h('input', { placeholder: 'Aggiungi prodotto: nome, codice o barcode…' });
  const results = h('div');
  const linesEl = h('div');
  const totalEl = h('b');
  const paid = h('input', { inputmode: 'decimal', placeholder: '0,00', style: { width: '120px' } });
  const payType = select(payTypes.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name })), payTypes[0]?.id);
  const listEl = h('div');

  const drawLines = () => {
    linesEl.replaceChildren(lines.length ? table([
      { label: 'Prodotto', render: (l) => l.name },
      { label: 'Quantità', render: (l) => h('input', { type: 'number', min: 0, step: 'any', value: l.qty, style: { width: '100px' }, oninput: (e) => { l.qty = parseNum(e.target.value); drawTotal(); } }) },
      { label: `Costo unitario (${state.settings.prices_include_tax === '1' ? 'IVA incl.' : 'IVA escl.'})`, render: (l) => h('input', { type: 'number', min: 0, step: 'any', value: l.price, style: { width: '120px' }, oninput: (e) => { l.price = parseNum(e.target.value); drawTotal(); } }) },
      { label: '', render: (l) => h('button', { class: 'icon', onclick: () => { lines.splice(lines.indexOf(l), 1); drawLines(); } }, '✕') },
    ], lines) : h('div', { class: 'empty' }, 'Nessuna riga'));
    drawTotal();
  };
  const drawTotal = () => { totalEl.textContent = `Totale ${money(lines.reduce((s, l) => s + l.qty * l.price, 0))} (IVA ${state.settings.prices_include_tax === '1' ? 'inclusa' : 'esclusa'}, calcolata al salvataggio)`; };

  search.oninput = debounce(async () => {
    if (!search.value.trim()) return results.replaceChildren();
    const rows = (await get(`/products?q=${encodeURIComponent(search.value)}&limit=8`));
    results.replaceChildren(...rows.map((p) => h('button', { style: { margin: '0 6px 6px 0' }, onclick: () => {
      lines.push({ product_id: p.id, name: p.name, qty: 1, price: p.cost }); search.value = ''; results.replaceChildren(); drawLines();
    } }, `${p.name} (${qtyFmt(p.stock)})`)));
  }, 200);

  async function save() {
    if (!supplier.value) return toast('Scegli il fornitore', 'error');
    if (!lines.length || lines.some((l) => !(l.qty > 0))) return toast('Controlla le righe', 'error');
    const amount = parseNum(paid.value);
    try {
      const doc = await post('/documents', {
        type: 'purchase', partner_id: Number(supplier.value), note: note.value || null,
        items: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, price: l.price })),
        payments: amount > 0 ? [{ payment_type_id: Number(payType.value), amount }] : [],
      });
      toast(`Acquisto ${doc.number} registrato`);
      lines.length = 0; note.value = ''; paid.value = ''; drawLines(); loadList();
    } catch { /* mostrato */ }
  }

  async function loadList() {
    const rows = await get('/documents?type=purchase&limit=30');
    listEl.replaceChildren(table([
      { label: 'Numero', render: (r) => r.number }, { label: 'Data', render: (r) => dateFmt(r.date) }, { label: 'Fornitore', render: (r) => r.partner_name || '' },
      { label: 'Stato', render: statusBadge }, { label: 'Totale', align: 'right', render: (r) => money(r.total) },
    ], rows, { onRow: (r) => showDocument(r.id, loadList), empty: 'Nessun acquisto registrato' }));
  }

  root.replaceChildren(head('Acquisti / carico merce'),
    h('div', { class: 'card', style: { marginBottom: '16px' } },
      h('div', { class: 'form-grid' }, field('Fornitore', supplier), field('Nota', note)), field('Prodotti', search), results, linesEl,
      h('div', { class: 'row between', style: { marginTop: '10px' } }, totalEl,
        h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Pagato ora'), paid, payType, h('button', { class: 'primary', onclick: save }, 'Registra acquisto')))),
    h('h3', {}, 'Ultimi acquisti'), listEl);
  drawLines(); loadList();
}

// ---------------- Magazzino ----------------
export async function renderStock(root) {
  const listEl = h('div');
  const q = h('input', { class: 'search', placeholder: 'Cerca prodotto…' });
  const lowChk = h('input', { type: 'checkbox' });
  const counts = new Map();
  let rows = [];
  async function load() {
    rows = (await get(`/products?q=${encodeURIComponent(q.value)}&low=${lowChk.checked ? 1 : 0}&limit=2000`)).filter((p) => p.track_stock);
    listEl.replaceChildren(table([
      { label: 'Prodotto', render: (r) => r.name }, { label: 'Codice', render: (r) => r.code || '' },
      { label: 'Giacenza', align: 'right', render: (r) => h('span', { class: r.stock <= r.min_stock ? 'badge bad' : '' }, `${qtyFmt(r.stock)} ${r.unit}`), csv: (r) => r.stock },
      { label: 'Minima', align: 'right', render: (r) => qtyFmt(r.min_stock) },
      { label: 'Valore costo', align: 'right', render: (r) => money(r.stock * r.cost), csv: (r) => r.stock * r.cost },
      { label: 'Contato', render: (r) => h('input', { type: 'number', min: 0, step: 'any', style: { width: '100px' }, value: counts.get(r.id) ?? '', disabled: !can('stock.adjust'),
        oninput: (e) => { e.target.value === '' ? counts.delete(r.id) : counts.set(r.id, parseNum(e.target.value)); } }), csv: () => '' },
      { label: '', render: (r) => h('button', { class: 'ghost', onclick: () => movements(r) }, 'Storico'), csv: () => '' },
    ], rows, { empty: 'Nessun prodotto con giacenza gestita' }));
    listEl._cols = [{ label: 'Prodotto', render: (r) => r.name }, { label: 'Codice', render: (r) => r.code || '' }, { label: 'Giacenza', csv: (r) => r.stock, render: (r) => r.stock }, { label: 'Costo', render: (r) => r.cost }];
  }
  async function movements(p) {
    const rows = await get(`/stock/movements?product_id=${p.id}`);
    modal(`Movimenti: ${p.name}`, () => table([
      { label: 'Data', render: (r) => dateFmt(r.created_at) }, { label: 'Motivo', render: (r) => r.reason }, { label: 'Documento', render: (r) => r.document_number || '' },
      { label: 'Operatore', render: (r) => r.user_name || '' }, { label: 'Quantità', align: 'right', render: (r) => (r.qty > 0 ? '+' : '') + qtyFmt(r.qty) },
    ], rows, { empty: 'Nessun movimento' }), { wide: true });
  }
  async function saveCount() {
    const list = [...counts].map(([product_id, counted]) => ({ product_id, counted }));
    if (!list.length) return toast('Inserisci almeno una quantità contata', 'error');
    if (!(await confirmBox(`Allineare la giacenza di ${list.length} prodotti ai valori contati?`))) return;
    const r = await post('/stock/count', { counts: list });
    counts.clear();
    toast(r.changed ? `${r.changed} giacenze rettificate` : 'Nessuna differenza');
    load();
  }
  root.replaceChildren(head('Magazzino',
    h('button', { onclick: () => downloadCsv('magazzino.csv', listEl._cols || [], rows) }, 'Esporta CSV'),
    can('stock.adjust') ? h('button', { class: 'primary', onclick: saveCount }, 'Registra inventario') : null),
  h('div', { class: 'toolbar' }, q, h('label', { class: 'row' }, lowChk, 'Solo sotto scorta')), listEl);
  q.oninput = debounce(load, 200); lowChk.onchange = load;
  load();
}

// ---------------- Cassa / turni ----------------
export async function renderRegister(root) {
  const el = h('div');
  const pastEl = h('div');
  async function load() {
    const cur = await get('/shifts/current');
    if (!cur) {
      const cash = h('input', { inputmode: 'decimal', value: '0', style: { maxWidth: '160px' } });
      el.replaceChildren(h('div', { class: 'card' }, h('h3', {}, 'Nessun turno aperto'), field('Fondo cassa iniziale', cash),
        can('pos.sell') ? h('button', { class: 'primary', onclick: async () => { await post('/shifts/open', { opening_cash: parseNum(cash.value) }); load(); } }, 'Apri turno') : null));
    } else {
      el.replaceChildren(
        h('div', { class: 'cards' }, stat('Turno aperto', dateFmt(cur.shift.opened_at)), stat('Documenti', cur.documents.count), stat('Venduto netto', money(cur.documents.net)),
          stat('Contante atteso', money(cur.expected_cash))),
        h('div', { class: 'card' }, h('h3', {}, 'Incassi per metodo'), table([
          { label: 'Metodo', render: (p) => p.name }, { label: 'Incassi', align: 'right', render: (p) => money(p.sales) }, { label: 'Rimborsi', align: 'right', render: (p) => money(p.refunds) }], cur.by_payment, { empty: 'Nessun incasso' }),
        h('p', { class: 'muted' }, `Fondo ${money(cur.shift.opening_cash)} · versamenti ${money(cur.cash_in)} · prelievi ${money(cur.cash_out)}`),
        cur.movements.length ? table([{ label: 'Ora', render: (m) => dateFmt(m.created_at) }, { label: 'Tipo', render: (m) => (m.type === 'in' ? 'Versamento' : 'Prelievo') }, { label: 'Motivo', render: (m) => m.reason || '' }, { label: 'Importo', align: 'right', render: (m) => money(m.amount) }], cur.movements) : null,
        h('div', { class: 'row end' },
          h('button', { onclick: () => printShiftReport(cur) }, '🖨 Lettura X'),
          can('register.manage') ? h('button', { onclick: () => movement(cur) }, 'Versamento / prelievo') : null,
          can('register.manage') ? h('button', { class: 'danger', onclick: () => closeShift(cur) }, 'Chiudi turno') : null)));
    }
    if (can('reports.view')) {
      const past = await get('/shifts');
      pastEl.replaceChildren(h('h3', {}, 'Turni precedenti'), table([
        { label: '#', render: (s) => s.id }, { label: 'Operatore', render: (s) => s.user_name }, { label: 'Apertura', render: (s) => dateFmt(s.opened_at) }, { label: 'Chiusura', render: (s) => (s.closed_at ? dateFmt(s.closed_at) : 'aperto') },
        { label: 'Atteso', align: 'right', render: (s) => (s.expected_cash === null ? '' : money(s.expected_cash)) }, { label: 'Contato', align: 'right', render: (s) => (s.counted_cash === null ? '' : money(s.counted_cash)) },
        { label: 'Differenza', align: 'right', render: (s) => (s.counted_cash === null || s.expected_cash === null ? '' : h('span', { class: Math.abs(s.counted_cash - s.expected_cash) > 0.004 ? 'badge bad' : 'badge ok' }, money(s.counted_cash - s.expected_cash))) },
      ], past, { onRow: async (s) => printShiftReport(await get(`/shifts/${s.id}/report`)) }), h('small', {}, 'Clicca un turno per stampare il rapporto.'));
    }
  }
  function movement(cur) {
    const type = select([{ value: 'in', label: 'Versamento (entrata)' }, { value: 'out', label: 'Prelievo (uscita)' }], 'in');
    const amount = h('input', { inputmode: 'decimal' }); const reason = h('input', { placeholder: 'Motivo' });
    modal('Movimento di cassa', (close) => h('form', {
      onsubmit: async (e) => { e.preventDefault(); try { await post('/shifts/cash-movement', { type: type.value, amount: parseNum(amount.value), reason: reason.value }); close(); load(); } catch { /* */ } },
    }, field('Tipo', type), field('Importo', amount), field('Motivo', reason), h('div', { class: 'row end' }, h('button', { class: 'primary' }, 'Registra'))));
  }
  function closeShift(cur) {
    const counted = h('input', { inputmode: 'decimal', placeholder: String(cur.expected_cash) }); const note = h('input');
    modal('Chiudi turno', (close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try { const r = await post('/shifts/close', { counted_cash: counted.value === '' ? '' : parseNum(counted.value), note: note.value }); close(); load(); printShiftReport(r); } catch { /* */ }
      },
    }, h('p', {}, `Contante atteso nel cassetto: `, h('b', {}, money(cur.expected_cash))), field('Contante contato', counted, 'Lascia vuoto per non registrare la differenza'), field('Nota', note),
    h('div', { class: 'row end' }, h('button', { class: 'danger' }, 'Chiudi e stampa'))));
  }
  root.replaceChildren(head('Cassa e turni'), el, h('div', { style: { height: '20px' } }), pastEl);
  load();
}

// ---------------- Report ----------------
export async function renderReports(root) {
  const from = h('input', { type: 'date', value: todayStr() }); const to = h('input', { type: 'date', value: todayStr() });
  let tab = 'summary';
  const out = h('div');
  const tabsEl = h('div', { class: 'toolbar' });
  const TABS = [['summary', 'Riepilogo'], ['daily', 'Per giorno'], ['hourly', 'Per ora'], ['products', 'Prodotti'], ['groups', 'Gruppi'], ['users', 'Operatori'], ['customers', 'Clienti'], ['taxes', 'IVA'], ['stock', 'Magazzino']];
  const preset = (days, kind) => () => {
    const d = new Date(); const fmt = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    if (kind === 'month') { from.value = fmt(new Date(d.getFullYear(), d.getMonth(), 1)); to.value = fmt(d); }
    else if (kind === 'year') { from.value = fmt(new Date(d.getFullYear(), 0, 1)); to.value = fmt(d); }
    else { const s = new Date(d); s.setDate(s.getDate() - days); from.value = fmt(s); to.value = days === 1 ? fmt(s) : fmt(d); }
    load();
  };
  const drawTabs = () => tabsEl.replaceChildren(...TABS.map(([k, l]) => h('button', { class: tab === k ? 'primary' : '', onclick: () => { tab = k; drawTabs(); load(); } }, l)));

  async function load() {
    const qs = `from=${from.value}&to=${to.value}`;
    out.replaceChildren(h('p', { class: 'muted' }, 'Caricamento…'));
    if (tab === 'summary') {
      const s = await get(`/reports/summary?${qs}`);
      out.replaceChildren(h('div', { class: 'cards' }, stat('Venduto netto', money(s.net)), stat('Documenti', s.documents), stat('Scontrino medio', money(s.average_ticket)), stat('Resi', money(s.refunded), s.refunded > 0),
        stat('IVA', money(s.tax)), stat('Sconti concessi', money(s.discounts)), stat('Costo del venduto', money(s.cost)), stat('Margine lordo', money(s.profit), s.profit < 0),
        stat('Acquisti nel periodo', money(s.purchases.total)), stat('Crediti verso clienti', money(s.receivable)), stat('Debiti verso fornitori', money(s.payable))),
      h('h3', {}, 'Per metodo di pagamento'), table([{ label: 'Metodo', render: (p) => p.name }, { label: 'Importo', align: 'right', render: (p) => money(p.amount) }], s.payments, { empty: 'Nessun incasso nel periodo' }));
      return;
    }
    if (tab === 'stock') {
      const s = await get('/reports/stock');
      out.replaceChildren(h('div', { class: 'cards' }, stat('Valore a costo', money(s.cost_value)), stat('Valore a prezzo', money(s.retail_value)), stat('Sotto scorta', s.low.length, s.low.length > 0)),
        h('div', { class: 'toolbar' }, h('button', { onclick: () => downloadCsv('report-magazzino.csv', STOCK_COLS, s.products) }, 'Esporta CSV')),
        h('h3', {}, 'Da riordinare'), table(STOCK_COLS, s.low, { empty: 'Nessun prodotto sotto scorta' }));
      return;
    }
    const rows = await get(`/reports/${tab}?${qs}`);
    const defs = {
      daily: [{ label: 'Giorno', render: (r) => r.day }, { label: 'Documenti', align: 'right', render: (r) => r.documents }, { label: 'IVA', align: 'right', render: (r) => money(r.tax), csv: (r) => r.tax }, { label: 'Totale', align: 'right', render: (r) => money(r.total), csv: (r) => r.total }],
      hourly: [{ label: 'Ora', render: (r) => `${r.hour}:00` }, { label: 'Documenti', align: 'right', render: (r) => r.documents }, { label: 'Totale', align: 'right', render: (r) => money(r.total), csv: (r) => r.total }],
      products: [{ label: 'Prodotto', render: (r) => r.name }, { label: 'Quantità', align: 'right', render: (r) => qtyFmt(r.qty) }, { label: 'Totale', align: 'right', render: (r) => money(r.total), csv: (r) => r.total }, { label: 'Margine', align: 'right', render: (r) => money(r.profit), csv: (r) => r.profit }],
      groups: [{ label: 'Gruppo', render: (r) => r.name }, { label: 'Quantità', align: 'right', render: (r) => qtyFmt(r.qty) }, { label: 'Totale', align: 'right', render: (r) => money(r.total), csv: (r) => r.total }, { label: 'Margine', align: 'right', render: (r) => money(r.profit), csv: (r) => r.profit }],
      users: [{ label: 'Operatore', render: (r) => r.name }, { label: 'Documenti', align: 'right', render: (r) => r.documents }, { label: 'Sconti', align: 'right', render: (r) => money(r.discounts), csv: (r) => r.discounts }, { label: 'Totale', align: 'right', render: (r) => money(r.total), csv: (r) => r.total }],
      customers: [{ label: 'Cliente', render: (r) => r.name }, { label: 'Documenti', align: 'right', render: (r) => r.documents }, { label: 'Totale', align: 'right', render: (r) => money(r.total), csv: (r) => r.total }],
      taxes: [{ label: 'Aliquota', render: (r) => r.rate + '%' }, { label: 'Imponibile', align: 'right', render: (r) => money(r.net), csv: (r) => r.net }, { label: 'Imposta', align: 'right', render: (r) => money(r.tax), csv: (r) => r.tax }, { label: 'Totale', align: 'right', render: (r) => money(r.total), csv: (r) => r.total }],
    }[tab];
    const max = Math.max(...rows.map((r) => Math.abs(r.total || 0)), 1);
    out.replaceChildren(h('div', { class: 'toolbar' }, h('button', { onclick: () => downloadCsv(`report-${tab}.csv`, defs, rows) }, 'Esporta CSV')),
      tab === 'daily' && rows.length ? h('div', { class: 'card', style: { marginBottom: '12px', display: 'flex', alignItems: 'flex-end', gap: '4px', height: '140px' } },
        ...rows.map((r) => h('div', { title: `${r.day}: ${money(r.total)}`, style: { flex: 1, background: 'var(--primary)', borderRadius: '3px 3px 0 0', height: `${Math.max(2, (Math.abs(r.total) / max) * 100)}%` } }))) : null,
      table(defs, rows, { empty: 'Nessun dato nel periodo' }));
  }
  const STOCK_COLS = [{ label: 'Prodotto', render: (r) => r.name }, { label: 'Gruppo', render: (r) => r.group_name || '' }, { label: 'Giacenza', align: 'right', render: (r) => qtyFmt(r.stock), csv: (r) => r.stock },
    { label: 'Minima', align: 'right', render: (r) => qtyFmt(r.min_stock), csv: (r) => r.min_stock }, { label: 'Valore costo', align: 'right', render: (r) => money(r.cost_value), csv: (r) => r.cost_value }, { label: 'Valore prezzo', align: 'right', render: (r) => money(r.retail_value), csv: (r) => r.retail_value }];

  root.replaceChildren(head('Report'),
    h('div', { class: 'toolbar' }, h('label', { class: 'row' }, 'Dal', from), h('label', { class: 'row' }, 'al', to),
      h('button', { onclick: preset(0) }, 'Oggi'), h('button', { onclick: preset(1) }, 'Ieri'), h('button', { onclick: preset(7) }, '7 giorni'), h('button', { onclick: preset(0, 'month') }, 'Mese'), h('button', { onclick: preset(0, 'year') }, 'Anno')),
    tabsEl, out);
  from.onchange = load; to.onchange = load;
  drawTabs(); load();
}

// ---------------- Utenti e ruoli ----------------
export async function renderUsers(root) {
  const el = h('div');
  async function load() {
    const [users, roles, perms] = await Promise.all([get('/users'), get('/roles'), get('/permissions')]);
    el.replaceChildren(
      h('h3', {}, 'Utenti'), table([{ label: 'Utente', render: (u) => u.username }, { label: 'Nome', render: (u) => u.name }, { label: 'Ruolo', render: (u) => u.role },
        { label: 'Stato', render: (u) => (u.active ? h('span', { class: 'badge ok' }, 'Attivo') : h('span', { class: 'badge bad' }, 'Disattivato')) }], users, { onRow: (u) => editUser(u, roles) }),
      h('div', { style: { height: '20px' } }),
      h('div', { class: 'page-head' }, h('h3', {}, 'Ruoli e permessi'), h('button', { onclick: () => editRole(null, perms) }, '＋ Nuovo ruolo')),
      table([{ label: 'Ruolo', render: (r) => r.name }, { label: 'Permessi', render: (r) => `${r.permissions.length} di ${Object.keys(perms).length}` }], roles, { onRow: (r) => editRole(r, perms) }));
    el._roles = roles;
  }
  function editUser(u, roles) {
    const f = { username: h('input', { value: u?.username || '', disabled: Boolean(u) }), name: h('input', { value: u?.name || '' }), password: h('input', { type: 'password', placeholder: u ? 'Lascia vuoto per non cambiarla' : '', autocomplete: 'new-password' }),
      role: select(roles.map((r) => ({ value: r.id, label: r.name })), u?.role_id ?? roles[roles.length - 1].id) };
    const active = h('input', { type: 'checkbox', checked: u ? Boolean(u.active) : true });
    modal(u ? 'Modifica utente' : 'Nuovo utente', (close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const body = { username: f.username.value, name: f.name.value, role_id: Number(f.role.value), password: f.password.value, active: active.checked };
        try { u ? await put(`/users/${u.id}`, body) : await post('/users', body); close(); load(); toast('Utente salvato'); } catch { /* */ }
      },
    }, field('Nome utente', f.username), field('Nome', f.name), field('Password', f.password), field('Ruolo', f.role), h('label', { class: 'field check' }, active, h('span', {}, 'Attivo')), h('div', { class: 'row end' }, h('button', { class: 'primary' }, 'Salva'))));
  }
  function editRole(r, perms) {
    const name = h('input', { value: r?.name || '' });
    const boxes = Object.entries(perms).map(([k, label]) => ({ k, input: h('input', { type: 'checkbox', checked: r ? r.permissions.includes(k) : false }), label }));
    modal(r ? 'Modifica ruolo' : 'Nuovo ruolo', (close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const body = { name: name.value, permissions: boxes.filter((b) => b.input.checked).map((b) => b.k) };
        try { r ? await put(`/roles/${r.id}`, body) : await post('/roles', body); close(); load(); } catch { /* */ }
      },
    }, field('Nome ruolo', name), ...boxes.map((b) => h('label', { class: 'field check' }, b.input, h('span', {}, b.label))),
    h('div', { class: 'row between' }, r ? h('button', { type: 'button', class: 'danger', onclick: async () => { if (await confirmBox('Eliminare il ruolo?', { danger: true, ok: 'Elimina' })) { try { await del(`/roles/${r.id}`); close(); load(); } catch { /* */ } } } }, 'Elimina') : h('span'), h('button', { class: 'primary' }, 'Salva'))));
  }
  root.replaceChildren(head('Utenti', h('button', { class: 'primary', onclick: async () => editUser(null, await get('/roles')) }, '＋ Nuovo utente')), el);
  load();
}

// ---------------- Impostazioni ----------------
export async function renderSettings(root) {
  const settings = await get('/settings');
  const canEdit = can('settings.manage');
  const text = (k) => h('input', { value: settings[k] ?? '', disabled: !canEdit });
  const f = Object.fromEntries(['company_name', 'company_address', 'company_tax_number', 'company_phone', 'currency', 'sale_prefix', 'invoice_prefix', 'refund_prefix', 'purchase_prefix', 'adjustment_prefix'].map((k) => [k, text(k)]));
  f.receipt_header = h('textarea', { rows: 2, value: settings.receipt_header || '', disabled: !canEdit });
  f.receipt_footer = h('textarea', { rows: 2, value: settings.receipt_footer || '', disabled: !canEdit });
  const flag = (k, label) => { const i = h('input', { type: 'checkbox', checked: settings[k] === '1', disabled: !canEdit }); return { k, i, el: h('label', { class: 'field check' }, i, h('span', {}, label)) }; };
  const flags = [flag('prices_include_tax', 'I prezzi includono l\'IVA'), flag('require_shift', 'Richiedi un turno di cassa aperto per vendere'), flag('allow_negative_stock', 'Permetti vendite con giacenza insufficiente')];
  const tax = h('div'); const pay = h('div');

  async function save() {
    const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
    for (const fl of flags) body[fl.k] = fl.i.checked ? '1' : '0';
    Object.assign(state.settings, await put('/settings', body));
    toast('Impostazioni salvate');
  }
  async function loadLists() {
    const [taxes, types] = await Promise.all([get('/taxes'), get('/payment-types')]);
    tax.replaceChildren(table([{ label: 'Nome', render: (t) => t.name }, { label: 'Aliquota', align: 'right', render: (t) => t.rate + '%' }, { label: 'Stato', render: (t) => (t.active ? 'Attiva' : 'Archiviata') }], taxes, { onRow: canEdit ? editTax : null }));
    pay.replaceChildren(table([{ label: 'Nome', render: (t) => t.name }, { label: 'Contanti', render: (t) => (t.is_cash ? 'Sì' : '') }, { label: 'Stato', render: (t) => (t.active ? 'Attivo' : 'Archiviato') }], types, { onRow: canEdit ? editPay : null }));
  }
  function editTax(t) {
    const name = h('input', { value: t?.name || '' }); const rate = h('input', { inputmode: 'decimal', value: t?.rate ?? '' });
    modal(t ? 'Modifica aliquota' : 'Nuova aliquota', (close) => h('form', {
      onsubmit: async (e) => { e.preventDefault(); try { t ? await put(`/taxes/${t.id}`, { name: name.value, rate: parseNum(rate.value), active: true }) : await post('/taxes', { name: name.value, rate: parseNum(rate.value) }); close(); loadLists(); } catch { /* */ } },
    }, field('Nome', name), field('Aliquota %', rate), h('div', { class: 'row between' }, t ? h('button', { type: 'button', class: 'danger', onclick: async () => { await del(`/taxes/${t.id}`); close(); loadLists(); } }, 'Elimina') : h('span'), h('button', { class: 'primary' }, 'Salva'))));
  }
  function editPay(t) {
    const name = h('input', { value: t?.name || '' }); const cash = h('input', { type: 'checkbox', checked: Boolean(t?.is_cash) });
    modal(t ? 'Modifica metodo' : 'Nuovo metodo di pagamento', (close) => h('form', {
      onsubmit: async (e) => { e.preventDefault(); try { t ? await put(`/payment-types/${t.id}`, { name: name.value, is_cash: cash.checked, active: true, position: 50 }) : await post('/payment-types', { name: name.value, is_cash: cash.checked }); close(); loadLists(); } catch { /* */ } },
    }, field('Nome', name), h('label', { class: 'field check' }, cash, h('span', {}, 'È un pagamento in contanti (consente il resto)')),
    h('div', { class: 'row between' }, t ? h('button', { type: 'button', class: 'danger', onclick: async () => { await del(`/payment-types/${t.id}`); close(); loadLists(); } }, 'Elimina') : h('span'), h('button', { class: 'primary' }, 'Salva'))));
  }
  function passwordCard() {
    const cur = h('input', { type: 'password', autocomplete: 'current-password' }); const next = h('input', { type: 'password', autocomplete: 'new-password' });
    return h('div', { class: 'card' }, h('h3', {}, 'La mia password'), h('form', {
      onsubmit: async (e) => { e.preventDefault(); const r = await post('/me/password', { current: cur.value, password: next.value }); session.set(r.token); cur.value = next.value = ''; toast('Password cambiata'); },
    }, field('Password attuale', cur), field('Nuova password', next), h('button', { class: 'primary' }, 'Cambia password')));
  }
  const restoreInput = h('input', { type: 'file', accept: '.db', style: { display: 'none' }, onchange: async (e) => {
    const file = e.target.files[0];
    if (!file || !(await confirmBox('Il ripristino sostituirà TUTTI i dati attuali al prossimo riavvio del server. Continuare?', { danger: true, ok: 'Carica backup' }))) return;
    const r = await post('/restore', file, { raw: true }).catch(() => null);
    if (r) modal('Backup caricato', () => h('p', {}, r.message));
  } });

  root.replaceChildren(head('Impostazioni', canEdit ? h('button', { class: 'primary', onclick: save }, 'Salva') : null),
    canEdit ? h('div', { class: 'card', style: { marginBottom: '14px' } }, h('h3', {}, 'Attività e scontrino'),
      h('div', { class: 'form-grid' }, field('Ragione sociale', f.company_name), field('P.IVA', f.company_tax_number), field('Indirizzo', f.company_address), field('Telefono', f.company_phone), field('Simbolo valuta', f.currency)),
      field('Intestazione scontrino', f.receipt_header), field('Piè di pagina scontrino', f.receipt_footer), ...flags.map((x) => x.el),
      h('h4', {}, 'Prefissi di numerazione'), h('div', { class: 'form-grid' }, field('Vendite', f.sale_prefix), field('Fatture', f.invoice_prefix), field('Resi', f.refund_prefix), field('Acquisti', f.purchase_prefix), field('Rettifiche', f.adjustment_prefix))) : null,
    canEdit ? h('div', { class: 'cards', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' } },
      h('div', {}, h('div', { class: 'page-head' }, h('h3', {}, 'Aliquote IVA'), h('button', { onclick: () => editTax(null) }, '＋')), tax),
      h('div', {}, h('div', { class: 'page-head' }, h('h3', {}, 'Metodi di pagamento'), h('button', { onclick: () => editPay(null) }, '＋')), pay)) : null,
    canEdit ? h('div', { class: 'card', style: { margin: '14px 0' } }, h('h3', {}, 'Backup'),
      h('p', { class: 'muted' }, 'Scarica regolarmente una copia del database. Il ripristino avviene al riavvio del server.'),
      h('div', { class: 'row' }, h('button', { onclick: () => download('/backup', `pos-backup-${todayStr()}.db`) }, 'Scarica backup'), h('button', { onclick: () => restoreInput.click() }, 'Ripristina da file'), restoreInput)) : null,
    passwordCard());
  if (canEdit) loadLists();
}
