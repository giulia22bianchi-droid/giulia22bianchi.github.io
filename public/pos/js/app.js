import { Store } from './store.js';

const data = Store.load();
let cart = []; // { productId, name, price, qty }
let paymentMethod = 'Contanti';
let activeCategory = 'tutte';
let salesRange = 'oggi';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function persist() { Store.save(data); }

function money(n) {
  const v = Number(n) || 0;
  return `${data.settings.currency}${v.toFixed(2)}`;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function categoryName(id) {
  const c = data.categories.find((c) => c.id === id);
  return c ? c.name : '—';
}

function stockStatus(p) {
  if (p.stock <= 0) return 'critical';
  if (p.stock <= p.minStock) return 'warning';
  return 'good';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- Navigazione ---------------- */
function showView(name) {
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  if (name === 'prodotti') renderProdotti();
  if (name === 'magazzino') renderMagazzino();
  if (name === 'clienti') renderClienti();
  if (name === 'vendite') renderVendite();
  if (name === 'statistiche') renderStatistiche();
  if (name === 'impostazioni') renderImpostazioni();
  if (name === 'cassa') renderCassa();
}

$$('.nav-btn').forEach((btn) => btn.addEventListener('click', () => showView(btn.dataset.view)));

/* ---------------- Modal ---------------- */
function openModal(innerHtml, onMount) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-overlay"><div class="modal">${innerHtml}</div></div>`;
  root.querySelector('.modal-overlay').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeModal();
  });
  if (onMount) onMount(root.querySelector('.modal'));
}

function closeModal() {
  $('#modal-root').innerHTML = '';
}

/* ================= CASSA ================= */
function renderPosCategories() {
  const wrap = $('#pos-categories');
  const cats = [{ id: 'tutte', name: 'Tutte' }, ...data.categories];
  wrap.innerHTML = cats
    .map((c) => `<button type="button" class="chip ${activeCategory === String(c.id) ? 'active' : ''}" data-cat="${c.id}">${escapeHtml(c.name)}</button>`)
    .join('');
  $$('.chip', wrap).forEach((chip) =>
    chip.addEventListener('click', () => {
      activeCategory = chip.dataset.cat;
      renderPosCategories();
      renderPosGrid();
    })
  );
}

function renderPosGrid() {
  const term = $('#pos-search').value.trim().toLowerCase();
  const grid = $('#pos-grid');
  let list = data.products;
  if (activeCategory !== 'tutte') list = list.filter((p) => String(p.categoryId) === activeCategory);
  if (term) list = list.filter((p) => p.name.toLowerCase().includes(term) || (p.barcode || '').includes(term));

  if (!list.length) {
    grid.innerHTML = '<p class="empty-state">Nessun prodotto trovato</p>';
    return;
  }

  grid.innerHTML = list
    .map(
      (p) => `
      <button type="button" class="product-card" data-id="${p.id}" ${p.stock <= 0 ? 'disabled' : ''}>
        <span class="name">${escapeHtml(p.name)}</span>
        <span class="price">${money(p.price)}</span>
        <span class="stock">Scorta: ${p.stock}</span>
      </button>`
    )
    .join('');

  $$('.product-card', grid).forEach((card) =>
    card.addEventListener('click', () => addToCart(Number(card.dataset.id)))
  );
}

function renderPosCustomers() {
  const sel = $('#pos-customer');
  const current = sel.value;
  sel.innerHTML = '<option value="">— nessun cliente —</option>' +
    data.customers.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  sel.value = current;
}

function addToCart(productId) {
  const product = data.products.find((p) => p.id === productId);
  if (!product) return;
  const inCart = cart.find((i) => i.productId === productId);
  const qtyInCart = inCart ? inCart.qty : 0;
  if (qtyInCart + 1 > product.stock) {
    toast(`Scorta insufficiente per "${product.name}"`);
    return;
  }
  if (inCart) inCart.qty += 1;
  else cart.push({ productId, name: product.name, price: product.price, qty: 1 });
  renderCart();
  renderPosGrid();
}

function changeCartQty(productId, delta) {
  const item = cart.find((i) => i.productId === productId);
  if (!item) return;
  const product = data.products.find((p) => p.id === productId);
  const newQty = item.qty + delta;
  if (newQty <= 0) {
    cart = cart.filter((i) => i.productId !== productId);
  } else if (product && newQty > product.stock) {
    toast(`Scorta insufficiente per "${product.name}"`);
    return;
  } else {
    item.qty = newQty;
  }
  renderCart();
}

function cartTotals() {
  const subtotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const rate = Number(data.settings.taxRate) || 0;
  const tax = subtotal - subtotal / (1 + rate / 100);
  const discountPct = Math.min(100, Math.max(0, Number($('#pos-discount').value) || 0));
  const discountAmount = subtotal * (discountPct / 100);
  const total = subtotal - discountAmount;
  return { subtotal, tax, discountPct, discountAmount, total };
}

function renderCart() {
  const wrap = $('#cart-items');
  if (!cart.length) {
    wrap.innerHTML = '<p class="empty-state">Il carrello è vuoto</p>';
  } else {
    wrap.innerHTML = cart
      .map(
        (i) => `
      <div class="cart-row" data-id="${i.productId}">
        <span>${escapeHtml(i.name)}</span>
        <span class="qty-ctrl">
          <button type="button" data-act="dec">−</button>
          <span>${i.qty}</span>
          <button type="button" data-act="inc">+</button>
        </span>
        <span>${money(i.price * i.qty)}</span>
        <button type="button" class="ghost" data-act="remove" title="Rimuovi">✕</button>
      </div>`
      )
      .join('');
    $$('.cart-row', wrap).forEach((row) => {
      const id = Number(row.dataset.id);
      row.querySelector('[data-act="dec"]').addEventListener('click', () => changeCartQty(id, -1));
      row.querySelector('[data-act="inc"]').addEventListener('click', () => changeCartQty(id, 1));
      row.querySelector('[data-act="remove"]').addEventListener('click', () => {
        cart = cart.filter((i) => i.productId !== id);
        renderCart();
      });
    });
  }
  const t = cartTotals();
  $('#pos-subtotal').textContent = money(t.subtotal);
  $('#pos-tax').textContent = money(t.tax);
  $('#pos-discount-amount').textContent = `−${money(t.discountAmount)}`;
  $('#pos-total').textContent = money(t.total);
}

$('#pos-search').addEventListener('input', renderPosGrid);
$('#pos-discount').addEventListener('input', renderCart);

$$('.payment-choice button').forEach((btn) =>
  btn.addEventListener('click', () => {
    paymentMethod = btn.dataset.payment;
    $$('.payment-choice button').forEach((b) => b.classList.toggle('selected', b === btn));
  })
);

$('#pos-clear').addEventListener('click', () => {
  cart = [];
  renderCart();
});

$('#pos-confirm').addEventListener('click', () => {
  if (!cart.length) {
    toast('Il carrello è vuoto');
    return;
  }
  for (const item of cart) {
    const product = data.products.find((p) => p.id === item.productId);
    if (!product || product.stock < item.qty) {
      toast(`Scorta insufficiente per "${item.name}"`);
      return;
    }
  }

  const t = cartTotals();
  const customerId = $('#pos-customer').value ? Number($('#pos-customer').value) : null;
  const customer = customerId ? data.customers.find((c) => c.id === customerId) : null;

  const sale = {
    id: Store.nextId(data, 'sale'),
    dateISO: new Date().toISOString(),
    items: cart.map((i) => ({ productId: i.productId, name: i.name, price: i.price, qty: i.qty })),
    subtotal: t.subtotal,
    taxAmount: t.tax,
    discountPct: t.discountPct,
    discountAmount: t.discountAmount,
    total: t.total,
    payment: paymentMethod,
    customerId,
    customerName: customer ? customer.name : null,
  };

  cart.forEach((item) => {
    const product = data.products.find((p) => p.id === item.productId);
    product.stock -= item.qty;
    data.movements.push({
      id: Store.nextId(data, 'movement'),
      dateISO: sale.dateISO,
      productId: product.id,
      productName: product.name,
      delta: -item.qty,
      reason: `Vendita #${sale.id}`,
    });
  });

  data.sales.push(sale);
  persist();

  cart = [];
  $('#pos-discount').value = 0;
  $('#pos-customer').value = '';
  renderCart();
  renderPosGrid();
  showReceipt(sale);
  toast('Vendita registrata');
});

function showReceipt(sale) {
  const date = new Date(sale.dateISO).toLocaleString('it-IT');
  openModal(
    `
    <div class="receipt">
      <h2 style="text-align:center;">${escapeHtml(data.settings.businessName)}</h2>
      <p style="text-align:center; color:var(--text-muted);">Scontrino #${sale.id} — ${date}</p>
      ${sale.customerName ? `<p>Cliente: ${escapeHtml(sale.customerName)}</p>` : ''}
      <hr />
      ${sale.items
        .map((i) => `<div class="line"><span>${i.qty}× ${escapeHtml(i.name)}</span><span>${money(i.price * i.qty)}</span></div>`)
        .join('')}
      <hr />
      <div class="line"><span>Subtotale</span><span>${money(sale.subtotal)}</span></div>
      ${sale.discountAmount > 0 ? `<div class="line"><span>Sconto (${sale.discountPct}%)</span><span>−${money(sale.discountAmount)}</span></div>` : ''}
      <div class="line"><span>di cui IVA</span><span>${money(sale.taxAmount)}</span></div>
      <div class="line" style="font-weight:700; font-size:16px;"><span>Totale</span><span>${money(sale.total)}</span></div>
      <p style="text-align:center; margin-top:10px;">Pagamento: ${escapeHtml(sale.payment)}</p>
    </div>
    <div class="modal-actions">
      <button id="btn-print-receipt">🖨️ Stampa</button>
      <button class="primary" id="btn-close-receipt">Chiudi</button>
    </div>`,
    (modal) => {
      modal.querySelector('#btn-print-receipt').addEventListener('click', () => window.print());
      modal.querySelector('#btn-close-receipt').addEventListener('click', closeModal);
    }
  );
}

function renderCassa() {
  renderPosCategories();
  renderPosGrid();
  renderPosCustomers();
  renderCart();
}

/* ================= PRODOTTI ================= */
function categoryOptions(selectedId) {
  return data.categories
    .map((c) => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    .join('');
}

function renderProdotti() {
  const term = $('#prodotti-search').value.trim().toLowerCase();
  const tbody = $('#prodotti-tbody');
  let list = data.products;
  if (term) list = list.filter((p) => p.name.toLowerCase().includes(term) || (p.barcode || '').includes(term));

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Nessun prodotto</td></tr>';
    return;
  }

  tbody.innerHTML = list
    .map(
      (p) => `
    <tr data-id="${p.id}">
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(categoryName(p.categoryId))}</td>
      <td>${money(p.price)}</td>
      <td>${money(p.cost)}</td>
      <td>${p.stock}</td>
      <td>${p.minStock}</td>
      <td>${escapeHtml(p.barcode || '—')}</td>
      <td>
        <button type="button" class="ghost" data-act="edit">✏️</button>
        <button type="button" class="ghost" data-act="delete">🗑️</button>
      </td>
    </tr>`
    )
    .join('');

  $$('tr[data-id]', tbody).forEach((row) => {
    const id = Number(row.dataset.id);
    row.querySelector('[data-act="edit"]').addEventListener('click', () => openProductModal(id));
    row.querySelector('[data-act="delete"]').addEventListener('click', () => {
      if (confirm('Eliminare questo prodotto?')) {
        data.products = data.products.filter((p) => p.id !== id);
        persist();
        renderProdotti();
      }
    });
  });
}

function openProductModal(id) {
  const existing = id ? data.products.find((p) => p.id === id) : null;
  openModal(
    `
    <h2>${existing ? 'Modifica prodotto' : 'Nuovo prodotto'}</h2>
    <div class="field"><label>Nome</label><input id="f-name" value="${existing ? escapeHtml(existing.name) : ''}" /></div>
    <div class="field"><label>Categoria</label><select id="f-cat">${categoryOptions(existing?.categoryId)}</select></div>
    <div class="field"><label>Prezzo di vendita</label><input id="f-price" type="number" step="0.01" min="0" value="${existing ? existing.price : ''}" /></div>
    <div class="field"><label>Costo (opzionale)</label><input id="f-cost" type="number" step="0.01" min="0" value="${existing ? existing.cost : ''}" /></div>
    <div class="field"><label>Scorta attuale</label><input id="f-stock" type="number" min="0" value="${existing ? existing.stock : 0}" /></div>
    <div class="field"><label>Scorta minima</label><input id="f-min" type="number" min="0" value="${existing ? existing.minStock : 0}" /></div>
    <div class="field"><label>Codice a barre (opzionale)</label><input id="f-barcode" value="${existing ? escapeHtml(existing.barcode || '') : ''}" /></div>
    <div class="modal-actions">
      <button class="ghost" id="btn-cancel">Annulla</button>
      <button class="primary" id="btn-save">Salva</button>
    </div>`,
    (modal) => {
      modal.querySelector('#btn-cancel').addEventListener('click', closeModal);
      modal.querySelector('#btn-save').addEventListener('click', () => {
        const name = modal.querySelector('#f-name').value.trim();
        if (!name) { toast('Il nome è obbligatorio'); return; }
        const payload = {
          name,
          categoryId: Number(modal.querySelector('#f-cat').value),
          price: Number(modal.querySelector('#f-price').value) || 0,
          cost: Number(modal.querySelector('#f-cost').value) || 0,
          stock: Number(modal.querySelector('#f-stock').value) || 0,
          minStock: Number(modal.querySelector('#f-min').value) || 0,
          barcode: modal.querySelector('#f-barcode').value.trim(),
        };
        if (existing) Object.assign(existing, payload);
        else data.products.push({ id: Store.nextId(data, 'product'), ...payload });
        persist();
        closeModal();
        renderProdotti();
      });
    }
  );
}

function openCategoryModal() {
  openModal(
    `
    <h2>Nuova categoria</h2>
    <div class="field"><label>Nome</label><input id="f-cat-name" /></div>
    <div class="modal-actions">
      <button class="ghost" id="btn-cancel">Annulla</button>
      <button class="primary" id="btn-save">Salva</button>
    </div>`,
    (modal) => {
      modal.querySelector('#btn-cancel').addEventListener('click', closeModal);
      modal.querySelector('#btn-save').addEventListener('click', () => {
        const name = modal.querySelector('#f-cat-name').value.trim();
        if (!name) { toast('Il nome è obbligatorio'); return; }
        data.categories.push({ id: Store.nextId(data, 'category'), name });
        persist();
        closeModal();
        renderProdotti();
      });
    }
  );
}

$('#prodotti-search').addEventListener('input', renderProdotti);
$('#btn-nuovo-prodotto').addEventListener('click', () => openProductModal(null));
$('#btn-nuova-categoria').addEventListener('click', openCategoryModal);

/* ================= MAGAZZINO ================= */
function applyMovement(productId, delta, reason) {
  const product = data.products.find((p) => p.id === productId);
  if (!product) return;
  if (product.stock + delta < 0) {
    toast('La scorta non può essere negativa');
    return;
  }
  product.stock += delta;
  data.movements.push({
    id: Store.nextId(data, 'movement'),
    dateISO: new Date().toISOString(),
    productId: product.id,
    productName: product.name,
    delta,
    reason: reason || 'Correzione manuale',
  });
  persist();
  renderMagazzino();
}

function openMovementModal(productId) {
  openModal(
    `
    <h2>Movimento di magazzino</h2>
    <div class="field"><label>Quantità (negativa per scarico)</label><input id="f-delta" type="number" value="1" /></div>
    <div class="field"><label>Motivo</label><input id="f-reason" placeholder="es. carico merce, rottura, inventario" /></div>
    <div class="modal-actions">
      <button class="ghost" id="btn-cancel">Annulla</button>
      <button class="primary" id="btn-save">Applica</button>
    </div>`,
    (modal) => {
      modal.querySelector('#btn-cancel').addEventListener('click', closeModal);
      modal.querySelector('#btn-save').addEventListener('click', () => {
        const delta = Number(modal.querySelector('#f-delta').value);
        if (!delta) { toast('Inserisci una quantità diversa da zero'); return; }
        applyMovement(productId, delta, modal.querySelector('#f-reason').value.trim());
        closeModal();
      });
    }
  );
}

function renderMagazzino() {
  const onlyLow = $('#solo-sotto-scorta').checked;
  const tbody = $('#magazzino-tbody');
  let list = data.products;
  if (onlyLow) list = list.filter((p) => p.stock <= p.minStock);

  tbody.innerHTML = list.length
    ? list
        .map((p) => {
          const status = stockStatus(p);
          const label = status === 'critical' ? 'Esaurito' : status === 'warning' ? 'Sotto scorta' : 'OK';
          return `
        <tr data-id="${p.id}">
          <td>${escapeHtml(p.name)}</td>
          <td>${escapeHtml(categoryName(p.categoryId))}</td>
          <td>${p.stock}</td>
          <td>${p.minStock}</td>
          <td><span class="badge ${status}">${label}</span></td>
          <td>
            <button type="button" data-act="dec">−1</button>
            <button type="button" data-act="inc">+1</button>
            <button type="button" class="ghost" data-act="custom">altro…</button>
          </td>
        </tr>`;
        })
        .join('')
    : '<tr><td colspan="6" class="empty-state">Nessun prodotto</td></tr>';

  $$('tr[data-id]', tbody).forEach((row) => {
    const id = Number(row.dataset.id);
    row.querySelector('[data-act="dec"]').addEventListener('click', () => applyMovement(id, -1, 'Correzione manuale'));
    row.querySelector('[data-act="inc"]').addEventListener('click', () => applyMovement(id, 1, 'Correzione manuale'));
    row.querySelector('[data-act="custom"]').addEventListener('click', () => openMovementModal(id));
  });

  const movBody = $('#movimenti-tbody');
  const recent = [...data.movements].sort((a, b) => new Date(b.dateISO) - new Date(a.dateISO)).slice(0, 20);
  movBody.innerHTML = recent.length
    ? recent
        .map(
          (m) => `
      <tr>
        <td>${new Date(m.dateISO).toLocaleString('it-IT')}</td>
        <td>${escapeHtml(m.productName)}</td>
        <td>${m.delta > 0 ? '+' : ''}${m.delta}</td>
        <td>${escapeHtml(m.reason)}</td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="4" class="empty-state">Nessun movimento</td></tr>';
}

$('#solo-sotto-scorta').addEventListener('change', renderMagazzino);

/* ================= CLIENTI ================= */
function customerTotal(customerId) {
  return data.sales.filter((s) => s.customerId === customerId).reduce((sum, s) => sum + s.total, 0);
}

function renderClienti() {
  const term = $('#clienti-search').value.trim().toLowerCase();
  const tbody = $('#clienti-tbody');
  let list = data.customers;
  if (term) list = list.filter((c) => c.name.toLowerCase().includes(term));

  tbody.innerHTML = list.length
    ? list
        .map(
          (c) => `
      <tr data-id="${c.id}">
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.phone || '—')}</td>
        <td>${escapeHtml(c.email || '—')}</td>
        <td>${money(customerTotal(c.id))}</td>
        <td>
          <button type="button" class="ghost" data-act="edit">✏️</button>
          <button type="button" class="ghost" data-act="delete">🗑️</button>
        </td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="5" class="empty-state">Nessun cliente</td></tr>';

  $$('tr[data-id]', tbody).forEach((row) => {
    const id = Number(row.dataset.id);
    row.querySelector('[data-act="edit"]').addEventListener('click', () => openCustomerModal(id));
    row.querySelector('[data-act="delete"]').addEventListener('click', () => {
      if (confirm('Eliminare questo cliente?')) {
        data.customers = data.customers.filter((c) => c.id !== id);
        persist();
        renderClienti();
      }
    });
  });
}

function openCustomerModal(id) {
  const existing = id ? data.customers.find((c) => c.id === id) : null;
  openModal(
    `
    <h2>${existing ? 'Modifica cliente' : 'Nuovo cliente'}</h2>
    <div class="field"><label>Nome</label><input id="f-name" value="${existing ? escapeHtml(existing.name) : ''}" /></div>
    <div class="field"><label>Telefono</label><input id="f-phone" value="${existing ? escapeHtml(existing.phone || '') : ''}" /></div>
    <div class="field"><label>Email</label><input id="f-email" value="${existing ? escapeHtml(existing.email || '') : ''}" /></div>
    <div class="field"><label>Note</label><textarea id="f-notes" rows="2">${existing ? escapeHtml(existing.notes || '') : ''}</textarea></div>
    <div class="modal-actions">
      <button class="ghost" id="btn-cancel">Annulla</button>
      <button class="primary" id="btn-save">Salva</button>
    </div>`,
    (modal) => {
      modal.querySelector('#btn-cancel').addEventListener('click', closeModal);
      modal.querySelector('#btn-save').addEventListener('click', () => {
        const name = modal.querySelector('#f-name').value.trim();
        if (!name) { toast('Il nome è obbligatorio'); return; }
        const payload = {
          name,
          phone: modal.querySelector('#f-phone').value.trim(),
          email: modal.querySelector('#f-email').value.trim(),
          notes: modal.querySelector('#f-notes').value.trim(),
        };
        if (existing) Object.assign(existing, payload);
        else data.customers.push({ id: Store.nextId(data, 'customer'), ...payload });
        persist();
        closeModal();
        renderClienti();
      });
    }
  );
}

$('#clienti-search').addEventListener('input', renderClienti);
$('#btn-nuovo-cliente').addEventListener('click', () => openCustomerModal(null));

/* ================= VENDITE ================= */
function salesInRange(range) {
  const now = new Date();
  return data.sales.filter((s) => {
    const d = new Date(s.dateISO);
    if (range === 'oggi') return d.toDateString() === now.toDateString();
    if (range === '7' || range === '30') {
      const days = Number(range);
      const diff = (now - d) / (1000 * 60 * 60 * 24);
      return diff <= days;
    }
    return true; // tutto
  });
}

function renderVendite() {
  $$('.chip', $('[data-view="vendite"] .toolbar')).forEach((c) => c.classList.toggle('active', c.dataset.range === salesRange));
  const tbody = $('#vendite-tbody');
  const list = [...salesInRange(salesRange)].sort((a, b) => new Date(b.dateISO) - new Date(a.dateISO));

  tbody.innerHTML = list.length
    ? list
        .map(
          (s) => `
      <tr data-id="${s.id}">
        <td>${new Date(s.dateISO).toLocaleString('it-IT')}</td>
        <td>${escapeHtml(s.customerName || '—')}</td>
        <td>${s.items.reduce((n, i) => n + i.qty, 0)}</td>
        <td>${escapeHtml(s.payment)}</td>
        <td>${money(s.total)}</td>
        <td><button type="button" class="ghost" data-act="view">👁️</button></td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="empty-state">Nessuna vendita nel periodo</td></tr>';

  $$('tr[data-id]', tbody).forEach((row) => {
    const id = Number(row.dataset.id);
    row.querySelector('[data-act="view"]').addEventListener('click', () => {
      const sale = data.sales.find((s) => s.id === id);
      if (sale) showReceipt(sale);
    });
  });
}

$$('[data-view="vendite"] .chip').forEach((chip) =>
  chip.addEventListener('click', () => {
    salesRange = chip.dataset.range;
    renderVendite();
  })
);

/* ================= STATISTICHE ================= */
function sumTotals(sales) { return sales.reduce((sum, s) => sum + s.total, 0); }

function renderStatistiche() {
  const today = salesInRange('oggi');
  const week = salesInRange('7');
  const month = salesInRange('30');
  const lowStockCount = data.products.filter((p) => p.stock <= p.minStock).length;
  const avgTicket = today.length ? sumTotals(today) / today.length : 0;

  $('#stat-tiles').innerHTML = `
    <div class="stat-tile"><div class="label">Incasso oggi</div><div class="value">${money(sumTotals(today))}</div></div>
    <div class="stat-tile"><div class="label">Incasso 7 giorni</div><div class="value">${money(sumTotals(week))}</div></div>
    <div class="stat-tile"><div class="label">Incasso 30 giorni</div><div class="value">${money(sumTotals(month))}</div></div>
    <div class="stat-tile"><div class="label">Scontrini oggi</div><div class="value">${today.length}</div></div>
    <div class="stat-tile"><div class="label">Scontrino medio oggi</div><div class="value">${money(avgTicket)}</div></div>
    <div class="stat-tile"><div class="label">Articoli sotto scorta</div><div class="value ${lowStockCount ? 'critical' : ''}">${lowStockCount}</div></div>
  `;

  // Top 5 prodotti venduti (30 giorni)
  const qtyByProduct = new Map();
  month.forEach((s) => s.items.forEach((i) => qtyByProduct.set(i.name, (qtyByProduct.get(i.name) || 0) + i.qty)));
  const top = [...qtyByProduct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxQty = top.length ? top[0][1] : 1;

  $('#top-prodotti').innerHTML = top.length
    ? top
        .map(
          ([name, qty]) => `
      <div class="bar-row">
        <span class="label">${escapeHtml(name)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${(qty / maxQty) * 100}%"></span></span>
        <span class="value">${qty} pz</span>
      </div>`
        )
        .join('')
    : '<p class="empty-state">Nessuna vendita negli ultimi 30 giorni</p>';

  // Split per metodo di pagamento (30 giorni)
  const cash = sumTotals(month.filter((s) => s.payment === 'Contanti'));
  const card = sumTotals(month.filter((s) => s.payment === 'Carta'));
  const totalPay = cash + card;

  $('#payment-split').innerHTML = totalPay
    ? `
      <div class="split-bar">
        <span class="seg-1" style="width:${(cash / totalPay) * 100}%"></span>
        <span class="seg-2" style="width:${(card / totalPay) * 100}%"></span>
      </div>
      <div class="legend">
        <span><span class="swatch" style="background:var(--series-1)"></span>Contanti — ${money(cash)}</span>
        <span><span class="swatch" style="background:var(--series-2)"></span>Carta — ${money(card)}</span>
      </div>`
    : '<p class="empty-state">Nessuna vendita negli ultimi 30 giorni</p>';
}

/* ================= IMPOSTAZIONI ================= */
function renderImpostazioni() {
  $('#set-nome').value = data.settings.businessName;
  $('#set-valuta').value = data.settings.currency;
  $('#set-iva').value = data.settings.taxRate;
}

$('#btn-salva-impostazioni').addEventListener('click', () => {
  data.settings.businessName = $('#set-nome').value.trim() || 'La Mia Attività';
  data.settings.currency = $('#set-valuta').value.trim() || '€';
  data.settings.taxRate = Number($('#set-iva').value) || 0;
  persist();
  $('.brand').innerHTML = `${escapeHtml(data.settings.businessName)}<small>punto vendita</small>`;
  toast('Impostazioni salvate');
});

$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `novacassa-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$('#btn-import').addEventListener('click', () => $('#file-import').click());
$('#file-import').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      Object.assign(data, Store.defaultData(), imported);
      persist();
      toast('Backup importato');
      showView('cassa');
    } catch (err) {
      toast('File non valido');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

$('#btn-reset').addEventListener('click', () => {
  if (confirm('Cancellare tutti i dati di NovaCassa? L\'operazione non è reversibile.')) {
    Store.save(Store.defaultData());
    location.reload();
  }
});

/* ---------------- Avvio ---------------- */
$('.brand').innerHTML = `${escapeHtml(data.settings.businessName)}<small>punto vendita</small>`;
renderCassa();
