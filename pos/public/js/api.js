import { toast } from './ui.js';

let token = null;
try { token = localStorage.getItem('pos_token'); } catch { /* storage non disponibile */ }

export const session = {
  get token() { return token; },
  set(t) {
    token = t;
    try { t ? localStorage.setItem('pos_token', t) : localStorage.removeItem('pos_token'); } catch { /* ignora */ }
  },
};

export async function api(method, path, body, { quiet = false, raw = false } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: raw ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    if (!quiet) toast('Server non raggiungibile', 'error');
    throw new Error('Server non raggiungibile');
  }
  if (res.status === 401 && path !== '/login') {
    session.set(null);
    location.reload();
    throw new Error('Sessione scaduta');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (!quiet) toast(data.error || 'Errore', 'error');
    throw Object.assign(new Error(data.error || 'Errore'), { status: res.status });
  }
  return data;
}

export const get = (p, o) => api('GET', p, undefined, o);
export const post = (p, b, o) => api('POST', p, b ?? {}, o);
export const put = (p, b, o) => api('PUT', p, b ?? {}, o);
export const del = (p, o) => api('DELETE', p, undefined, o);

export async function download(path, filename) {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Download non riuscito');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
}
