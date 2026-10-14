import { h, state, money, qtyFmt, parseNum, can, toast, modal, confirmBox, field, select, table, downloadCsv, parseCsv, debounce, dateFmt, todayStr } from './ui.js';
import { get, post, put, del } from './api.js';
import { printDocument, printA4, printLabels, DOC_LABELS } from './print.js';

const head = (title, ...actions) => h('div', { class: 'page-head' }, h('h2', {}, title), h('div', { class: 'row' }, ...actions));

// ---------------- Prodotti ----------------
export async function renderProducts(root) {
  const [groups, taxes, suppliers] = await Promise.all([get('/groups'), get('/taxes'), get('/suppliers')]);
  const listEl = h('div');
  const q = h('input', { class: 'search', placeholder: 'Cerca per nome, codice o barcode…' });
  const groupSel = select([{ value: '', label: 'Tutti i gruppi' }, ...groups.map((g) => ({ value: g.id, label: g.name }))], '');
  const lowChk = h('input', { type: 'checkbox' });
  const allChk = h('input', { type: 'checkbox' });
  let rows = [];
  const selected = new Set();

  async function load() {
    const params = new URLSearchParams({ q: q.value, group_id: groupSel.value, low: lowChk.checked ? '1' : '0', all: allChk.checked ? '1' : '0' });
    rows = await get(`/products?${params}`);
    const cols = [
      { label: '', render: (r) => h('input', { type: 'checkbox', checked: selected.has(r.id), onclick: (e) => e.stopPropagation(), onchange: (e) => { e.target.checked ? selected.add(r.id) : selected.delete(r.id); } }), csv: () => '' },
      { label: 'Nome', render: (r) => h('span', {}, r.name, r.active ? '' : h('span', { class: 'badge' }, ' archiviato')) },
      { label: 'Codice', render: (r) => r.code || '' },
      { label: 'Barcode', render: (r) => r.barcode || '' },
      { label: 'Gruppo', render: (r) => r.group_name || '' },
      { label: 'IVA', render: (r) => (r.tax_name || '—'), csv: (r) => r.tax_rate },
      { label: 'Costo', align: 'right', render: (r) => money(r.cost), csv: (r) => r.cost },
      { label: 'Prezzo', align: 'right', render: (r) => money(r.price), csv: (r) => r.price },
      { label: 'Giacenza', align: 'right', render: (r) => (r.track_stock ? h('span', { class: r.stock <= r.min_stock ? 'badge bad' : '' }, qtyFmt(r.stock)) : '—'), csv: (r) => r.stock },
    ];
    listEl.replaceChildren(table(cols, rows, { onRow: (r) => editProduct(r.id), empty: 'Nessun prodotto' }));
    listEl.dataset.cols = '1';
    listEl._cols = cols;
  }

  async function editProduct(id) {
    const p = id ? await get(`/products/${id}`) : { track_stock: 1, active: 1, unit: 'pz', tax_id: taxes.find((t) => t.rate === 22)?.id };
    const f = {
      name: h('input', { value: p.name || '' }), code: h('input', { value: p.code || '' }), barcode: h('input', { value: p.barcode || '' }),
      extra: h('input', { value: (p.extra_barcodes || []).join(', '), placeholder: 'altri codici separati da virgola' }),
      group: select([{ value: '', label: '— nessuno —' }, ...groups.map((g) => ({ value: g.id, label: g.name }))], p.group_id ?? ''),
      tax: select([{ value: '', label: '— esente —' }, ...taxes.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }))], p.tax_id ?? ''),
      supplier: select([{ value: '', label: '— nessuno —' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))], p.supplier_id ?? ''),
      price: h('input', { inputmode: 'decimal', value: p.price ?? '' }), cost: h('input', { inputmode: 'decimal', value: p.cost ?? '' }),
      unit: h('input', { value: p.unit || 'pz' }), stock: h('input', { inputmode: 'decimal', value: id ? p.stock : '', disabled: Boolean(id), placeholder: id ? '' : '0' }),
      min: h('input', { inputmode: 'decimal', value: p.min_stock ?? '' }), desc: h('textarea', { rows: 2, value: p.description || '' }),
    };
    const chk = (label, checked) => { const i = h('input', { type: 'checkbox', checked: Boolean(checked) }); return { i, el: h('label', { class: 'field check' }, i, h('span', {}, label)) }; };
    const track = chk('Gestisci giacenza', p.track_stock); const fav = chk('Mostra tra i preferiti in cassa', p.favorite);
    const chPrice = chk('Prezzo modificabile in cassa', p.allow_price_change); const act = chk('Attivo', p.active);
    const markup = h('small', {});
    const upd = () => { const c = parseNum(f.cost.value), pr = parseNum(f.price.value); markup.textContent = c > 0 && pr > 0 ? `Ricarico ${(((pr / c) - 1) * 100).toFixed(1)}% (prezzo ${state.settings.prices_include_tax === '1' ? 'IVA inclusa' : 'IVA esclusa'})` : ''; };
    f.cost.oninput = upd; f.price.oninput = upd; upd();
    modal(id ? 'Modifica prodotto' : 'Nuovo prodotto', (close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const body = {
          name: f.name.value, code: f.code.value, barcode: f.barcode.value, extra_barcodes: f.extra.value.split(',').map((x) => x.trim()).filter(Boolean),
          group_id: f.group.value || null, tax_id: f.tax.value || null, supplier_id: f.supplier.value || null, price: parseNum(f.price.value), cost: parseNum(f.cost.value),
          unit: f.unit.value, stock: parseNum(f.stock.value), min_stock: parseNum(f.min.value), description: f.desc.value,
          track_stock: track.i.checked, favorite: fav.i.checked, allow_price_change: chPrice.i.checked, active: act.i.checked,
        };
        try { id ? await put(`/products/${id}`, body) : await post('/products', body); close(); load(); toast('Prodotto salvato'); } catch { /* mostrato */ }
      },
    },
    h('div', { class: 'form-grid' }, field('Nome *', f.name), field('Codice', f.code), field('Barcode', f.barcode), field('Barcode aggiuntivi', f.extra),
      field('Gruppo', f.group), field('IVA', f.tax), field('Costo', f.cost), field('Prezzo di vendita', f.price, null), field('Unità', f.unit), field('Fornitore', f.supplier),
      field(id ? 'Giacenza (usa Magazzino per variarla)' : 'Giacenza iniziale', f.stock), field('Scorta minima', f.min)), markup,
    field('Descrizione', f.desc), track.el, fav.el, chPrice.el, act.el,
    h('div', { class: 'row between' },
      id && can('products.edit') ? h('button', { type: 'button', class: 'danger', onclick: async () => { if (await confirmBox('Eliminare il prodotto? Se è stato venduto verrà archiviato.', { danger: true, ok: 'Elimina' })) { const r = await del(`/products/${id}`); close(); load(); toast(r.archived ? 'Prodotto archiviato' : 'Prodotto eliminato'); } } }, 'Elimina') : h('span'),
      h('button', { class: 'primary' }, 'Salva'))), { wide: true });
  }

  async function importCsv(file) {
    const rows = parseCsv(await file.text());
    if (rows.length < 2) return toast('File vuoto', 'error');
    const keys = { nome: 'name', name: 'name', codice: 'code', code: 'code', barcode: 'barcode', gruppo: 'group', group: 'group', iva: 'tax_rate', prezzo: 'price', price: 'price', costo: 'cost', cost: 'cost', unita: 'unit', 'unità': 'unit', giacenza: 'stock', stock: 'stock', 'scorta minima': 'min_stock' };
    const header = rows[0].map((c) => keys[c.trim().toLowerCase()] || null);
    if (!header.includes('name')) return toast('Manca la colonna "Nome"', 'error');
    const payload = rows.slice(1).map((r) => Object.fromEntries(header.map((k, i) => (k ? [k, k === 'price' || k === 'cost' || k === 'stock' || k === 'min_stock' || k === 'tax_rate' ? String(r[i] ?? '').replace(',', '.') : r[i]] : null)).filter(Boolean)));
    const res = await post('/products/import', { rows: payload });
    toast(`Creati ${res.created}, aggiornati ${res.updated}${res.errors.length ? `, errori ${res.errors.length}` : ''}`, res.errors.length ? 'error' : 'ok');
    if (res.errors.length) modal('Righe non importate', () => h('ul', {}, res.errors.slice(0, 50).map((e) => h('li', {}, `Riga ${e.row}: ${e.error}`))));
    load();
  }

  function labelsModal() {
    const chosen = rows.filter((r) => selected.has(r.id));
    if (!chosen.length) return toast('Seleziona i prodotti con le caselle a sinistra', 'error');
    const copies = chosen.map((p) => ({ ...p, copies: 1 }));
    const cols = select([{ value: 2, label: '2 colonne' }, { value: 3, label: '3 colonne' }, { value: 4, label: '4 colonne' }], 3);
    modal('Etichette con codice a barre', (close) => h('div', {},
      ...copies.map((p) => h('div', { class: 'row between', style: { marginBottom: '6px' } }, h('span', { class: 'grow' }, p.name),
        h('input', { type: 'number', min: 1, value: 1, style: { width: '80px' }, oninput: (e) => { p.copies = Math.max(1, Number(e.target.value) || 1); } }))),
      field('Layout', cols), h('div', { class: 'row end' }, h('button', { class: 'primary', onclick: () => { printLabels(copies, Number(cols.value)); close(); } }, 'Stampa'))));
  }

  const fileInput = h('input', { type: 'file', accept: '.csv,text/csv', style: { display: 'none' }, onchange: (e) => e.target.files[0] && importCsv(e.target.files[0]) });
  root.replaceChildren(
    head('Prodotti',
      h('button', { onclick: () => downloadCsv('prodotti.csv', listEl._cols?.slice(1) || [], rows) }, 'Esporta CSV'),
      can('products.edit') ? h('button', { onclick: () => fileInput.click() }, 'Importa CSV') : null, fileInput,
      h('button', { onclick: labelsModal }, 'Etichette'),
      can('products.edit') ? h('button', { class: 'primary', onclick: () => editProduct(null) }, '＋ Nuovo prodotto') : null),
    h('div', { class: 'toolbar' }, q, groupSel,
      h('label', { class: 'row' }, lowChk, 'Sotto scorta'), h('label', { class: 'row' }, allChk, 'Includi archiviati')),
    listEl);
  const reload = debounce(load, 200);
  q.oninput = reload; groupSel.onchange = load; lowChk.onchange = load; allChk.onchange = load;
  load();
}

// ---------------- Gruppi ----------------
export async function renderGroups(root) {
  const listEl = h('div');
  async function load() {
    const rows = await get('/groups');
    listEl.replaceChildren(table([
      { label: 'Colore', render: (r) => h('span', { class: 'badge', style: { background: r.color, color: '#fff' } }, '   ') },
      { label: 'Nome', render: (r) => r.name }, { label: 'Prodotti', align: 'right', render: (r) => r.products },
    ], rows, { onRow: can('products.edit') ? edit : null, empty: 'Nessun gruppo' }));
  }
  function edit(g) {
    const name = h('input', { value: g?.name || '' });
    const color = h('input', { type: 'color', value: g?.color || '#3b82f6' });
    modal(g ? 'Modifica gruppo' : 'Nuovo gruppo', (close) => h('form', {
      onsubmit: async (e) => { e.preventDefault(); try { g ? await put(`/groups/${g.id}`, { name: name.value, color: color.value }) : await post('/groups', { name: name.value, color: color.value }); close(); load(); } catch { /* */ } },
    }, field('Nome', name), field('Colore', color), h('div', { class: 'row between' },
      g ? h('button', { type: 'button', class: 'danger', onclick: async () => { if (await confirmBox('Eliminare il gruppo? I prodotti resteranno senza gruppo.', { danger: true, ok: 'Elimina' })) { await del(`/groups/${g.id}`); close(); load(); } } }, 'Elimina') : h('span'),
      h('button', { class: 'primary' }, 'Salva'))));
  }
  root.replaceChildren(head('Gruppi di prodotti', can('products.edit') ? h('button', { class: 'primary', onclick: () => edit(null) }, '＋ Nuovo gruppo') : null), listEl);
  load();
}

// ---------------- Clienti / Fornitori ----------------
export function renderPartners(kind) {
  const isCustomer = kind === 'customers';
  return async (root) => {
    const listEl = h('div');
    const q = h('input', { class: 'search', placeholder: 'Cerca…' });
    let rows = [];
    async function load() {
      rows = await get(`/${kind}?q=${encodeURIComponent(q.value)}`);
      const cols = [
        { label: 'Nome', render: (r) => r.name }, { label: 'P.IVA / CF', render: (r) => r.tax_number || '' }, { label: 'Telefono', render: (r) => r.phone || '' },
        { label: 'Email', render: (r) => r.email || '' }, ...(isCustomer ? [{ label: 'Sconto', align: 'right', render: (r) => (r.discount_pct ? r.discount_pct + '%' : ''), csv: (r) => r.discount_pct }] : []),
        { label: isCustomer ? 'Da incassare' : 'Da pagare', align: 'right', render: (r) => (r.balance ? h('b', {}, money(r.balance)) : ''), csv: (r) => r.balance },
      ];
      listEl.replaceChildren(table(cols, rows, { onRow: edit, empty: 'Nessun elemento' }));
      listEl._cols = cols;
    }
    async function edit(p) {
      const f = Object.fromEntries(['name', 'code', 'tax_number', 'address', 'city', 'phone', 'email', 'discount_pct'].map((k) => [k, h('input', { value: p?.[k] ?? '' })]));
      const notes = h('textarea', { rows: 2, value: p?.notes || '' });
      const history = p ? await get(`/partners/${p.id}/documents`) : [];
      modal(p ? p.name : (isCustomer ? 'Nuovo cliente' : 'Nuovo fornitore'), (close) => h('div', {},
        h('form', {
          onsubmit: async (e) => {
            e.preventDefault();
            const body = { ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])), notes: notes.value };
            try { p ? await put(`/${kind}/${p.id}`, body) : await post(`/${kind}`, body); close(); load(); toast('Salvato'); } catch { /* */ }
          },
        }, h('div', { class: 'form-grid' }, field('Nome *', f.name), field('Codice', f.code), field('P.IVA / Codice fiscale', f.tax_number), field('Telefono', f.phone),
          field('Email', f.email), field('Città', f.city), field('Indirizzo', f.address), isCustomer ? field('Sconto abituale %', f.discount_pct) : null),
        field('Note', notes),
        h('div', { class: 'row between' },
          p ? h('button', { type: 'button', class: 'danger', onclick: async () => { if (await confirmBox('Eliminare? Se ha documenti verrà archiviato.', { danger: true, ok: 'Elimina' })) { await del(`/${kind}/${p.id}`); close(); load(); } } }, 'Elimina') : h('span'),
          h('button', { class: 'primary' }, 'Salva'))),
        history.length ? h('div', {}, h('h4', {}, 'Ultimi documenti'), table([
          { label: 'Numero', render: (d) => d.number }, { label: 'Tipo', render: (d) => DOC_LABELS[d.type] }, { label: 'Data', render: (d) => dateFmt(d.completed_at) },
          { label: 'Totale', align: 'right', render: (d) => money(d.total) }, { label: 'Pagato', align: 'right', render: (d) => money(d.paid) }], history.slice(0, 15), { onRow: (d) => { close(); showDocument(d.id); } })) : null), { wide: true });
    }
    root.replaceChildren(
      head(isCustomer ? 'Clienti' : 'Fornitori', h('button', { onclick: () => downloadCsv(`${kind}.csv`, listEl._cols || [], rows) }, 'Esporta CSV'),
        can('partners.edit') ? h('button', { class: 'primary', onclick: () => edit(null) }, isCustomer ? '＋ Nuovo cliente' : '＋ Nuovo fornitore') : null),
      h('div', { class: 'toolbar' }, q), listEl);
    q.oninput = debounce(load, 200);
    load();
  };
}

// ---------------- Documenti ----------------
export const statusBadge = (d) => d.status === 'void' ? h('span', { class: 'badge bad' }, 'Annullato') : d.status === 'held' ? h('span', { class: 'badge warn' }, 'In sospeso')
  : ['invoice', 'purchase'].includes(d.type) && d.total - d.paid > 0.004 ? h('span', { class: 'badge warn' }, 'Da saldare') : h('span', { class: 'badge ok' }, 'Completo');

export async function renderDocuments(root, params = new URLSearchParams()) {
  const type = select([{ value: '', label: 'Tutti i tipi' }, ...Object.entries(DOC_LABELS).map(([value, label]) => ({ value, label }))], params.get('type') || '');
  const from = h('input', { type: 'date', value: params.get('from') || todayStr() }); const to = h('input', { type: 'date', value: params.get('to') || todayStr() });
  const q = h('input', { class: 'search', placeholder: 'Numero, cliente, nota…' });
  const unpaid = h('input', { type: 'checkbox', checked: params.get('unpaid') === '1' });
  const listEl = h('div');
  let rows = [];
  async function load() {
    const p = new URLSearchParams({ type: type.value, from: unpaid.checked ? '' : from.value, to: unpaid.checked ? '' : to.value, q: q.value, unpaid: unpaid.checked ? '1' : '0' });
    rows = await get(`/documents?${p}`);
    const cols = [
      { label: 'Numero', render: (r) => r.number }, { label: 'Tipo', render: (r) => DOC_LABELS[r.type] }, { label: 'Data', render: (r) => dateFmt(r.date) },
      { label: 'Cliente/Fornitore', render: (r) => r.partner_name || '' }, { label: 'Operatore', render: (r) => r.user_name || '' },
      { label: 'Stato', render: statusBadge, csv: (r) => r.status }, { label: 'Totale', align: 'right', render: (r) => money(r.type === 'refund' ? -r.total : r.total), csv: (r) => r.total },
    ];
    const total = rows.filter((r) => r.status === 'completed' && ['sale', 'invoice', 'refund'].includes(r.type)).reduce((s, r) => s + (r.type === 'refund' ? -r.total : r.total), 0);
    listEl.replaceChildren(table(cols, rows, { onRow: (r) => showDocument(r.id, load), empty: 'Nessun documento' }), h('p', { class: 'muted' }, `${rows.length} documenti · vendite nette ${money(total)}`));
    listEl._cols = cols;
  }
  root.replaceChildren(head('Documenti', h('button', { onclick: () => downloadCsv('documenti.csv', listEl._cols || [], rows) }, 'Esporta CSV')),
    h('div', { class: 'toolbar' }, q, type, h('label', { class: 'row' }, 'Dal', from), h('label', { class: 'row' }, 'al', to), h('label', { class: 'row' }, unpaid, 'Solo da saldare')), listEl);
  [type, from, to, unpaid].forEach((el) => { el.onchange = load; });
  q.oninput = debounce(load, 250);
  load();
}

export async function showDocument(id, onChange) {
  const d = await get(`/documents/${id}`);
  const cols = [
    { label: 'Descrizione', render: (i) => i.name }, { label: 'Qtà', align: 'right', render: (i) => qtyFmt(i.qty) }, { label: 'Prezzo', align: 'right', render: (i) => money(i.price) },
    { label: 'Sc.%', align: 'right', render: (i) => i.discount_pct || '' }, { label: 'IVA', align: 'right', render: (i) => i.tax_rate + '%' }, { label: 'Totale', align: 'right', render: (i) => money(i.total) },
  ];
  modal(`${DOC_LABELS[d.type]} ${d.number || '(in sospeso)'}`, (close) => h('div', {},
    h('div', { class: 'row between' }, h('div', {}, h('div', {}, dateFmt(d.completed_at || d.created_at), ' · ', d.user_name || ''), d.partner_name ? h('div', {}, d.partner_name) : null, d.ref_number ? h('div', { class: 'muted' }, `Rif. ${d.ref_number}`) : null), statusBadge(d)),
    h('div', { style: { margin: '12px 0' } }, table(cols, d.items)),
    h('div', { class: 'row between' }, h('div', {}, d.discount_total > 0 ? h('div', {}, `Sconti ${money(d.discount_total)}`) : null, h('div', { class: 'muted' }, `IVA ${money(d.tax_total)}`),
      d.payments.map((p) => h('div', {}, `${p.payment_type_name}: ${money(p.amount)}`)), d.note ? h('div', { class: 'muted' }, d.note) : null),
    h('div', { style: { fontSize: '24px', fontWeight: 800 } }, money(d.total))),
    h('div', { class: 'row end' },
      d.status === 'completed' && ['invoice', 'purchase'].includes(d.type) && d.total - d.paid > 0.004 ? h('button', { class: 'primary', onclick: () => { close(); payInvoice(d, onChange); } }, `Registra pagamento (${money(d.total - d.paid)})`) : null,
      d.status === 'completed' && ['sale', 'invoice'].includes(d.type) && can('pos.refund') ? h('button', { onclick: () => { close(); refundModal(d, onChange); } }, 'Reso') : null,
      d.status === 'completed' && can('pos.void') ? h('button', { class: 'danger', onclick: async () => { if (await confirmBox('Annullare il documento? Le giacenze verranno ripristinate.', { danger: true, ok: 'Annulla documento' })) { try { await post(`/documents/${d.id}/void`); close(); onChange?.(); toast('Documento annullato'); } catch { /* */ } } } }, 'Annulla documento') : null,
      d.status === 'completed' ? h('button', { onclick: () => printDocument(d) }, '🖨 Stampa') : null,
      d.status === 'completed' ? h('button', { onclick: () => printA4(d) }, 'A4') : null)), { wide: true });
}

async function payInvoice(d, onChange) {
  const types = (await get('/payment-types')).filter((p) => p.active);
  const type = select(types.map((p) => ({ value: p.id, label: p.name })), types[0]?.id);
  const amount = h('input', { inputmode: 'decimal', value: String(Math.round((d.total - d.paid) * 100) / 100) });
  modal('Registra pagamento', (close) => h('form', {
    onsubmit: async (e) => { e.preventDefault(); try { await post(`/documents/${d.id}/payments`, { payments: [{ payment_type_id: Number(type.value), amount: parseNum(amount.value) }] }); close(); onChange?.(); toast('Pagamento registrato'); } catch { /* */ } },
  }, field('Metodo', type), field('Importo', amount), h('div', { class: 'row end' }, h('button', { class: 'primary' }, 'Registra'))));
}

function refundModal(d, onChange) {
  const inclusive = state.settings.prices_include_tax === '1';
  const inputs = d.items.map((i) => {
    const left = i.qty - (i.refunded_qty || 0);
    return { item: i, left, input: h('input', { type: 'number', min: 0, max: left, step: 'any', value: 0, disabled: left <= 0, style: { width: '90px' } }) };
  });
  modal(`Reso su ${d.number}`, (close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const items = inputs.filter((r) => parseNum(r.input.value) > 0).map((r) => ({
        product_id: r.item.product_id, name: r.item.name, qty: parseNum(r.input.value), tax_rate: r.item.tax_rate,
        price: Math.round(((inclusive ? r.item.total : r.item.net) / r.item.qty) * 100) / 100,
      }));
      if (!items.length) return toast('Indica le quantità da rendere', 'error');
      try { const doc = await post('/documents', { type: 'refund', ref_id: d.id, partner_id: d.partner_id, items }); close(); onChange?.(); toast(`Reso ${doc.number} registrato`); printDocument(doc); } catch { /* */ }
    },
  }, table([{ label: 'Descrizione', render: (r) => r.item.name }, { label: 'Resa/Venduta', align: 'right', render: (r) => `${qtyFmt(r.item.refunded_qty || 0)}/${qtyFmt(r.item.qty)}` }, { label: 'Quantità', render: (r) => r.input }], inputs),
  h('p', { class: 'muted' }, 'Il rimborso avviene in contanti. Il prodotto torna a magazzino.'),
  h('div', { class: 'row end' }, h('button', { class: 'primary' }, 'Emetti reso'))));
}
