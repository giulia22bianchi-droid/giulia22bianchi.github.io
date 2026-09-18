import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Database temporaneo: i test non devono toccare il magazzino vero
const dir = mkdtempSync(join(tmpdir(), 'magazzino-test-'));
process.env.DB_PATH = join(dir, 'test.db');
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

let resolveQuery;
let parseLine;

before(async () => {
  const { seed } = await import('../server/seed/run.js');
  seed();
  ({ resolveQuery } = await import('../server/lib/resolver.js'));
  ({ parseLine } = await import('../server/lib/pdfIntake.js'));
});

describe('riconoscimento del modello', () => {
  test('un codice esatto identifica il telefono', () => {
    const r = resolveQuery('A526');
    assert.equal(r.status, 'ok');
    assert.equal(r.models[0].name, 'Galaxy A52 5G');
  });

  test('riconosce il codice completo con suffissi', () => {
    assert.equal(resolveQuery('SM-A526B/DS').models[0].name, 'Galaxy A52 5G');
    assert.equal(resolveQuery('sm a526b').models[0].name, 'Galaxy A52 5G');
  });

  test('un codice ambiguo non viene indovinato', () => {
    assert.equal(resolveQuery('A52').status, 'ambiguous');
    assert.equal(resolveQuery('avete display Samsung A16?').status, 'ambiguous');
  });

  test('un nome completo vince sulle varianti Pro', () => {
    const r = resolveQuery('batteria iPhone 13');
    assert.equal(r.status, 'ok');
    assert.equal(r.models[0].name, 'iPhone 13');
  });

  test('le sottomarche Xiaomi restano raggiungibili', () => {
    assert.equal(resolveQuery('Xiaomi Redmi Note 11 2201117TG').models[0].name, 'Redmi Note 11');
    assert.equal(resolveQuery('poco x3 pro').models[0].name, 'POCO X3 Pro');
  });

  test('un codice sconosciuto non produce falsi positivi', () => {
    assert.equal(resolveQuery('ZZZ9999').status, 'not_found');
    assert.equal(resolveQuery('articolo generico 2 5,00 10,00').status, 'not_found');
  });
});

describe('riconoscimento di ricambio, qualità e colore', () => {
  test('capisce la categoria in più lingue', () => {
    assert.equal(resolveQuery('display A526').category.slug, 'display');
    assert.equal(resolveQuery('écran A526').category.slug, 'display');
    assert.equal(resolveQuery('screen A526').category.slug, 'display');
    assert.equal(resolveQuery('pantalla A526').category.slug, 'display');
    assert.equal(resolveQuery('batteria A526').category.slug, 'batterie');
  });

  test('distingue vetro fotocamera da display', () => {
    assert.equal(resolveQuery('vetro fotocamera A526').category.slug, 'vetro-fotocamera');
  });

  test('riconosce qualità e colore anche tradotti', () => {
    const r = resolveQuery('display a526 oled noir');
    assert.equal(r.quality.slug, 'oled');
    assert.equal(r.color, 'Nero');
  });

  test('senza ricambio indicato la categoria resta vuota', () => {
    assert.equal(resolveQuery('A526').category, null);
  });
});

describe('lettura delle righe di un documento fornitore', () => {
  test('estrae quantità e costo senza confonderli con i codici', () => {
    const l = parseLine('DSP-441  Display OLED Samsung Galaxy A52 5G SM-A526B Nero   8   28,50  228,00');
    assert.equal(l.quantita, 8);
    assert.equal(l.costo_unitario, 28.5);
    assert.equal(l.model_name, 'Galaxy A52 5G');
    assert.equal(l.category_name, 'Display');
    assert.equal(l.quality_name, 'OLED');
    assert.equal(l.color, 'Nero');
    assert.equal(l.sku, 'DSP-441');
  });

  test('la quantità etichettata ha la precedenza', () => {
    const l = parseLine('Batteria Samsung SM-A515 Q.tà 20 prezzo 7,40');
    assert.equal(l.quantita, 20);
    assert.equal(l.quantita_origine, 'etichetta');
  });

  test('un codice articolo con cifre non diventa la quantità', () => {
    const l = parseLine('CON220 Connettore di ricarica Xiaomi Redmi Note 10 M2101K7AG 15 3,20 48,00');
    assert.equal(l.quantita, 15);
  });

  test('le righe di totali e dati fiscali vengono ignorate', () => {
    for (const riga of ['Imponibile 621,90', 'IVA 22% 136,82', 'TOTALE DOCUMENTO 758,72', 'P.IVA 01234567890']) {
      assert.equal(parseLine(riga).azione, 'ignora', riga);
    }
  });

  test('una riga non identificabile resta da verificare, mai caricata', () => {
    const l = parseLine('XXX999 Articolo generico non identificabile 2 5,00 10,00');
    assert.equal(l.azione, 'verifica');
    assert.notEqual(l.stato, 'pronta');
  });

  test('un prodotto nuovo viene segnalato invece di essere creato in silenzio', () => {
    const l = parseLine('Display Service Pack Samsung Galaxy A54 5G A546 Nero 6 41,00 246,00');
    assert.equal(l.azione, 'crea');
    assert.equal(l.nuovo_articolo, true);
    assert.notEqual(l.stato, 'pronta');
  });
});
