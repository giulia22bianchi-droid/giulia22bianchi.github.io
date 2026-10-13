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
