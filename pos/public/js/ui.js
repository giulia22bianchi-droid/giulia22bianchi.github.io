// Piccoli strumenti di interfaccia condivisi da tutte le pagine

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

// replaceChildren(null) scriverebbe "null" nella pagina: scarta i valori vuoti
const nativeReplace = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function replaceChildren(...nodes) {
  return nativeReplace.apply(this, nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false));
};

export const state = { settings: {}, user: null };

export function money(n) {
  const v = Number(n) || 0;
  return `${state.settings.currency || '€'} ${v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export const qtyFmt = (n) => Number(n).toLocaleString('it-IT', { maximumFractionDigits: 3 });
export const parseNum = (s) => {
  const n = Number(String(s ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
export const dateFmt = (s) => {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + (String(s).includes('T') || String(s).endsWith('Z') ? '' : 'Z'));
  return d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
};
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const can = (p) => state.user?.permissions.includes(p);

export function toast(message, kind = 'ok') {
  const t = h('div', { class: `toast ${kind}` }, message);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 5000 : 2500);
}

/** Finestra modale. `build(close)` restituisce il contenuto. Ritorna una funzione di chiusura. */
export function modal(title, build, { wide = false, onClose } = {}) {
  const overlay = h('div', { class: 'overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape' && overlay === document.body.lastElementChild) close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.append(h('div', { class: `modal${wide ? ' wide' : ''}` },
    h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'icon', onclick: close, 'aria-label': 'Chiudi' }, '✕')),
    h('div', { class: 'modal-body' }, build(close))));
  document.body.append(overlay);
  const first = overlay.querySelector('input:not([type=checkbox]), select, textarea');
  first?.focus();
  return close;
}

export function confirmBox(message, { ok = 'Conferma', danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const answer = (v) => { if (!settled) { settled = true; resolve(v); } };
    modal('Conferma', (close) => h('div', {},
      h('p', {}, message),
      h('div', { class: 'row end' },
        h('button', { onclick: close }, 'Annulla'),
        h('button', { class: danger ? 'danger' : 'primary', onclick: () => { answer(true); close(); } }, ok))),
    { onClose: () => answer(false) });
  });
}

/** Campo di modulo: restituisce { el, get } */
export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
}

export function select(options, value, attrs = {}) {
  const s = h('select', attrs, options.map((o) => h('option', { value: o.value }, o.label)));
  if (value !== undefined && value !== null) s.value = String(value);
  return s;
}

/** Tabella semplice. columns: [{ label, render(row), align, class }] */
export function table(columns, rows, { onRow, empty = 'Nessun dato' } = {}) {
  if (!rows.length) return h('div', { class: 'empty' }, empty);
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.align === 'right' ? 'num' : '' }, c.label)))),
    h('tbody', {}, rows.map((r) => h('tr', { class: onRow ? 'clickable' : '', onclick: onRow ? () => onRow(r) : null },
      columns.map((c) => h('td', { class: `${c.align === 'right' ? 'num' : ''} ${c.class || ''}` }, c.render(r))))))));
}

export function downloadCsv(filename, columns, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [columns.map((c) => esc(c.label)).join(';'), ...rows.map((r) => columns.map((c) => esc(c.csv ? c.csv(r) : c.render(r))).join(';'))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
}

export function parseCsv(textContent) {
  const first = textContent.split(/\r?\n/, 1)[0];
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false;
  const s = textContent.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
