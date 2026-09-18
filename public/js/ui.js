export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const raw = (value) => ({ __raw: value });

function render(value) {
  if (value == null || value === false) return '';
  if (Array.isArray(value)) return value.map(render).join('');
  if (value && value.__raw !== undefined) return value.__raw;
  return escapeHtml(String(value));
}

// Template che protegge automaticamente i valori interpolati
export function html(strings, ...values) {
  return strings.reduce((out, chunk, i) => out + chunk + (i < values.length ? render(values[i]) : ''), '');
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export const euro = (value) =>
  `${Number(value ?? 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export const num = (value) => Number(value ?? 0).toLocaleString('it-IT');

export function dateTime(value) {
  if (!value) return '—';
  const iso = String(value).includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

export function time(value) {
  if (!value) return '—';
  const iso = String(value).includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

export const oggi = () => new Date().toLocaleDateString('sv-SE');

export function descrizione(item) {
  return [
    item.brand_name,
    item.model_name,
    '·',
    item.category_name,
    item.quality_name,
    item.color,
  ]
    .filter(Boolean)
    .join(' ');
}

export function statoTag(item) {
  if (item.quantity <= 0) return raw(html`<span class="tag danger">esaurito</span>`);
  if (item.quantity <= item.min_stock) return raw(html`<span class="tag warn">sotto scorta</span>`);
  return raw(html`<span class="tag ok">disponibile</span>`);
}

export function toast(message, type = 'info', ms = 4000) {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.innerHTML = html`${message}`;
  $('#toasts').append(node);
  setTimeout(() => node.remove(), ms);
}

export function openModal(content, onMount) {
  const modal = $('#modal');
  const card = $('#modalCard');
  card.innerHTML = content;
  modal.hidden = false;
  modal.onclick = (event) => {
    if (event.target === modal) closeModal();
  };
  onMount?.(card);
  const first = card.querySelector('input, select, textarea, button');
  first?.focus();
}

export function closeModal() {
  $('#modal').hidden = true;
  $('#modalCard').innerHTML = '';
}

export function confirmDialog(message, { titolo = 'Conferma', ok = 'Conferma', danger = false } = {}) {
  return new Promise((resolve) => {
    openModal(
      html`<h2 style="margin-top:0">${titolo}</h2>
        <p>${message}</p>
        <div class="modal-actions">
          <button data-no>Annulla</button>
          <button class="${danger ? 'danger' : 'primary'}" data-yes>${ok}</button>
        </div>`,
      (card) => {
        card.querySelector('[data-no]').onclick = () => {
          closeModal();
          resolve(false);
        };
        card.querySelector('[data-yes]').onclick = () => {
          closeModal();
          resolve(true);
        };
      },
    );
  });
}
