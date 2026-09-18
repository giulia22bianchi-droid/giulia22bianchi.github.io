import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { InventoryError, adjustStock, getItem } from '../lib/inventory.js';
import { createItem } from './items.js';
import { parsePdf, parseText, draftSummary, findExistingItem } from '../lib/pdfIntake.js';
import { broadcast } from '../lib/events.js';

export const intakeRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) cb(null, true);
    else cb(new InventoryError('Sono accettati solo file PDF'));
  },
});

function saveDraft({ filename, supplier, documentRef, lines }) {
  const id = db
    .prepare(`INSERT INTO intake_drafts (filename, supplier, document_ref, lines) VALUES (?, ?, ?, ?)`)
    .run(filename ?? null, supplier ?? null, documentRef ?? null, JSON.stringify(lines)).lastInsertRowid;
  return getDraft(Number(id));
}

function getDraft(id) {
  const draft = db.prepare(`SELECT * FROM intake_drafts WHERE id = ?`).get(id);
  if (!draft) return null;
  draft.lines = JSON.parse(draft.lines);
  draft.riepilogo = draftSummary(draft.lines);
  return draft;
}

// Il PDF non modifica il magazzino: produce solo un'anteprima da controllare
intakeRouter.post('/pdf', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new InventoryError('Nessun file ricevuto (campo "file")');
    const parsed = await parsePdf(req.file.buffer);
    const draft = saveDraft({
      filename: req.file.originalname,
      supplier: req.body?.fornitore || parsed.fornitore,
      documentRef: req.body?.documento || parsed.documento,
      lines: parsed.righe,
    });
    res.status(201).json({ ...draft, pagine: parsed.pagine });
  } catch (err) {
    next(err);
  }
});

// Stessa analisi partendo da testo incollato (listino, email, packing list)
intakeRouter.post('/testo', (req, res) => {
  const { testo, fornitore = null, documento = null } = req.body ?? {};
  if (!testo || !String(testo).trim()) throw new InventoryError('Campo "testo" obbligatorio');
  const lines = parseText(testo);
  res.status(201).json(saveDraft({ filename: null, supplier: fornitore, documentRef: documento, lines }));
});

intakeRouter.get('/drafts', (req, res) => {
  const rows = db
    .prepare(`SELECT id, created_at, filename, supplier, document_ref, status FROM intake_drafts
              ORDER BY created_at DESC LIMIT 100`)
    .all();
  res.json(rows);
});

intakeRouter.get('/drafts/:id', (req, res) => {
  const draft = getDraft(Number(req.params.id));
  if (!draft) throw new InventoryError('Bozza non trovata', 404);
  res.json(draft);
});

// Correzione dell'anteprima prima della conferma
intakeRouter.patch('/drafts/:id', (req, res) => {
  const id = Number(req.params.id);
  const draft = getDraft(id);
  if (!draft) throw new InventoryError('Bozza non trovata', 404);
  if (draft.status !== 'bozza') throw new InventoryError('Bozza già confermata', 409);

  const { fornitore, documento, righe } = req.body ?? {};
  let lines = draft.lines;

  if (Array.isArray(righe)) {
    lines = lines.map((line) => {
      const patch = righe.find((r) => r.indice === line.indice);
      if (!patch) return line;
      const merged = { ...line, ...patch };
      // Una riga corretta a mano non è più "dedotta": l'ha decisa una persona
      if (patch.quantita !== undefined) merged.quantita_origine = 'manuale';

      if (merged.azione !== 'ignora' && merged.model_id && merged.category_id) {
        // Se è cambiato modello, qualità o colore, l'articolo di destinazione va ricalcolato
        const existing = findExistingItem({
          modelId: merged.model_id,
          categoryId: merged.category_id,
          qualityId: merged.quality_id ?? null,
          color: merged.color ?? '',
        });
        merged.item_id = existing?.id ?? null;
        merged.quantita_attuale = existing?.quantity ?? 0;
        merged.azione = existing ? 'carica' : 'crea';
        merged.nuovo_articolo = !existing;
        merged.stato = Number(merged.quantita) > 0 ? 'pronta' : 'da_verificare';
      }
      return merged;
    });
  }

  db.prepare(
    `UPDATE intake_drafts SET lines = ?, supplier = COALESCE(?, supplier), document_ref = COALESCE(?, document_ref)
     WHERE id = ?`,
  ).run(JSON.stringify(lines), fornitore ?? null, documento ?? null, id);

  res.json(getDraft(id));
});

intakeRouter.delete('/drafts/:id', (req, res) => {
  db.prepare(`DELETE FROM intake_drafts WHERE id = ?`).run(Number(req.params.id));
  res.json({ ok: true });
});

/**
 * Conferma del carico: solo adesso le quantità vengono sommate.
 * Le righe non risolte bloccano l'operazione, a meno di chiedere esplicitamente di saltarle.
 */
intakeRouter.post('/drafts/:id/conferma', (req, res) => {
  const id = Number(req.params.id);
  const draft = getDraft(id);
  if (!draft) throw new InventoryError('Bozza non trovata', 404);
  if (draft.status !== 'bozza') throw new InventoryError('Bozza già confermata', 409);

  const { salta_non_valide: skipInvalid = false, note = null, actor = null } = req.body ?? {};
  const candidates = draft.lines.filter((l) => l.azione === 'carica' || l.azione === 'crea');

  // Una riga entra a magazzino solo se è completa e confermata: le quantità dedotte,
  // i modelli ambigui e i nuovi articoli devono passare dall'anteprima.
  const invalid = candidates.filter(
    (l) =>
      l.stato !== 'pronta' ||
      !l.model_id ||
      !l.category_id ||
      !Number.isInteger(Number(l.quantita)) ||
      Number(l.quantita) <= 0,
  );
  if (invalid.length && !skipInvalid) {
    throw new InventoryError(
      `${invalid.length} righe non sono ancora confermate: controlla modello, ricambio e quantità nell'anteprima (oppure imposta salta_non_valide).`,
      400,
      { righe: invalid.map((l) => ({ indice: l.indice, riga: l.riga, note: l.note, stato: l.stato })) },
    );
  }

  const toLoad = candidates.filter((l) => !invalid.includes(l));
  if (toLoad.length === 0) throw new InventoryError('Nessuna riga valida da caricare');

  const intakeId = Number(
    db
      .prepare(`INSERT INTO intakes (supplier, document_ref, filename, note) VALUES (?, ?, ?, ?)`)
      .run(draft.supplier, draft.document_ref, draft.filename, note).lastInsertRowid,
  );

  const insertLine = db.prepare(
    `INSERT INTO intake_lines (intake_id, item_id, qty_before, qty_loaded, qty_after, unit_cost,
       created_item, raw_line, brand_name, model_name, model_code, category_name, quality_name, color)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const applied = [];
  for (const line of toLoad) {
    const quantity = Number(line.quantita);
    let itemId = line.item_id;
    let createdItem = 0;

    if (!itemId) {
      const item = createItem({
        model_id: line.model_id,
        category_id: line.category_id,
        quality_id: line.quality_id ?? null,
        color: line.color ?? '',
        sku: line.sku ?? null,
        price: Number(line.prezzo_vendita ?? 0),
        cost: line.costo_unitario ?? null,
        quantity: 0,
        min_stock: Number(line.scorta_minima ?? 0),
        note: `Creato dal carico ${draft.document_ref ?? draft.filename ?? ''}`.trim(),
      });
      itemId = item.id;
      createdItem = 1;
    }

    const before = getItem(itemId).quantity;
    const updated = adjustStock({
      itemId,
      delta: quantity,
      reason: 'carico merce',
      refType: 'intake',
      refId: intakeId,
      actor,
    });

    if (line.costo_unitario != null) {
      db.prepare(`UPDATE items SET cost = ? WHERE id = ?`).run(Number(line.costo_unitario), itemId);
    }
    if (line.prezzo_vendita != null && line.aggiorna_prezzo) {
      db.prepare(`UPDATE items SET price = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(Number(line.prezzo_vendita), itemId);
    }

    insertLine.run(
      intakeId,
      itemId,
      before,
      quantity,
      updated.quantity,
      line.costo_unitario ?? null,
      createdItem,
      line.riga ?? null,
      updated.brand_name,
      updated.model_name,
      updated.model_codes,
      updated.category_name,
      updated.quality_name,
      updated.color,
    );

    applied.push({
      item_id: itemId,
      articolo: `${updated.brand_name} ${updated.model_name} · ${updated.category_name}${
        updated.quality_name ? ` ${updated.quality_name}` : ''
      }${updated.color ? ` ${updated.color}` : ''}`,
      quantita_precedente: before,
      caricati: quantity,
      quantita_nuova: updated.quantity,
      nuovo_articolo: Boolean(createdItem),
    });
  }

  db.prepare(`UPDATE intake_drafts SET status = 'confermata' WHERE id = ?`).run(id);
  broadcast('carico', { intake_id: intakeId, righe: applied.length });

  res.status(201).json({
    intake_id: intakeId,
    fornitore: draft.supplier,
    documento: draft.document_ref,
    righe_caricate: applied.length,
    righe_saltate: draft.lines.filter((l) => l.azione !== 'ignora').length - applied.length,
    pezzi: applied.reduce((s, a) => s + a.caricati, 0),
    articoli_creati: applied.filter((a) => a.nuovo_articolo).length,
    dettaglio: applied,
  });
});

intakeRouter.get('/storico', (req, res) => {
  const intakes = db
    .prepare(`SELECT * FROM intakes ORDER BY created_at DESC, id DESC LIMIT 100`)
    .all();
  for (const intake of intakes) {
    intake.righe = db.prepare(`SELECT * FROM intake_lines WHERE intake_id = ? ORDER BY id`).all(intake.id);
    intake.pezzi = intake.righe.reduce((s, r) => s + r.qty_loaded, 0);
  }
  res.json({ totale: intakes.length, carichi: intakes });
});

intakeRouter.get('/storico/:id', (req, res) => {
  const intake = db.prepare(`SELECT * FROM intakes WHERE id = ?`).get(Number(req.params.id));
  if (!intake) throw new InventoryError('Carico non trovato', 404);
  intake.righe = db.prepare(`SELECT * FROM intake_lines WHERE intake_id = ? ORDER BY id`).all(intake.id);
  res.json(intake);
});
