import { get, post, patch, del, upload } from './api.js';
import {
  html, raw, $, $$, euro, num, dateTime, time, oggi, descrizione, statoTag,
  toast, openModal, closeModal, confirmDialog,
} from './ui.js';

const cache = {};

async function catalogo() {
  if (!cache.categories) {
    const [categories, qualities, colors] = await Promise.all([
      get('/catalog/categories'),
      get('/catalog/qualities'),
      get('/catalog/colors'),
    ]);
    Object.assign(cache, { categories, qualities, colors });
  }
  return cache;
}

function view(content) {
  $('#view').innerHTML = content;
  return $('#view');
}

function opzioni(list, selected, { vuoto = null } = {}) {
  return raw(
    (vuoto ? html`<option value="">${vuoto}</option>` : '') +
      list
        .map((row) => html`<option value="${row.id ?? row.name}" ${raw(String(row.id ?? row.name) === String(selected) ? 'selected' : '')}>${row.name}</option>`)
        .join(''),
  );
}

/* ============================ BANCO ============================ */

export async function banco() {
  const root = view(html`
    <div class="page-head">
      <div>
        <h1>🏪 Banco</h1>
        <p>Cerca per modello, codice o descrizione: "A526 display nero", "batteria iPhone 13", "SM-A546B".</p>
      </div>
    </div>
    <div class="card search-big">
      <form id="searchForm" class="row">
        <input id="q" placeholder="Modello, codice o richiesta del cliente…" autocomplete="off" enterkeyhint="search">
        <button class="primary" style="flex:0 0 auto">Cerca</button>
      </form>
    </div>
    <div id="risultato"></div>
  `);

  const input = $('#q', root);
  $('#searchForm', root).onsubmit = async (event) => {
    event.preventDefault();
    await cerca(input.value);
  };
  input.focus();
}

async function cerca(q) {
  const box = $('#risultato');
  if (!q.trim()) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = html`<div class="loading">Cerco…</div>`;

  let res;
  try {
    res = await get(`/search?q=${encodeURIComponent(q)}&log=1`);
  } catch (err) {
    box.innerHTML = html`<div class="card"><span class="tag danger">Errore</span> ${err.message}</div>`;
    return;
  }

  const stile = { disponibile: 'ok', esaurito: 'danger' }[res.status] ?? 'warn';
  let corpo = '';

  if (res.status === 'disponibile' || res.status === 'esaurito') {
    corpo = html`
      <div class="result-title">${descrizione(res.item)}</div>
      <div class="muted small mono">${res.item.model_codes ?? ''}${res.item.sku ? ` · SKU ${res.item.sku}` : ''}</div>
      <div class="row" style="margin-top:14px; align-items:center">
        <div style="flex:0 0 auto"><div class="price">${euro(res.item.price)}</div></div>
        <div style="flex:0 0 auto">${statoTag(res.item)} <span class="muted small">${res.item.quantity} pz in magazzino</span></div>
        <div class="spacer"></div>
        <div class="row actions" style="flex:0 0 auto" data-item="${res.item.id}">
          <button class="qty" data-delta="-1">−1</button>
          <button class="qty" data-delta="-2">−2</button>
          <button class="qty" data-delta="1">+1</button>
          <button class="primary" data-vendi>💰 Registra vendita</button>
        </div>
      </div>`;
  } else {
    corpo = html`<div class="result-title">${res.question ?? 'Serve una conferma'}</div>`;
    if (res.models?.length > 1) {
      corpo += html`<div class="choices">${res.models.map(
        (m) => raw(html`<button data-scegli="${m.brand} ${m.name}">${m.brand} ${m.name}</button>`),
      )}</div>`;
    }
    if (res.categories?.length) {
      corpo += html`<div class="choices">${res.categories.map(
        (c) => raw(html`<button data-scegli="${res.model.brand} ${res.model.name} ${c.name}">${c.icon ?? ''} ${c.name} <span class="muted">(${c.pezzi} pz)</span></button>`),
      )}</div>`;
    }
    if (res.qualities?.length) {
      corpo += html`<div class="choices">${res.qualities.map(
        (q) => raw(html`<button data-scegli="${res.query} ${q.name}">${q.name} <span class="muted">(${q.disponibili} pz)</span></button>`),
      )}</div>`;
    }
    if (res.colors?.length) {
      corpo += html`<div class="choices">${res.colors.map(
        (c) => raw(html`<button data-scegli="${res.query} ${c.name}">${c.name} · ${euro(c.prezzo)} <span class="muted">(${c.disponibili} pz)</span></button>`),
      )}</div>`;
    }
    if (res.alternatives?.length) {
      corpo += html`<h2>Varianti a catalogo</h2>${raw(tabellaArticoli(res.alternatives))}`;
    }
  }

  box.innerHTML = html`<div class="card result-card ${stile}">${raw(corpo)}</div>`;

  $$('[data-scegli]', box).forEach((btn) => {
    btn.onclick = () => {
      $('#q').value = btn.dataset.scegli;
      cerca(btn.dataset.scegli);
    };
  });
  $$('[data-delta]', box).forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.closest('[data-item]').dataset.item;
      try {
        await post(`/items/${id}/adjust`, { delta: Number(btn.dataset.delta), reason: 'rettifica banco' });
        toast('Quantità aggiornata', 'ok');
        cerca($('#q').value);
      } catch (err) {
        toast(err.message, 'err');
      }
    };
  });
  const vendi = box.querySelector('[data-vendi]');
  if (vendi) vendi.onclick = () => vendiModal(res.item, () => cerca($('#q').value));
}

function tabellaArticoli(items, { azioni = true } = {}) {
  if (!items.length) return html`<div class="empty">Nessun articolo.</div>`;
  return html`<div class="card" style="padding:0"><div class="table-wrap"><table>
    <thead><tr>
      <th>Articolo</th><th>Qualità</th><th>Colore</th><th class="num">Prezzo</th>
      <th class="num">Qtà</th><th class="num">Min</th><th>Stato</th>${azioni ? raw('<th></th>') : ''}
    </tr></thead>
    <tbody>${items.map((item) => raw(html`<tr data-item="${item.id}">
      <td>
        <div class="title">${item.brand_name} ${item.model_name}</div>
        <div class="muted small">${item.category_name}${item.sku ? ` · ${item.sku}` : ''}</div>
      </td>
      <td>${item.quality_name ?? '—'}</td>
      <td>${item.color || '—'}</td>
      <td class="num">${euro(item.price)}</td>
      <td class="num"><strong>${item.quantity}</strong></td>
      <td class="num muted">${item.min_stock}</td>
      <td>${statoTag(item)}</td>
      ${azioni ? raw(html`<td class="nowrap">
        <button class="qty" data-delta="-1" title="Vendi 1 pezzo">−1</button>
        <button class="qty" data-delta="1" title="Aggiungi 1 pezzo">+1</button>
        <button class="ghost" data-modifica title="Modifica">✏️</button>
        <button class="ghost" data-vendi title="Registra vendita">💰</button>
      </td>`) : ''}
    </tr>`))}</tbody>
  </table></div></div>`;
}

function collegaTabella(root, ricarica) {
  $$('[data-delta]', root).forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.closest('[data-item]').dataset.item;
      try {
        await post(`/items/${id}/adjust`, { delta: Number(btn.dataset.delta), reason: 'rettifica banco' });
        toast('Quantità aggiornata', 'ok');
        ricarica();
      } catch (err) {
        toast(err.message, 'err');
      }
    };
  });
  $$('[data-modifica]', root).forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.closest('[data-item]').dataset.item;
      modificaModal(await get(`/items/${id}`), ricarica);
    };
  });
  $$('[data-vendi]', root).forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.closest('[data-item]').dataset.item;
      vendiModal(await get(`/items/${id}`), ricarica);
    };
  });
}

/* ============================ VENDITA ============================ */

function vendiModal(item, ricarica) {
  openModal(
    html`<h2 style="margin-top:0">💰 Registra vendita</h2>
      <p class="muted small">${descrizione(item)} · disponibili ${item.quantity}</p>
      <div class="row">
        <div class="field narrow"><label>Quantità</label><input id="vQta" type="number" min="1" max="${item.quantity}" value="1"></div>
        <div class="field narrow"><label>Prezzo unitario</label><input id="vPrezzo" type="number" step="0.01" value="${item.price}"></div>
        <div class="field"><label>Canale</label>
          <select id="vCanale"><option value="banco">Banco</option><option value="whatsapp">WhatsApp</option><option value="telefono">Telefono</option></select>
        </div>
      </div>
      <div class="row">
        <div class="field"><label>Telefono cliente (facoltativo)</label><input id="vTel" placeholder="+39…"></div>
        <div class="field"><label>Nome cliente (facoltativo)</label><input id="vNome"></div>
      </div>
      <div class="field"><label>Note</label><input id="vNote"></div>
      <p class="muted small">La quantità viene scalata solo adesso, alla conferma della vendita.</p>
      <div class="modal-actions">
        <button data-annulla>Annulla</button>
        <button class="primary" data-conferma>Conferma vendita</button>
      </div>`,
    (card) => {
      card.querySelector('[data-annulla]').onclick = closeModal;
      card.querySelector('[data-conferma]').onclick = async () => {
        try {
          const sale = await post('/sales', {
            channel: $('#vCanale', card).value,
            customer_phone: $('#vTel', card).value || null,
            customer_name: $('#vNome', card).value || null,
            note: $('#vNote', card).value || null,
            lines: [{
              item_id: item.id,
              quantity: Number($('#vQta', card).value),
              unit_price: Number($('#vPrezzo', card).value),
            }],
          });
          closeModal();
          toast(`Vendita registrata: ${euro(sale.total)}`, 'ok');
          ricarica?.();
        } catch (err) {
          toast(err.message, 'err');
        }
      };
    },
  );
}

/* ============================ MAGAZZINO ============================ */

export async function magazzino(params = {}) {
  const { categories, qualities } = await catalogo();
  const stato = { ...params };

  const root = view(html`
    <div class="page-head">
      <div><h1>📦 Magazzino</h1><p>Prezzi e quantità sempre modificabili a mano.</p></div>
      <div class="spacer"></div>
      <button class="primary" id="nuovo">➕ Nuovo articolo</button>
    </div>
    <div class="card">
      <div class="row">
        <div><label>Cerca</label><input id="fQ" placeholder="modello, codice, SKU…" value="${stato.q ?? ''}"></div>
        <div><label>Categoria</label><select id="fCat">${opzioni(categories, stato.category_id, { vuoto: 'Tutte' })}</select></div>
        <div><label>Qualità</label><select id="fQual">${opzioni(qualities, stato.quality_id, { vuoto: 'Tutte' })}</select></div>
        <div><label>Stato</label><select id="fStato">
          <option value="">Tutti</option>
          <option value="da_ordinare">Da ordinare</option>
          <option value="sotto_scorta">Sotto scorta</option>
          <option value="esaurito">Esauriti</option>
        </select></div>
      </div>
    </div>
    <div id="lista"><div class="loading">Caricamento…</div></div>
  `);

  const carica = async () => {
    const qs = new URLSearchParams();
    if ($('#fQ', root).value) qs.set('q', $('#fQ', root).value);
    if ($('#fCat', root).value) qs.set('category_id', $('#fCat', root).value);
    if ($('#fQual', root).value) qs.set('quality_id', $('#fQual', root).value);
    if ($('#fStato', root).value) qs.set('status', $('#fStato', root).value);
    const { items, total } = await get(`/items?${qs}`);
    $('#lista', root).innerHTML =
      html`<p class="muted small">${total} varianti · ${num(items.reduce((s, i) => s + i.quantity, 0))} pezzi</p>` +
      tabellaArticoli(items);
    collegaTabella($('#lista', root), carica);
  };

  let timer;
  $('#fQ', root).oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(carica, 250);
  };
  ['#fCat', '#fQual', '#fStato'].forEach((sel) => {
    $(sel, root).onchange = carica;
  });
  $('#nuovo', root).onclick = () => nuovoArticoloModal(carica);

  if (stato.category_id) $('#fCat', root).value = stato.category_id;
  if (stato.status) $('#fStato', root).value = stato.status;
  await carica();
  magazzino.ricarica = carica;
}

function modificaModal(item, ricarica) {
  const { qualities, categories } = cache;
  openModal(
    html`<h2 style="margin-top:0">✏️ ${descrizione(item)}</h2>
      <p class="muted small mono">${item.model_codes ?? ''}</p>
      <div class="row">
        <div class="field narrow"><label>Prezzo vendita</label><input id="mPrezzo" type="number" step="0.01" value="${item.price}"></div>
        <div class="field narrow"><label>Costo</label><input id="mCosto" type="number" step="0.01" value="${item.cost ?? ''}"></div>
        <div class="field narrow"><label>Quantità</label><input id="mQta" type="number" min="0" value="${item.quantity}"></div>
        <div class="field narrow"><label>Scorta minima</label><input id="mMin" type="number" min="0" value="${item.min_stock}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Categoria</label><select id="mCat">${opzioni(categories, item.category_id)}</select></div>
        <div class="field"><label>Qualità</label><select id="mQual">${opzioni(qualities, item.quality_id, { vuoto: '—' })}</select></div>
        <div class="field"><label>Colore</label><input id="mColore" value="${item.color ?? ''}"></div>
      </div>
      <div class="row">
        <div class="field"><label>SKU / codice ricambio</label><input id="mSku" value="${item.sku ?? ''}"></div>
        <div class="field"><label>Note</label><input id="mNote" value="${item.note ?? ''}"></div>
      </div>
      <div class="modal-actions">
        <button class="danger" data-elimina>Disattiva</button>
        <div class="spacer"></div>
        <button data-annulla>Annulla</button>
        <button class="primary" data-salva>Salva</button>
      </div>`,
    (card) => {
      card.querySelector('[data-annulla]').onclick = closeModal;
      card.querySelector('[data-salva]').onclick = async () => {
        try {
          await patch(`/items/${item.id}`, {
            price: Number($('#mPrezzo', card).value),
            cost: $('#mCosto', card).value === '' ? null : Number($('#mCosto', card).value),
            quantity: Number($('#mQta', card).value),
            min_stock: Number($('#mMin', card).value),
            category_id: Number($('#mCat', card).value),
            quality_id: $('#mQual', card).value ? Number($('#mQual', card).value) : null,
            color: $('#mColore', card).value,
            sku: $('#mSku', card).value || null,
            note: $('#mNote', card).value || null,
            reason: 'modifica manuale',
          });
          closeModal();
          toast('Articolo aggiornato', 'ok');
          ricarica?.();
        } catch (err) {
          toast(err.message, 'err');
        }
      };
      card.querySelector('[data-elimina]').onclick = async () => {
        if (!(await confirmDialog('Disattivare questo articolo? Lo storico delle vendite resta.', { danger: true, ok: 'Disattiva' }))) return;
        await del(`/items/${item.id}`);
        closeModal();
        toast('Articolo disattivato', 'ok');
        ricarica?.();
      };
    },
  );
}

async function selezionaModello(card, inputSel, hiddenSel) {
  const input = $(inputSel, card);
  const hidden = $(hiddenSel, card);
  const box = document.createElement('div');
  box.className = 'choices';
  input.after(box);

  let timer;
  input.oninput = () => {
    hidden.value = '';
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (input.value.trim().length < 2) {
        box.innerHTML = '';
        return;
      }
      const models = await get(`/catalog/models?q=${encodeURIComponent(input.value)}&limit=12`);
      box.innerHTML = models
        .map((m) => html`<button type="button" data-model="${m.id}">${m.brand_name} ${m.name}</button>`)
        .join('') || html`<span class="muted small">Nessun modello. Aggiungilo da "Modelli e codici".</span>`;
      $$('[data-model]', box).forEach((btn) => {
        btn.onclick = () => {
          hidden.value = btn.dataset.model;
          input.value = btn.textContent.trim();
          box.innerHTML = html`<span class="tag ok">modello selezionato</span>`;
        };
      });
    }, 250);
  };
}

function nuovoArticoloModal(ricarica, prefill = {}) {
  const { categories, qualities, colors } = cache;
  openModal(
    html`<h2 style="margin-top:0">➕ Nuovo articolo</h2>
      <div class="field">
        <label>Modello (cerca per nome o codice)</label>
        <input id="nModelloTesto" placeholder="es. A526, iPhone 13, Redmi Note 11" value="${prefill.modello ?? ''}">
        <input type="hidden" id="nModello" value="${prefill.model_id ?? ''}">
      </div>
      <div class="row">
        <div class="field"><label>Categoria</label><select id="nCat">${opzioni(categories, prefill.category_id)}</select></div>
        <div class="field"><label>Qualità</label><select id="nQual">${opzioni(qualities, prefill.quality_id, { vuoto: '—' })}</select></div>
        <div class="field"><label>Colore</label>
          <input id="nColore" list="listaColori" value="${prefill.color ?? ''}">
          <datalist id="listaColori">${colors.map((c) => raw(html`<option value="${c.name}">`))}</datalist>
        </div>
      </div>
      <div class="row">
        <div class="field narrow"><label>Prezzo vendita</label><input id="nPrezzo" type="number" step="0.01" value="${prefill.price ?? 0}"></div>
        <div class="field narrow"><label>Costo</label><input id="nCosto" type="number" step="0.01"></div>
        <div class="field narrow"><label>Quantità</label><input id="nQta" type="number" min="0" value="${prefill.quantity ?? 0}"></div>
        <div class="field narrow"><label>Scorta minima</label><input id="nMin" type="number" min="0" value="${prefill.min_stock ?? 0}"></div>
      </div>
      <div class="field"><label>SKU / codice ricambio</label><input id="nSku" value="${prefill.sku ?? ''}"></div>
      <div class="modal-actions">
        <button data-annulla>Annulla</button>
        <button class="primary" data-salva>Crea articolo</button>
      </div>`,
    async (card) => {
      await selezionaModello(card, '#nModelloTesto', '#nModello');
      card.querySelector('[data-annulla]').onclick = closeModal;
      card.querySelector('[data-salva]').onclick = async () => {
        if (!$('#nModello', card).value) {
          toast('Seleziona prima il modello dall\'elenco', 'warn');
          return;
        }
        try {
          await post('/items', {
            model_id: Number($('#nModello', card).value),
            category_id: Number($('#nCat', card).value),
            quality_id: $('#nQual', card).value ? Number($('#nQual', card).value) : null,
            color: $('#nColore', card).value,
            price: Number($('#nPrezzo', card).value),
            cost: $('#nCosto', card).value === '' ? null : Number($('#nCosto', card).value),
            quantity: Number($('#nQta', card).value),
            min_stock: Number($('#nMin', card).value),
            sku: $('#nSku', card).value || null,
          });
          closeModal();
          toast('Articolo creato', 'ok');
          ricarica?.();
        } catch (err) {
          toast(err.message, 'err');
        }
      };
    },
  );
}

/* ============================ CATEGORIE ============================ */

export async function categorie() {
  const list = await get('/catalog/categories');
  view(html`
    <div class="page-head"><div><h1>🔧 Categorie ricambi</h1><p>Una pagina per ogni tipo di ricambio.</p></div></div>
    <div class="grid cols">
      ${list.map((c) => raw(html`<a class="cat-tile" href="#/magazzino?category_id=${c.id}">
        <span class="icon">${c.icon ?? '📦'}</span>
        <span class="name">${c.name}</span>
        <span class="muted small">${c.items_count} varianti · ${c.units} pezzi</span>
      </a>`))}
    </div>
  `);
}

/* ============================ DA ORDINARE ============================ */

export async function daOrdinare() {
  const data = await get('/stock/da-ordinare');
  view(html`
    <div class="page-head"><div><h1>🛒 Da ordinare</h1><p>Articoli sotto la scorta minima o esauriti.</p></div></div>
    <div class="stats">
      <div class="stat"><div class="label">Totale</div><div class="value">${data.totale}</div></div>
      <div class="stat"><div class="label">Esauriti</div><div class="value" style="color:var(--danger)">${data.esauriti}</div></div>
      <div class="stat"><div class="label">Sotto scorta</div><div class="value" style="color:var(--warn)">${data.sotto_scorta}</div></div>
    </div>
    ${data.gruppi.length
      ? data.gruppi.map((g) => raw(html`<h2>${g.nome} <span class="muted small">(${g.articoli.length})</span></h2>${raw(tabellaArticoli(g.articoli))}`))
      : raw(html`<div class="card empty">Nessun articolo da ordinare. ✅</div>`)}
  `);
  collegaTabella($('#view'), daOrdinare);
}

/* ============================ AVVISI ============================ */

export async function avvisi() {
  const data = await get('/stock/alerts');
  view(html`
    <div class="page-head"><div><h1>🔔 Avvisi scorte</h1><p>Generati quando una variante tocca la sua soglia minima.</p></div></div>
    ${data.totale === 0
      ? raw(html`<div class="card empty">Nessun avviso attivo. ✅</div>`)
      : data.avvisi.map((a) => raw(html`<div class="card" data-item="${a.item_id}">
          <div class="item-line">
            <div class="info">
              <div class="title">${a.brand_name} ${a.model_name} · ${a.category_name}${a.quality_name ? ` ${a.quality_name}` : ''}${a.color ? ` ${a.color}` : ''}</div>
              <div class="muted small mono">${a.model_codes ?? ''}</div>
              <div class="small">Rimasti <strong>${a.quantity_now}</strong> · minimo ${a.min_stock} · ${dateTime(a.created_at)}</div>
            </div>
            <button class="qty" data-delta="1">+1</button>
            <button data-letto="${a.id}">Segna letto</button>
          </div>
        </div>`))}
  `);
  collegaTabella($('#view'), avvisi);
  $$('[data-letto]').forEach((btn) => {
    btn.onclick = async () => {
      await post(`/stock/alerts/${btn.dataset.letto}/letto`);
      avvisi();
    };
  });
}

/* ============================ CARICO MERCE ============================ */

export async function carico() {
  const drafts = await get('/intake/drafts');
  view(html`
    <div class="page-head"><div><h1>📄 Carico merce</h1><p>Il documento non modifica il magazzino: prima si controlla l'anteprima.</p></div></div>
    <div class="card">
      <h2 style="margin-top:0">Nuovo documento</h2>
      <div class="row">
        <div class="field"><label>Fornitore</label><input id="cFornitore"></div>
        <div class="field"><label>Documento / DDT</label><input id="cDoc"></div>
      </div>
      <div class="field"><label>File PDF (fattura, DDT, packing list)</label><input type="file" id="cFile" accept="application/pdf"></div>
      <div class="field"><label>Oppure incolla le righe del listino</label><textarea id="cTesto" rows="4" placeholder="Display OLED Samsung A526 Nero  10  28,50"></textarea></div>
      <button class="primary" id="cAnalizza">🔍 Analizza</button>
    </div>
    <h2>Bozze in attesa</h2>
    ${drafts.length === 0
      ? raw(html`<div class="card empty">Nessuna bozza.</div>`)
      : raw(html`<div class="card" style="padding:0"><div class="table-wrap"><table>
          <thead><tr><th>Data</th><th>File</th><th>Fornitore</th><th>Documento</th><th>Stato</th><th></th></tr></thead>
          <tbody>${drafts.map((d) => raw(html`<tr>
            <td class="nowrap">${dateTime(d.created_at)}</td>
            <td>${d.filename ?? '—'}</td>
            <td>${d.supplier ?? '—'}</td>
            <td>${d.document_ref ?? '—'}</td>
            <td><span class="tag ${d.status === 'bozza' ? 'warn' : 'ok'}">${d.status}</span></td>
            <td class="nowrap">${raw(d.status === 'bozza'
              ? html`<button data-apri="${d.id}">Apri anteprima</button> <button class="ghost danger" data-elimina="${d.id}">🗑</button>`
              : html`<span class="muted small">confermata</span>`)}</td>
          </tr>`))}</tbody></table></div></div>`)}
    <h2>Storico carichi</h2>
    <div id="storico"><div class="loading">Caricamento…</div></div>
  `);

  $('#cAnalizza').onclick = async () => {
    const file = $('#cFile').files[0];
    const testo = $('#cTesto').value.trim();
    const fornitore = $('#cFornitore').value;
    const documento = $('#cDoc').value;
    try {
      let draft;
      if (file) {
        const form = new FormData();
        form.append('file', file);
        if (fornitore) form.append('fornitore', fornitore);
        if (documento) form.append('documento', documento);
        draft = await upload('/intake/pdf', form);
      } else if (testo) {
        draft = await post('/intake/testo', { testo, fornitore: fornitore || null, documento: documento || null });
      } else {
        toast('Carica un PDF o incolla le righe', 'warn');
        return;
      }
      location.hash = `#/anteprima/${draft.id}`;
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  $$('[data-apri]').forEach((b) => (b.onclick = () => (location.hash = `#/anteprima/${b.dataset.apri}`)));
  $$('[data-elimina]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog('Eliminare questa bozza?', { danger: true, ok: 'Elimina' }))) return;
    await del(`/intake/drafts/${b.dataset.elimina}`);
    carico();
  }));

  const storico = await get('/intake/storico');
  $('#storico').innerHTML = storico.totale === 0
    ? html`<div class="card empty">Nessun carico registrato.</div>`
    : storico.carichi.map((c) => html`<div class="card" data-carico="${c.id}">
        <div class="item-line">
          <div class="info">
            <div class="title">${c.supplier ?? 'Fornitore non indicato'} · ${c.document_ref ?? c.filename ?? `carico #${c.id}`}</div>
            <div class="muted small">${dateTime(c.created_at)} · ${c.righe.length} righe · ${c.pezzi} pezzi</div>
          </div>
        </div>
        <div class="table-wrap" style="margin-top:10px"><table>
          <thead><tr><th>Articolo</th><th class="num">Prima</th><th class="num">Caricati</th><th class="num">Dopo</th><th class="num">Costo</th></tr></thead>
          <tbody>${c.righe.map((r) => raw(html`<tr>
            <td>${[r.brand_name, r.model_name, '·', r.category_name, r.quality_name, r.color].filter(Boolean).join(' ')}
              ${raw(r.created_item ? '<span class="tag info">nuovo</span>' : '')}</td>
            <td class="num">${r.qty_before}</td><td class="num"><strong>+${r.qty_loaded}</strong></td>
            <td class="num">${r.qty_after}</td><td class="num">${r.unit_cost != null ? euro(r.unit_cost) : '—'}</td>
          </tr>`))}</tbody>
        </table></div>
      </div>`).join('');
}

export async function anteprima(params) {
  const id = params.id;
  const { categories, qualities, colors } = await catalogo();
  const draft = await get(`/intake/drafts/${id}`);
  const r = draft.riepilogo;

  const righe = draft.lines.filter((l) => l.azione !== 'ignora');

  view(html`
    <div class="page-head">
      <div><h1>👀 Anteprima carico</h1>
      <p>${draft.filename ?? 'righe incollate'} · ${draft.supplier ?? 'fornitore non indicato'} · ${draft.document_ref ?? 'senza documento'}</p></div>
      <div class="spacer"></div>
      <a class="btn" href="#/carico">← Indietro</a>
    </div>
    <div class="stats">
      <div class="stat"><div class="label">Righe prodotto</div><div class="value">${r.righe - r.ignorate}</div></div>
      <div class="stat"><div class="label">Pronte</div><div class="value" style="color:var(--ok)">${r.pronte}</div></div>
      <div class="stat"><div class="label">Da verificare</div><div class="value" style="color:var(--warn)">${r.da_verificare}</div></div>
      <div class="stat"><div class="label">Nuovi articoli</div><div class="value" style="color:var(--primary)">${r.nuovi_articoli}</div></div>
      <div class="stat"><div class="label">Pezzi totali</div><div class="value">${r.pezzi}</div></div>
    </div>

    ${draft.status !== 'bozza'
      ? raw(html`<div class="card"><span class="tag ok">Bozza già confermata</span></div>`)
      : raw(html`<div class="card">
          <p class="small muted" style="margin-top:0">Controlla ogni riga: le quantità dedotte e i nuovi articoli vanno confermati prima del carico.</p>
          <div class="row">
            <button class="primary" id="conferma">✅ Conferma carico</button>
            <button id="confermaSalta">Conferma solo le righe pronte</button>
            <div class="spacer"></div>
          </div>
        </div>`)}

    <div id="righe">${righe.map((l) => raw(rigaBozza(l, categories, qualities, colors)))}</div>
  `);

  if (draft.status !== 'bozza') return;

  $$('#righe [data-salva]').forEach((btn) => {
    btn.onclick = async () => {
      const box = btn.closest('[data-indice]');
      const indice = Number(box.dataset.indice);
      const patchLine = {
        indice,
        quantita: Number($('[data-q]', box).value),
        category_id: Number($('[data-cat]', box).value) || null,
        quality_id: $('[data-qual]', box).value ? Number($('[data-qual]', box).value) : null,
        color: $('[data-colore]', box).value,
      };
      const modello = $('[data-modello]', box);
      if (modello) patchLine.model_id = Number(modello.value) || null;
      const prezzo = $('[data-prezzo]', box);
      if (prezzo && prezzo.value !== '') {
        patchLine.prezzo_vendita = Number(prezzo.value);
        patchLine.aggiorna_prezzo = true;
      }
      try {
        await patch(`/intake/drafts/${id}`, { righe: [patchLine] });
        toast('Riga confermata', 'ok');
        anteprima(params);
      } catch (err) {
        toast(err.message, 'err');
      }
    };
  });

  $$('#righe [data-escludi]').forEach((btn) => {
    btn.onclick = async () => {
      const indice = Number(btn.closest('[data-indice]').dataset.indice);
      await patch(`/intake/drafts/${id}`, { righe: [{ indice, azione: 'ignora', stato: 'ignorata' }] });
      anteprima(params);
    };
  });

  const conferma = async (salta) => {
    if (!(await confirmDialog(
      salta ? 'Caricare solo le righe pronte?' : 'Confermare il carico? Le quantità verranno sommate al magazzino.',
      { ok: 'Conferma carico' },
    ))) return;
    try {
      const esito = await post(`/intake/drafts/${id}/conferma`, { salta_non_valide: salta });
      toast(`Carico #${esito.intake_id}: ${esito.righe_caricate} righe, ${esito.pezzi} pezzi`, 'ok', 6000);
      location.hash = '#/carico';
    } catch (err) {
      toast(err.message, 'err', 7000);
    }
  };
  $('#conferma').onclick = () => conferma(false);
  $('#confermaSalta').onclick = () => conferma(true);
}

function rigaBozza(l, categories, qualities, colors) {
  const candidati = l.resolution?.models ?? [];
  const modelloHtml = l.model_id
    ? html`<div class="field"><label>Modello riconosciuto</label>
        <select data-modello>${raw(candidati.length
          ? candidati.map((m) => html`<option value="${m.id}" ${m.id === l.model_id ? 'selected' : ''}>${m.brand} ${m.name}</option>`).join('')
          : html`<option value="${l.model_id}" selected>${l.brand_name} ${l.model_name}</option>`)}</select></div>`
    : html`<div class="field"><label>Modello — scegli tu</label>
        <select data-modello>
          <option value="">— da scegliere —</option>
          ${raw(candidati.map((m) => html`<option value="${m.id}">${m.brand} ${m.name}</option>`).join(''))}
        </select></div>`;

  return html`<div class="draft-line ${l.stato}" data-indice="${l.indice}">
    <div class="raw mono">${l.riga}</div>
    <div class="row">
      ${raw(modelloHtml)}
      <div class="field"><label>Ricambio</label><select data-cat>${opzioni(categories, l.category_id, { vuoto: '— da scegliere —' })}</select></div>
      <div class="field"><label>Qualità</label><select data-qual>${opzioni(qualities, l.quality_id, { vuoto: '—' })}</select></div>
      <div class="field"><label>Colore</label><input data-colore list="listaColori" value="${l.color ?? ''}"></div>
      <div class="field narrow"><label>Quantità</label><input data-q type="number" min="1" value="${l.quantita ?? ''}"></div>
      ${raw(l.nuovo_articolo ? html`<div class="field narrow"><label>Prezzo vendita</label><input data-prezzo type="number" step="0.01" value="${l.prezzo_vendita ?? ''}"></div>` : '')}
    </div>
    <div class="row" style="align-items:center">
      <div style="flex:1 1 auto" class="small">
        ${raw(l.item_id
          ? html`<span class="tag">in magazzino: ${l.quantita_attuale} → <strong>${(l.quantita_attuale ?? 0) + (Number(l.quantita) || 0)}</strong></span>`
          : html`<span class="tag info">NUOVO ARTICOLO</span>`)}
        ${raw(l.costo_unitario != null ? html`<span class="tag">costo ${euro(l.costo_unitario)}</span>` : '')}
        ${raw(l.sku ? html`<span class="tag mono">${l.sku}</span>` : '')}
        <span class="tag ${l.stato === 'pronta' ? 'ok' : 'warn'}">${l.stato === 'pronta' ? 'pronta' : 'da verificare'}</span>
      </div>
      <button data-escludi style="flex:0 0 auto">Escludi</button>
      <button class="primary" data-salva style="flex:0 0 auto">Conferma riga</button>
    </div>
    ${raw(l.note?.length ? html`<ul class="note-list">${l.note.map((n) => raw(html`<li>${n}</li>`))}</ul>` : '')}
    <datalist id="listaColori">${raw(colors.map((c) => html`<option value="${c.name}">`).join(''))}</datalist>
  </div>`;
}

/* ============================ VENDITE ============================ */

export async function vendite(params = {}) {
  const data = await get(`/sales/daily?date=${params.date ?? oggi()}`);
  view(html`
    <div class="page-head">
      <div><h1>📊 Vendite giornaliere</h1><p>WhatsApp e banco insieme.</p></div>
      <div class="spacer"></div>
      <div style="flex:0 0 auto"><input type="date" id="giorno" value="${data.date}"></div>
    </div>
    <div class="stats">
      <div class="stat"><div class="label">Vendite</div><div class="value">${data.vendite}</div></div>
      <div class="stat"><div class="label">Pezzi</div><div class="value">${data.pezzi}</div></div>
      <div class="stat"><div class="label">Incasso</div><div class="value">${euro(data.totale)}</div></div>
      ${data.per_canale.map((c) => raw(html`<div class="stat"><div class="label">${c.nome}</div><div class="value small">${euro(c.totale)} · ${c.pezzi} pz</div></div>`))}
    </div>
    ${data.righe.length === 0
      ? raw(html`<div class="card empty">Nessuna vendita in questa giornata.</div>`)
      : raw(html`<div class="card" style="padding:0"><div class="table-wrap"><table>
          <thead><tr><th>Ora</th><th>Canale</th><th>Articolo</th><th>Cliente</th><th class="num">Qtà</th><th class="num">Prezzo</th><th class="num">Totale</th><th></th></tr></thead>
          <tbody>${data.righe.map((r) => raw(html`<tr>
            <td class="nowrap">${time(r.created_at)}</td>
            <td><span class="tag">${r.channel}</span></td>
            <td>${[r.brand_name, r.model_name, '·', r.category_name, r.quality_name, r.color].filter(Boolean).join(' ')}</td>
            <td class="small">${r.customer_phone ?? r.customer_name ?? '—'}</td>
            <td class="num">${r.quantity}</td>
            <td class="num">${euro(r.unit_price)}</td>
            <td class="num"><strong>${euro(r.line_total)}</strong></td>
            <td><button class="ghost danger" data-storna="${r.sale_id}" title="Annulla vendita">↩</button></td>
          </tr>`))}</tbody></table></div></div>`)}
  `);

  $('#giorno').onchange = (e) => vendite({ date: e.target.value });
  $$('[data-storna]').forEach((btn) => {
    btn.onclick = async () => {
      if (!(await confirmDialog('Annullare la vendita? Le quantità tornano in magazzino.', { danger: true, ok: 'Annulla vendita' }))) return;
      await del(`/sales/${btn.dataset.storna}`);
      toast('Vendita annullata, quantità ripristinate', 'ok');
      vendite({ date: $('#giorno').value });
    };
  });
}

export async function riepilogo(params = {}) {
  const data = await get(`/sales/summary?date=${params.date ?? oggi()}`);
  view(html`
    <div class="page-head">
      <div><h1>💶 Riepilogo fine giornata</h1><p>${data.date}</p></div>
      <div class="spacer"></div>
      <div style="flex:0 0 auto"><input type="date" id="giorno" value="${data.date}"></div>
    </div>
    <div class="stats">
      <div class="stat"><div class="label">Vendite</div><div class="value">${data.vendite}</div></div>
      <div class="stat"><div class="label">Pezzi venduti</div><div class="value">${data.pezzi_venduti}</div></div>
      <div class="stat"><div class="label">Totale incassato</div><div class="value">${euro(data.totale)}</div></div>
      <div class="stat"><div class="label">Merce caricata</div><div class="value small">${data.carichi.documenti} doc · ${data.carichi.pezzi} pz</div></div>
      <div class="stat"><div class="label">Sotto scorta</div><div class="value" style="color:var(--warn)">${data.sotto_scorta_totale}</div></div>
    </div>

    <h2>Prodotti venduti</h2>
    ${data.prodotti.length === 0
      ? raw(html`<div class="card empty">Nessuna vendita.</div>`)
      : raw(html`<div class="card" style="padding:0"><div class="table-wrap"><table>
          <thead><tr><th>Prodotto</th><th class="num">Pezzi</th><th class="num">Totale</th></tr></thead>
          <tbody>${data.prodotti.map((p) => raw(html`<tr><td>${p.prodotto}</td><td class="num">${p.pezzi}</td><td class="num">${euro(p.totale)}</td></tr>`))}</tbody>
        </table></div></div>`)}

    <h2>Per canale</h2>
    <div class="card">${data.per_canale.length ? raw(barre(data.per_canale.map((c) => ({ nome: c.nome, valore: c.totale, testo: euro(c.totale) })))) : raw(html`<span class="muted">—</span>`)}</div>

    <h2>Per categoria</h2>
    <div class="card">${data.per_categoria.length ? raw(barre(data.per_categoria.map((c) => ({ nome: c.nome, valore: c.totale, testo: euro(c.totale) })))) : raw(html`<span class="muted">—</span>`)}</div>

    <h2>Articoli sotto scorta</h2>
    ${data.sotto_scorta.length === 0
      ? raw(html`<div class="card empty">Nessuno. ✅</div>`)
      : raw(html`<div class="card" style="padding:0"><div class="table-wrap"><table>
          <thead><tr><th>Articolo</th><th class="num">Rimasti</th><th class="num">Minimo</th></tr></thead>
          <tbody>${data.sotto_scorta.map((s) => raw(html`<tr>
            <td>${[s.brand_name, s.model_name, '·', s.category_name, s.quality_name, s.color].filter(Boolean).join(' ')}</td>
            <td class="num"><strong>${s.quantity}</strong></td><td class="num muted">${s.min_stock}</td>
          </tr>`))}</tbody></table></div></div>`)}
  `);
  $('#giorno').onchange = (e) => riepilogo({ date: e.target.value });
}

function barre(righe) {
  const max = Math.max(...righe.map((r) => r.valore), 1);
  return html`<div class="chart">${righe.map((r) => raw(html`<div class="chart-row">
    <span class="nowrap">${r.nome}</span>
    <span class="bar"><span style="width:${Math.max(2, (r.valore / max) * 100)}%"></span></span>
    <span class="num">${r.testo}</span>
  </div>`))}</div>`;
}

/* ============================ STATISTICHE ============================ */

export async function statistiche(params = {}) {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  const d = await get(`/stats?${qs}`);

  view(html`
    <div class="page-head">
      <div><h1>📈 Statistiche</h1><p>Periodo ${d.periodo.from} → ${d.periodo.to}</p></div>
      <div class="spacer"></div>
      <div class="row" style="flex:0 0 auto">
        <input type="date" id="da" value="${d.periodo.from}">
        <input type="date" id="a" value="${d.periodo.to}">
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="label">Vendite</div><div class="value">${d.riepilogo.vendite}</div></div>
      <div class="stat"><div class="label">Pezzi</div><div class="value">${d.riepilogo.pezzi}</div></div>
      <div class="stat"><div class="label">Incasso</div><div class="value">${euro(d.riepilogo.totale)}</div></div>
      <div class="stat"><div class="label">Scontrino medio</div><div class="value small">${euro(d.riepilogo.scontrino_medio)}</div></div>
      <div class="stat"><div class="label">Valore magazzino</div><div class="value small">${euro(d.magazzino.valore_vendita)}</div></div>
      <div class="stat"><div class="label">Pezzi a magazzino</div><div class="value small">${num(d.magazzino.pezzi)} in ${d.magazzino.varianti} varianti</div></div>
    </div>

    <h2>Andamento vendite</h2>
    <div class="card">${d.andamento.length ? raw(barre(d.andamento.map((g) => ({ nome: g.giorno, valore: g.totale, testo: `${euro(g.totale)} · ${g.pezzi} pz` })))) : raw(html`<span class="muted">Nessuna vendita nel periodo.</span>`)}</div>

    <h2>Prodotti più venduti</h2>
    ${raw(tabellaSemplice(
      ['Prodotto', 'Pezzi', 'Totale'],
      d.top_prodotti.map((p) => [
        [p.brand_name, p.model_name, '·', p.category_name, p.quality_name, p.color].filter(Boolean).join(' '),
        p.pezzi, euro(p.totale),
      ]),
    ))}

    <h2>Modelli più richiesti</h2>
    ${raw(tabellaSemplice(['Modello', 'Pezzi', 'Totale'], d.top_modelli.map((m) => [`${m.brand_name} ${m.model_name}`, m.pezzi, euro(m.totale)])))}

    <h2>Categorie</h2>
    <div class="card">${d.per_categoria.length ? raw(barre(d.per_categoria.map((c) => ({ nome: c.nome, valore: c.totale, testo: `${euro(c.totale)} · ${c.pezzi} pz` })))) : raw(html`<span class="muted">—</span>`)}</div>

    <h2>Articoli poco movimentati</h2>
    ${raw(tabellaSemplice(
      ['Articolo', 'Venduti nel periodo', 'A magazzino', 'Ultima vendita'],
      d.poco_movimentati.map((p) => [
        [p.brand_name, p.model_name, '·', p.category_name, p.quality_name, p.color].filter(Boolean).join(' '),
        p.venduti, p.quantity, p.ultima_vendita ? dateTime(p.ultima_vendita) : 'mai',
      ]),
    ))}
  `);

  const aggiorna = () => statistiche({ from: $('#da').value, to: $('#a').value });
  $('#da').onchange = aggiorna;
  $('#a').onchange = aggiorna;
}

function tabellaSemplice(intestazioni, righe) {
  if (!righe.length) return html`<div class="card empty">Nessun dato.</div>`;
  return html`<div class="card" style="padding:0"><div class="table-wrap"><table>
    <thead><tr>${intestazioni.map((h, i) => raw(html`<th class="${i ? 'num' : ''}">${h}</th>`))}</tr></thead>
    <tbody>${righe.map((r) => raw(html`<tr>${r.map((c, i) => raw(html`<td class="${i ? 'num' : ''}">${c}</td>`))}</tr>`))}</tbody>
  </table></div></div>`;
}

/* ============================ PRODOTTI MANCANTI ============================ */

export async function mancanti() {
  const data = await get('/missing');
  view(html`
    <div class="page-head">
      <div><h1>➕ Prodotti mancanti</h1><p>Individuati fuori (fornitori, cataloghi) ma non presenti a magazzino. Non sono disponibili finché non entrano davvero.</p></div>
      <div class="spacer"></div>
      <button class="primary" id="aggiungi">➕ Aggiungi</button>
      <button id="confronta">🔎 Confronta catalogo</button>
    </div>
    ${data.totale === 0
      ? raw(html`<div class="card empty">Nessun prodotto segnalato.</div>`)
      : raw(html`<div class="card" style="padding:0"><div class="table-wrap"><table>
          <thead><tr><th>Modello</th><th>Codice</th><th>Ricambio</th><th>Colore</th><th>Fonte</th><th>Stato</th><th></th></tr></thead>
          <tbody>${data.prodotti.map((p) => raw(html`<tr>
            <td>${[p.brand_name, p.model_name].filter(Boolean).join(' ') || '—'}</td>
            <td class="mono">${p.model_code ?? '—'}</td>
            <td>${p.category_name ?? '—'}</td>
            <td>${p.color ?? '—'}</td>
            <td class="small">${p.source ?? '—'}</td>
            <td><span class="tag ${p.status === 'importato' ? 'ok' : ''}">${p.status}</span></td>
            <td class="nowrap">
              <button data-importa="${p.id}" title="Crea a catalogo">📥</button>
              <button class="ghost danger" data-elimina="${p.id}">🗑</button>
            </td>
          </tr>`))}</tbody></table></div></div>`)}
  `);

  $('#aggiungi').onclick = () => mancanteModal();
  $('#confronta').onclick = () => confrontoModal();
  $$('[data-elimina]').forEach((b) => (b.onclick = async () => {
    await del(`/missing/${b.dataset.elimina}`);
    mancanti();
  }));
  $$('[data-importa]').forEach((b) => (b.onclick = async () => {
    const p = data.prodotti.find((x) => x.id === Number(b.dataset.importa));
    await catalogo();
    nuovoArticoloModal(async () => {
      await patch(`/missing/${p.id}`, { status: 'importato' });
      mancanti();
    }, {
      modello: [p.brand_name, p.model_name, p.model_code].filter(Boolean).join(' '),
      color: p.color ?? '',
    });
  }));
}

function mancanteModal() {
  openModal(
    html`<h2 style="margin-top:0">➕ Prodotto mancante</h2>
      <div class="row">
        <div class="field"><label>Marca</label><input id="pMarca"></div>
        <div class="field"><label>Modello</label><input id="pModello"></div>
        <div class="field"><label>Codice</label><input id="pCodice"></div>
      </div>
      <div class="row">
        <div class="field"><label>Ricambio</label><input id="pCat"></div>
        <div class="field"><label>Colore</label><input id="pColore"></div>
      </div>
      <div class="row">
        <div class="field"><label>Fonte</label><input id="pFonte" placeholder="fornitore, sito…"></div>
        <div class="field"><label>Link</label><input id="pUrl"></div>
      </div>
      <div class="modal-actions"><button data-annulla>Annulla</button><button class="primary" data-salva>Salva</button></div>`,
    (card) => {
      card.querySelector('[data-annulla]').onclick = closeModal;
      card.querySelector('[data-salva]').onclick = async () => {
        try {
          await post('/missing', {
            brand_name: $('#pMarca', card).value || null,
            model_name: $('#pModello', card).value || null,
            model_code: $('#pCodice', card).value || null,
            category_name: $('#pCat', card).value || null,
            color: $('#pColore', card).value || null,
            source: $('#pFonte', card).value || null,
            url: $('#pUrl', card).value || null,
          });
          closeModal();
          toast('Prodotto segnalato', 'ok');
          mancanti();
        } catch (err) {
          toast(err.message, 'err');
        }
      };
    },
  );
}

function confrontoModal() {
  openModal(
    html`<h2 style="margin-top:0">🔎 Confronta con un catalogo esterno</h2>
      <p class="muted small">Incolla le righe del catalogo di un fornitore: il sistema segnala ciò che non hai a magazzino.</p>
      <div class="field"><label>Fonte</label><input id="xFonte" placeholder="nome fornitore o sito"></div>
      <div class="field"><label>Righe</label><textarea id="xRighe" rows="8" placeholder="Display OLED Samsung A546 Nero&#10;Batteria iPhone 14"></textarea></div>
      <div class="modal-actions">
        <button data-annulla>Annulla</button>
        <button class="primary" data-analizza>Analizza e salva i mancanti</button>
      </div>`,
    (card) => {
      card.querySelector('[data-annulla]').onclick = closeModal;
      card.querySelector('[data-analizza]').onclick = async () => {
        const righe = $('#xRighe', card).value.split('\n').map((r) => r.trim()).filter(Boolean);
        if (!righe.length) return;
        try {
          const esito = await post('/missing/confronta', { source: $('#xFonte', card).value || 'catalogo esterno', righe, salva: true });
          closeModal();
          toast(`${esito.analizzate} righe: ${esito.presenti} già a catalogo, ${esito.mancanti.length} mancanti`, 'ok', 6000);
          mancanti();
        } catch (err) {
          toast(err.message, 'err');
        }
      };
    },
  );
}

/* ============================ ASSISTENTE WHATSAPP ============================ */

const ESEMPI = [
  'Avete display Samsung A16?',
  'A526',
  'display A526 nero',
  'Hello, do you have a screen for A526?',
  'Bonjour, avez-vous une batterie pour iPhone 13 ?',
  '¿Tienen pantalla para A526?',
];

export async function assistente(params = {}) {
  const telefono = params.telefono ?? '+390000000000';
  const [stato, elenco] = await Promise.all([get('/whatsapp/stato'), get('/whatsapp/conversazioni')]);

  view(html`
    <div class="page-head">
      <div><h1>💬 Assistente WhatsApp</h1><p>La stessa logica che risponde ai clienti su WhatsApp, provabile qui.</p></div>
    </div>

    <div class="card">
      <div class="row" style="align-items:center">
        <div style="flex:1 1 auto">
          <strong>Stato collegamento</strong>
          <div class="small muted">
            ${raw(stato.attivo
              ? html`<span class="tag ok">WhatsApp collegato</span> I messaggi dei clienti ricevono risposta automatica.`
              : html`<span class="tag warn">WhatsApp non collegato</span> Il simulatore funziona lo stesso; per rispondere ai clienti veri servono le credenziali WhatsApp Business API.`)}
          </div>
        </div>
      </div>
      <div class="row small muted" style="margin-top:10px">
        <span class="tag ${stato.invio_configurato ? 'ok' : ''}">invio messaggi: ${stato.invio_configurato ? 'sì' : 'no'}</span>
        <span class="tag ${stato.webhook_configurato ? 'ok' : ''}">webhook: ${stato.webhook_configurato ? 'sì' : 'no'}</span>
        <span class="tag ${stato.firma_verificata ? 'ok' : ''}">firma verificata: ${stato.firma_verificata ? 'sì' : 'no'}</span>
        <span class="tag">avvisi scorte: ${stato.avvisi_scorte}</span>
      </div>
    </div>

    <div class="card">
      <div class="row" style="margin-bottom:10px">
        <div style="flex:0 1 240px"><label>Numero del cliente</label><input id="aTel" value="${telefono}"></div>
        <div class="spacer"></div>
        <button id="aSvuota" style="flex:0 0 auto">🗑 Cancella conversazione</button>
      </div>
      <div class="chat" id="chat"><div class="chat-vuota">Scrivi come farebbe un cliente su WhatsApp.</div></div>
      <form id="aForm" class="row" style="margin-top:10px">
        <input id="aTesto" placeholder="Messaggio del cliente…" autocomplete="off">
        <button class="primary" style="flex:0 0 auto">Invia</button>
      </form>
      <div class="esempi">${ESEMPI.map((e) => raw(html`<button data-esempio="${e}">${e}</button>`))}</div>
    </div>

    <h2>Conversazioni</h2>
    ${elenco.totale === 0
      ? raw(html`<div class="card empty">Nessuna conversazione.</div>`)
      : raw(html`<div class="card" style="padding:0"><div class="table-wrap"><table>
          <thead><tr><th>Cliente</th><th>Lingua</th><th>Stato</th><th class="num">Messaggi</th><th class="num">Ordini</th><th>Ultimo contatto</th><th></th></tr></thead>
          <tbody>${elenco.conversazioni.map((c) => raw(html`<tr>
            <td><strong>${c.phone}</strong>${c.name ? raw(html`<div class="muted small">${c.name}</div>`) : ''}</td>
            <td><span class="tag">${c.lingua}</span></td>
            <td class="small">${c.stato}</td>
            <td class="num">${c.messaggi}</td>
            <td class="num">${c.ordini}</td>
            <td class="small nowrap">${dateTime(c.updated_at)}</td>
            <td class="nowrap">
              <button data-apri="${c.phone}">Apri</button>
              <button class="ghost danger" data-dimentica="${c.phone}" title="Cancella i dati di questo cliente">🗑</button>
            </td>
          </tr>`))}</tbody></table></div></div>`)}
  `);

  const chat = $('#chat');
  const mostra = (messaggi) => {
    chat.innerHTML = messaggi.length
      ? messaggi
          .map((m) => html`<div class="bolla ${m.direzione === 'entrata' ? 'cliente' : 'bot'}">${m.testo}</div>`)
          .join('')
      : html`<div class="chat-vuota">Scrivi come farebbe un cliente su WhatsApp.</div>`;
    chat.scrollTop = chat.scrollHeight;
  };

  const caricaConversazione = async () => {
    const dati = await get(`/whatsapp/conversazioni/${encodeURIComponent($('#aTel').value)}`);
    mostra(dati.messaggi);
  };

  const invia = async (testo) => {
    if (!testo.trim()) return;
    try {
      await post('/whatsapp/simula', { telefono: $('#aTel').value, testo });
      $('#aTesto').value = '';
      await caricaConversazione();
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  $('#aForm').onsubmit = (event) => {
    event.preventDefault();
    invia($('#aTesto').value);
  };
  $$('[data-esempio]').forEach((b) => (b.onclick = () => invia(b.dataset.esempio)));
  $('#aTel').onchange = caricaConversazione;
  $('#aSvuota').onclick = async () => {
    await del(`/whatsapp/conversazioni/${encodeURIComponent($('#aTel').value)}`);
    toast('Conversazione cancellata', 'ok');
    assistente({ telefono: $('#aTel').value });
  };
  $$('[data-apri]').forEach((b) => (b.onclick = () => assistente({ telefono: b.dataset.apri })));
  $$('[data-dimentica]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog(`Cancellare tutti i dati di ${b.dataset.dimentica}?`, { danger: true, ok: 'Cancella' }))) return;
    await del(`/whatsapp/conversazioni/${encodeURIComponent(b.dataset.dimentica)}`);
    assistente(params);
  }));

  await caricaConversazione();
  $('#aTesto').focus();
}

/* ============================ CATALOGO MODELLI ============================ */

export async function catalogoModelli(params = {}) {
  const [brands, irrisolte] = await Promise.all([get('/catalog/brands'), get('/catalog/unresolved')]);
  const models = await get(`/catalog/models?limit=60${params.q ? `&q=${encodeURIComponent(params.q)}` : ''}${params.brand_id ? `&brand_id=${params.brand_id}` : ''}`);

  view(html`
    <div class="page-head">
      <div><h1>📚 Modelli e codici</h1><p>Il sistema impara: ogni codice associato resta memorizzato.</p></div>
      <div class="spacer"></div>
      <button class="primary" id="nuovoModello">➕ Nuovo modello</button>
    </div>

    ${irrisolte.length ? raw(html`<div class="card">
      <h2 style="margin-top:0">❓ Richieste non riconosciute (${irrisolte.length})</h2>
      <p class="muted small">Codici arrivati che il sistema non ha saputo identificare: insegnagli a chi appartengono.</p>
      ${irrisolte.slice(0, 20).map((u) => raw(html`<div class="item-line" style="padding:6px 0; border-bottom:1px solid var(--border)">
        <div class="info"><span class="mono">${u.query}</span> <span class="tag warn">${u.reason}</span>
          <span class="muted small">${dateTime(u.created_at)}</span></div>
        <button data-insegna="${u.id}" data-query="${u.query}">Associa a un modello</button>
      </div>`))}
    </div>`) : ''}

    <div class="card">
      <div class="row">
        <div><label>Cerca modello o codice</label><input id="mQ" value="${params.q ?? ''}" placeholder="A526, iPhone 13…"></div>
        <div><label>Marca</label><select id="mBrand">
          <option value="">Tutte</option>
          ${brands.map((b) => raw(html`<option value="${b.id}" ${String(b.id) === String(params.brand_id) ? 'selected' : ''}>${b.name} (${b.models_count})</option>`))}
        </select></div>
      </div>
    </div>

    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>Marca</th><th>Modello</th><th>Anno</th><th>Codici</th><th class="num">Articoli</th><th></th></tr></thead>
      <tbody>${models.map((m) => raw(html`<tr>
        <td>${m.brand_name}</td>
        <td><strong>${m.name}</strong></td>
        <td class="muted">${m.year ?? '—'}</td>
        <td class="mono small">${m.codes ?? '—'}</td>
        <td class="num">${m.items_count}</td>
        <td><button data-codice="${m.id}" title="Aggiungi codice">＋ codice</button></td>
      </tr>`))}</tbody>
    </table></div></div>
  `);

  let timer;
  $('#mQ').oninput = (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => catalogoModelli({ ...params, q: e.target.value }), 300);
  };
  $('#mBrand').onchange = (e) => catalogoModelli({ ...params, brand_id: e.target.value });
  $('#nuovoModello').onclick = () => nuovoModelloModal();

  $$('[data-codice]').forEach((b) => (b.onclick = () => aggiungiCodiceModal(Number(b.dataset.codice))));
  $$('[data-insegna]').forEach((b) => (b.onclick = () => insegnaModal(Number(b.dataset.insegna), b.dataset.query)));
}

function nuovoModelloModal() {
  openModal(
    html`<h2 style="margin-top:0">➕ Nuovo modello</h2>
      <div class="row">
        <div class="field"><label>Marca</label><input id="kMarca" placeholder="Samsung, Apple…"></div>
        <div class="field"><label>Nome commerciale</label><input id="kNome" placeholder="Galaxy A56 5G"></div>
        <div class="field narrow"><label>Anno</label><input id="kAnno" type="number"></div>
      </div>
      <div class="field"><label>Codici (separati da virgola)</label><input id="kCodici" placeholder="A566, SM-A566B"></div>
      <div class="modal-actions"><button data-annulla>Annulla</button><button class="primary" data-salva>Crea</button></div>`,
    (card) => {
      card.querySelector('[data-annulla]').onclick = closeModal;
      card.querySelector('[data-salva]').onclick = async () => {
        try {
          await post('/catalog/models', {
            brand: $('#kMarca', card).value,
            name: $('#kNome', card).value,
            year: $('#kAnno', card).value ? Number($('#kAnno', card).value) : null,
            codes: $('#kCodici', card).value.split(',').map((c) => c.trim()).filter(Boolean),
          });
          closeModal();
          toast('Modello aggiunto', 'ok');
          catalogoModelli();
        } catch (err) {
          toast(err.message, 'err');
        }
      };
    },
  );
}

function aggiungiCodiceModal(modelId) {
  openModal(
    html`<h2 style="margin-top:0">＋ Aggiungi codice</h2>
      <div class="field"><label>Codice</label><input id="cCodice" placeholder="SM-A526B/DS"></div>
      <div class="modal-actions"><button data-annulla>Annulla</button><button class="primary" data-salva>Salva</button></div>`,
    (card) => {
      card.querySelector('[data-annulla]').onclick = closeModal;
      card.querySelector('[data-salva]').onclick = async () => {
        try {
          await post(`/catalog/models/${modelId}/codes`, { code: $('#cCodice', card).value });
          closeModal();
          toast('Codice associato', 'ok');
          catalogoModelli();
        } catch (err) {
          toast(err.message, 'err', 6000);
        }
      };
    },
  );
}

function insegnaModal(unresolvedId, query) {
  openModal(
    html`<h2 style="margin-top:0">Associa "${query}"</h2>
      <div class="field">
        <label>Modello</label>
        <input id="iModelloTesto" placeholder="cerca per nome o codice">
        <input type="hidden" id="iModello">
      </div>
      <div class="field"><label>Codice da memorizzare (facoltativo)</label><input id="iCodice" value="${query}"></div>
      <div class="modal-actions"><button data-annulla>Annulla</button><button class="primary" data-salva>Associa</button></div>`,
    async (card) => {
      await selezionaModello(card, '#iModelloTesto', '#iModello');
      card.querySelector('[data-annulla]').onclick = closeModal;
      card.querySelector('[data-salva]').onclick = async () => {
        if (!$('#iModello', card).value) {
          toast('Seleziona il modello dall\'elenco', 'warn');
          return;
        }
        try {
          await post(`/catalog/unresolved/${unresolvedId}/resolve`, {
            model_id: Number($('#iModello', card).value),
            code: $('#iCodice', card).value || null,
          });
          closeModal();
          toast('Associazione memorizzata', 'ok');
          catalogoModelli();
        } catch (err) {
          toast(err.message, 'err', 6000);
        }
      };
    },
  );
}
