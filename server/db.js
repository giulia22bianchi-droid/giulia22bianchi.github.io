import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB_PATH = process.env.DB_PATH || resolve(process.cwd(), 'data/magazzino.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  year INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (brand_id, name)
);

-- Un modello può avere molti codici (A526, SM-A526B, SM-A526B/DS ...)
CREATE TABLE IF NOT EXISTS model_codes (
  id INTEGER PRIMARY KEY,
  model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  normalized TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'seed',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (model_id, normalized)
);
CREATE INDEX IF NOT EXISTS idx_model_codes_norm ON model_codes(normalized);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS qualities (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS colors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

-- Un articolo è una variante concreta: modello + categoria + qualità + colore
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  quality_id INTEGER REFERENCES qualities(id),
  color TEXT NOT NULL DEFAULT '',
  sku TEXT,
  price REAL NOT NULL DEFAULT 0,
  cost REAL,
  quantity INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (model_id, category_id, quality_id, color)
);
CREATE INDEX IF NOT EXISTS idx_items_model ON items(model_id);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
CREATE INDEX IF NOT EXISTS idx_items_sku ON items(sku);

-- Ogni variazione di quantità lascia una traccia
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  delta INTEGER NOT NULL,
  qty_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_type TEXT,
  ref_id INTEGER,
  actor TEXT
);
CREATE INDEX IF NOT EXISTS idx_movements_item ON stock_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_movements_date ON stock_movements(created_at);

-- Un avviso resta aperto finché la quantità non risale sopra la soglia
CREATE TABLE IF NOT EXISTS stock_alerts (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  quantity INTEGER NOT NULL,
  min_stock INTEGER NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_open ON stock_alerts(item_id, resolved_at);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  channel TEXT NOT NULL DEFAULT 'banco',
  customer_phone TEXT,
  customer_name TEXT,
  total REAL NOT NULL DEFAULT 0,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(created_at);

-- Le righe conservano una copia dei dati: se l'articolo cambia, lo storico resta corretto
CREATE TABLE IF NOT EXISTS sale_lines (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL,
  brand_name TEXT,
  model_name TEXT,
  model_code TEXT,
  category_name TEXT,
  quality_name TEXT,
  color TEXT,
  sku TEXT
);
CREATE INDEX IF NOT EXISTS idx_sale_lines_sale ON sale_lines(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_lines_item ON sale_lines(item_id);

-- Bozza di carico: creata dal PDF, non tocca il magazzino finché non viene confermata
CREATE TABLE IF NOT EXISTS intake_drafts (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  filename TEXT,
  supplier TEXT,
  document_ref TEXT,
  status TEXT NOT NULL DEFAULT 'bozza',
  lines TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intakes (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  supplier TEXT,
  document_ref TEXT,
  filename TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS intake_lines (
  id INTEGER PRIMARY KEY,
  intake_id INTEGER NOT NULL REFERENCES intakes(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  qty_before INTEGER NOT NULL,
  qty_loaded INTEGER NOT NULL,
  qty_after INTEGER NOT NULL,
  unit_cost REAL,
  created_item INTEGER NOT NULL DEFAULT 0,
  raw_line TEXT,
  brand_name TEXT,
  model_name TEXT,
  model_code TEXT,
  category_name TEXT,
  quality_name TEXT,
  color TEXT
);
CREATE INDEX IF NOT EXISTS idx_intake_lines_intake ON intake_lines(intake_id);

-- Prodotti visti da fornitori/cataloghi esterni ma non presenti a magazzino
CREATE TABLE IF NOT EXISTS missing_products (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  brand_name TEXT,
  model_name TEXT,
  model_code TEXT,
  category_name TEXT,
  quality_name TEXT,
  color TEXT,
  source TEXT,
  url TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'da_valutare'
);

-- Richieste che il sistema non ha saputo risolvere: nessuna invenzione, si chiede conferma
CREATE TABLE IF NOT EXISTS unresolved_queries (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  query TEXT NOT NULL,
  reason TEXT NOT NULL,
  candidates TEXT,
  channel TEXT,
  resolved_model_id INTEGER REFERENCES models(id) ON DELETE SET NULL,
  resolved_at TEXT
);
`);

export function nowIso() {
  return new Date().toISOString();
}

export function slugify(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// I codici modello vanno confrontati ignorando spazi, trattini e slash:
// "SM-A526B/DS", "sm a526b ds" e "SMA526BDS" sono lo stesso codice.
export function normalizeCode(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}
