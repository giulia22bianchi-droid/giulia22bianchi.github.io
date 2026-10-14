// Utilità DOM minime. Tutto il testo passa da textContent: nessun innerHTML con dati utente.
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

let toastTimer;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// Apre una modale; `build(close)` restituisce {body, buttons}. Esc o click fuori chiudono.
export function modal(title, build) {
  const root = document.getElementById('modal-root');
  const back = h('div', { class: 'back' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const { body, buttons } = build(close);
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h3', null, title), body, h('div', { class: 'foot' }, buttons));
  back.append(box);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  root.append(back);
  const first = box.querySelector('input,select,textarea'); if (first) first.focus();
  return close;
}

export function confirmBox(msg, onYes, yesLabel = 'Conferma') {
  modal('Conferma', (close) => ({
    body: h('p', null, msg),
    buttons: [h('button', { onclick: close }, 'Annulla'),
      h('button', { class: 'primary', onclick: () => { close(); onYes(); } }, yesLabel)],
  }));
}

export function download(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Icone a tratto (viewBox 24). Ogni voce è una lista di elementi SVG semplici.
const P = (d) => ['path', { d }], C = (cx, cy, r) => ['circle', { cx, cy, r }], R = (x, y, w, hh) => ['rect', { x, y, width: w, height: hh }];
const ICONS = {
  x: [P('M5 5l14 14M19 5L5 19')], search: [C(10, 10, 6), P('M15 15l6 6')],
  basket: [P('M3 10h18l-2 9H5z'), P('M8 10l3-5M16 10l-3-5'), P('M18 2v5M15.5 4.5h5')], plus: [P('M12 4v16M4 12h16')],
  drawer: [P('M4 10h16v9H4z'), P('M4 10l2-5h12l2 5'), P('M9 14h6')], percent: [C(7, 7, 2.5), C(17, 17, 2.5), P('M19 5L5 19')],
  tag: [P('M3 12V4h8l10 10-8 8z'), C(7.5, 8.5, 1.2)], customer: [C(12, 8, 4), P('M4 21c0-5 4-7 8-7s8 2 8 7')],
  person: [C(12, 6, 3), P('M5 21l3-9h8l3 9')], lock: [R(5, 11, 14, 9), P('M8 11V8a4 4 0 0 1 8 0v3')],
  refund: [P('M4 12a8 8 0 1 0 3-6M4 3v5h5')], transfer: [P('M4 8h15l-3-3M20 16H5l3 3')], trash: [P('M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13')],
  dots: [C(5, 12, 1.6), C(12, 12, 1.6), C(19, 12, 1.6)], power: [P('M12 3v9M6.5 6.5a8 8 0 1 0 11 0')], arrow: [P('M4 12h16M14 6l6 6-6 6')],
  barcode: [P('M4 5v14M7 5v14M10 5v14M13 5v14M17 5v14M20 5v14')], hash: [P('M9 4L7 20M17 4l-2 16M4 9h17M3 15h17')],
  asterisk: [P('M12 3v18M4 7.5l16 9M4 16.5l16-9')], backspace: [P('M9 5h12v14H9L3 12z'), P('M13 9l6 6M19 9l-6 6')],
  dine: [P('M8 4v8h8M8 12v8M16 12v8M12 4h5')], question: [P('M9 9a3 3 0 1 1 4 3c-1 .7-1 1.5-1 2.5M12 18.5v.5')],
  save: [P('M5 4h11l3 3v13H5z'), P('M8 4v5h7V4M8 20v-6h8v6')],
  hexagon: [['polygon', { points: '12,2 21,7 21,17 12,22 3,17 3,7' }], P('M14.5 10.5a3 3 0 1 0 0 3M14.5 10v4.5')],
};
export function icon(name, size = 24, stroke = 1.6) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  for (const [tag, attrs] of ICONS[name] || []) { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.append(e); }
  return svg;
}
