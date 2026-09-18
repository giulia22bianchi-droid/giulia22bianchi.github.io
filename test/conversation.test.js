import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'magazzino-chat-'));
process.env.DB_PATH = join(dir, 'test.db');
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

let rispondi;
let dimenticaCliente;
let getItem;
let db;
let displayNero;
let batteria;

before(async () => {
  const { seed } = await import('../server/seed/run.js');
  seed();
  ({ db } = await import('../server/db.js'));
  ({ getItem } = await import('../server/lib/inventory.js'));
  ({ rispondi, dimenticaCliente } = await import('../server/lib/conversation.js'));
  const { createItem } = await import('../server/routes/items.js');

  const a526 = db
    .prepare(`SELECT model_id FROM model_codes WHERE normalized = 'A526'`)
    .get().model_id;
  const display = db.prepare(`SELECT id FROM categories WHERE slug = 'display'`).get().id;
  const batterie = db.prepare(`SELECT id FROM categories WHERE slug = 'batterie'`).get().id;
  const oled = db.prepare(`SELECT id FROM qualities WHERE slug = 'oled'`).get().id;

  displayNero = createItem({ model_id: a526, category_id: display, quality_id: oled, color: 'Nero', price: 59.9, quantity: 5, min_stock: 2 });
  createItem({ model_id: a526, category_id: display, quality_id: oled, color: 'Bianco', price: 59.9, quantity: 3, min_stock: 2 });
  batteria = createItem({ model_id: a526, category_id: batterie, color: '', price: 19.9, quantity: 2, min_stock: 1 });
});

function chat(telefono, messaggi) {
  dimenticaCliente(telefono);
  return messaggi.map((testo) => rispondi({ telefono, testo }));
}

describe('conversazione con il cliente', () => {
  test('il codice da solo non presume il ricambio', () => {
    const [r] = chat('+3901', ['A526']);
    assert.equal(r.stato, 'scelta_ricambio');
    assert.match(r.testo, /Display/);
    assert.match(r.testo, /Batterie/);
  });

  test('propone i colori e poi il prezzo', () => {
    const [primo, secondo] = chat('+3902', ['display A526', 'Nero']);
    assert.equal(primo.stato, 'scelta_colore');
    assert.equal(secondo.stato, 'conferma');
    assert.match(secondo.testo, /59\.90 €/);
  });

  test('un modello ambiguo viene chiesto, non scelto', () => {
    const [r] = chat('+3903', ['avete display per Samsung A52?']);
    assert.equal(r.stato, 'scelta_modello');
    assert.match(r.testo, /A52 5G/);
    assert.match(r.testo, /A52 4G/);
  });

  test('chiedere il prezzo non scarica il magazzino', () => {
    const prima = getItem(displayNero.id).quantity;
    chat('+3904', ['display A526 nero']);
    assert.equal(getItem(displayNero.id).quantity, prima);
  });

  test('il magazzino si scarica solo alla conferma', () => {
    const prima = getItem(displayNero.id).quantity;
    const risposte = chat('+3905', ['display A526 nero', 'sì']);
    assert.match(risposte[1].testo, /Ordine confermato/);
    assert.equal(getItem(displayNero.id).quantity, prima - 1);
  });

  test('la vendita registra numero cliente e canale', () => {
    chat('+393351112233', ['display A526 nero', 'sì']);
    const vendita = db
      .prepare(`SELECT * FROM sales WHERE customer_phone = ? ORDER BY id DESC LIMIT 1`)
      .get('+393351112233');
    assert.ok(vendita);
    assert.equal(vendita.channel, 'whatsapp');
  });

  test('rispondere "no" non registra nulla', () => {
    const prima = getItem(displayNero.id).quantity;
    const risposte = chat('+3906', ['display A526 nero', 'no']);
    assert.equal(risposte[1].stato, 'iniziale');
    assert.equal(getItem(displayNero.id).quantity, prima);
  });

  test('una quantità superiore alla disponibilità non viene mai venduta', () => {
    const disponibili = getItem(batteria.id).quantity;
    const risposte = chat('+3907', ['batteria A526', String(disponibili + 5)]);
    assert.equal(risposte[1].stato, 'conferma');
    assert.match(risposte[1].testo, new RegExp(String(disponibili)));
    assert.equal(getItem(batteria.id).quantity, disponibili);
  });

  test('un modello sconosciuto chiede di ripetere', () => {
    const [r] = chat('+3908', ['avete ricambi per ZZZ9999?']);
    assert.equal(r.stato, 'iniziale');
    assert.match(r.testo, /SM-A526B/);
  });
});

describe('risposte nella lingua del cliente', () => {
  const casi = [
    ['+3910', 'Hello, do you have a screen for A526?', 'en', /Which one do you prefer/],
    ['+3911', 'Bonjour, avez-vous un écran pour A526 ?', 'fr', /Laquelle préférez-vous/],
    ['+3912', '¿Tienen pantalla para A526?', 'es', /Cuál prefieres/],
    ['+3913', 'Buna, aveti ecran pentru A526?', 'ro', /Pe care o preferi/],
    ['+3914', 'مرحبا، هل لديكم شاشة لـ A526؟', 'ar', /أي لون تفضل/],
  ];

  for (const [telefono, messaggio, lingua, atteso] of casi) {
    test(`risponde in ${lingua}`, () => {
      const [r] = chat(telefono, [messaggio]);
      assert.equal(r.lingua, lingua);
      assert.match(r.testo, atteso);
    });
  }

  test('accetta il colore scritto in altre lingue', () => {
    const [, r] = chat('+3915', ['Do you have a screen for A526?', 'black']);
    assert.equal(r.stato, 'conferma');
    assert.match(r.testo, /Black/);
  });

  test('accetta il ricambio scritto in altre lingue', () => {
    const [, r] = chat('+3916', ['A526', 'battery']);
    assert.match(r.testo, /Battery/);
  });

  test('la lingua resta quella scelta anche per i messaggi senza indizi', () => {
    const risposte = chat('+3917', ['Do you have a screen for A526?', '3']);
    assert.equal(risposte[1].lingua, 'en');
  });
});

describe('dati personali', () => {
  test('la cancellazione rimuove conversazione e messaggi', async () => {
    const { registraMessaggio } = await import('../server/lib/conversation.js');
    chat('+3920', ['display A526 nero']);
    registraMessaggio({ id: 'test-msg-1', phone: '+3920', direzione: 'entrata', testo: 'ciao' });
    const esito = dimenticaCliente('+3920');
    assert.equal(esito.conversazioni, 1);
    assert.ok(esito.messaggi >= 1);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM conversations WHERE phone = ?`).get('+3920').n, 0);
  });
});
