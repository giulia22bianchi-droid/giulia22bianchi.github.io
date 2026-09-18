import { get, connectEvents, codiceAccesso } from './api.js';
import { $, $$, toast } from './ui.js';
import * as views from './views.js';

const ROUTES = {
  banco: views.banco,
  magazzino: views.magazzino,
  categorie: views.categorie,
  'da-ordinare': views.daOrdinare,
  avvisi: views.avvisi,
  carico: views.carico,
  anteprima: views.anteprima,
  assistente: views.assistente,
  vendite: views.vendite,
  riepilogo: views.riepilogo,
  statistiche: views.statistiche,
  mancanti: views.mancanti,
  catalogo: views.catalogoModelli,
};

let corrente = { nome: 'banco', params: {} };

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, '') || 'banco';
  const [percorso, queryString] = hash.split('?');
  const parti = percorso.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(queryString ?? ''));
  if (parti[1]) params.id = parti[1];
  return { nome: parti[0] || 'banco', params };
}

async function naviga() {
  const { nome, params } = parseHash();
  const render = ROUTES[nome] ?? ROUTES.banco;
  corrente = { nome, params };

  $$('.sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.route === nome));
  document.body.classList.remove('nav-open');

  try {
    await render(params);
  } catch (err) {
    if (err.status === 401) schermataAccesso();
    else $('#view').innerHTML = `<div class="card"><h1>Errore</h1><p class="muted">${err.message}</p></div>`;
  }
  window.scrollTo(0, 0);
}

function schermataAccesso() {
  $('#view').innerHTML = `
    <div class="card" style="max-width:420px; margin:40px auto">
      <h1>🔒 Accesso</h1>
      <p class="muted small">Questo magazzino è protetto da un codice di accesso.</p>
      <form id="accessoForm">
        <div class="field"><label>Codice</label><input type="password" id="codice" autocomplete="current-password"></div>
        <button class="primary">Entra</button>
      </form>
    </div>`;
  $('#accessoForm').onsubmit = (event) => {
    event.preventDefault();
    codiceAccesso.salva($('#codice').value);
    location.reload();
  };
}

async function aggiornaAvvisi() {
  try {
    const { totale } = await get('/stock/alerts');
    const badge = $('#alertBadge');
    badge.hidden = totale === 0;
    badge.querySelector('span').textContent = totale;
  } catch {
    /* il badge non è critico */
  }
}

function lampeggia() {
  const dot = $('#syncDot');
  dot.classList.add('flash');
  setTimeout(() => dot.classList.remove('flash'), 400);
}

// Le pagine che mostrano quantità vanno riallineate quando un altro dispositivo vende
const DA_RICARICARE = new Set(['magazzino', 'da-ordinare', 'avvisi', 'vendite', 'riepilogo', 'statistiche', 'categorie']);

connectEvents((tipo, dato) => {
  if (tipo === '__open') {
    $('#syncDot').classList.add('live');
    return;
  }
  if (tipo === '__error') {
    $('#syncDot').classList.remove('live');
    return;
  }

  lampeggia();
  if (tipo === 'scorta') {
    toast(`⚠️ Scorta minima: ${dato.brand} ${dato.model} ${dato.category}${dato.color ? ` ${dato.color}` : ''} → ${dato.quantity} rimasti`, 'warn', 8000);
  }
  if (tipo === 'scorta' || tipo === 'magazzino') aggiornaAvvisi();
  if (DA_RICARICARE.has(corrente.nome)) {
    ROUTES[corrente.nome]?.(corrente.params);
  }
});

$('#menuBtn').onclick = () => document.body.classList.toggle('nav-open');
$('#scrim').onclick = () => document.body.classList.remove('nav-open');
window.addEventListener('hashchange', naviga);

naviga();
aggiornaAvvisi();
