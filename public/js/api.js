const BASE = '/api';

export const codiceAccesso = {
  leggi: () => localStorage.getItem('codice_accesso') ?? '',
  salva: (valore) => localStorage.setItem('codice_accesso', valore),
  cancella: () => localStorage.removeItem('codice_accesso'),
};

export async function request(path, { method = 'GET', body, form } = {}) {
  const options = { method, headers: { 'x-access-code': codiceAccesso.leggi() } };
  if (form) {
    options.body = form;
  } else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, options);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const error = new Error(data?.error ?? `Errore ${res.status}`);
    error.details = data?.details;
    error.status = res.status;
    throw error;
  }
  return data;
}

export const get = (path) => request(path);
export const post = (path, body) => request(path, { method: 'POST', body });
export const patch = (path, body) => request(path, { method: 'PATCH', body });
export const del = (path, body) => request(path, { method: 'DELETE', body });
export const upload = (path, form) => request(path, { method: 'POST', form });

// Sincronizzazione in tempo reale: il server annuncia ogni movimento
export function connectEvents(handler) {
  // EventSource non permette header personalizzati: il codice viaggia in query
  const source = new EventSource(`${BASE}/events?code=${encodeURIComponent(codiceAccesso.leggi())}`);
  for (const type of ['magazzino', 'vendita', 'vendita-annullata', 'carico', 'scorta', 'articolo-creato', 'articolo-aggiornato']) {
    source.addEventListener(type, (event) => {
      handler(type, JSON.parse(event.data || '{}'));
    });
  }
  source.addEventListener('open', () => handler('__open'));
  source.addEventListener('error', () => handler('__error'));
  return source;
}
