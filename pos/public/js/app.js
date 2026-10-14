import { h, state, can, field } from './ui.js';
import { get, post, session } from './api.js';
import { renderPos } from './pos.js';
import { renderProducts, renderGroups, renderPartners, renderDocuments } from './pages.js';
import { renderPurchases, renderStock, renderRegister, renderReports, renderUsers, renderSettings } from './pages2.js';

const ROUTES = [
  { path: 'pos', label: '🛒 Cassa', perm: 'pos.sell', render: renderPos },
  { path: 'documents', label: '🧾 Documenti', render: renderDocuments },
  { path: 'products', label: '📦 Prodotti', perm: 'products.view', render: renderProducts },
  { path: 'groups', label: '🏷 Gruppi', perm: 'products.view', render: renderGroups },
  { path: 'customers', label: '👥 Clienti', render: renderPartners('customers') },
  { path: 'suppliers', label: '🚚 Fornitori', perm: 'purchases.manage', render: renderPartners('suppliers') },
  { path: 'purchases', label: '📥 Acquisti', perm: 'purchases.manage', render: renderPurchases },
  { path: 'stock', label: '🗄 Magazzino', perm: 'products.view', render: renderStock },
  { path: 'register', label: '💶 Cassa e turni', perm: 'register.manage', render: renderRegister },
  { path: 'reports', label: '📊 Report', perm: 'reports.view', render: renderReports },
  { path: 'users', label: '🔐 Utenti', perm: 'users.manage', render: renderUsers },
  { path: 'settings', label: '⚙ Impostazioni', render: renderSettings },
];

const app = document.getElementById('app');

function renderLogin() {
  const user = h('input', { autocomplete: 'username', autofocus: true });
  const pass = h('input', { type: 'password', autocomplete: 'current-password' });
  app.replaceChildren(h('form', {
    class: 'login',
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        const r = await post('/login', { username: user.value, password: pass.value });
        session.set(r.token);
        boot();
      } catch { pass.select(); }
    },
  }, h('h2', {}, 'Cassa POS'), field('Utente', user), field('Password', pass), h('button', { class: 'primary', style: { width: '100%' } }, 'Accedi'),
  h('p', { class: 'muted' }, h('small', {}, 'Primo accesso: utente admin, password admin. Cambiala subito da Impostazioni.'))));
}

async function route() {
  const [pathRaw, query] = (location.hash.replace(/^#\/?/, '') || '').split('?');
  const available = ROUTES.filter((r) => !r.perm || can(r.perm));
  const current = available.find((r) => r.path === pathRaw) || available[0];
  if (!current) return;
  document.querySelectorAll('.side nav a').forEach((a) => a.classList.toggle('active', a.dataset.path === current.path));
  const main = document.querySelector('.main');
  const fresh = main.cloneNode(false); // scarta i listener della pagina precedente
  fresh.className = 'main';
  main.replaceWith(fresh);
  try { await current.render(fresh, new URLSearchParams(query || '')); } catch (e) { if (!fresh.childNodes.length) fresh.append(h('div', { class: 'empty' }, e.message || 'Errore')); }
}

async function boot() {
  if (!session.token) return renderLogin();
  let me;
  try { me = await get('/me', { quiet: true }); } catch { session.set(null); return renderLogin(); }
  state.user = me.user;
  state.settings = me.settings;
  const nav = ROUTES.filter((r) => !r.perm || can(r.perm));
  app.replaceChildren(h('div', { class: 'shell' },
    h('aside', { class: 'side' }, h('div', { class: 'brand' }, state.settings.company_name || 'Cassa POS'),
      h('nav', {}, nav.map((r) => h('a', { href: `#/${r.path}`, 'data-path': r.path }, r.label))),
      h('div', { class: 'who' }, h('div', {}, h('b', {}, state.user.name)), h('div', { class: 'muted' }, state.user.role),
        h('button', { class: 'ghost', style: { padding: '4px 0' }, onclick: async () => { try { await post('/logout'); } catch { /* ignora */ } session.set(null); location.hash = ''; location.reload(); } }, 'Esci'))),
    h('main', { class: 'main' })));
  window.removeEventListener('hashchange', route);
  window.addEventListener('hashchange', route);
  route();
}

boot();
