import Database from 'better-sqlite3';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';

export const DB_PATH = process.env.POS_DB_PATH || resolve(process.cwd(), 'data/pos.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

// Un ripristino richiesto dall'interfaccia viene applicato qui, prima di aprire il database
if (existsSync(`${DB_PATH}.restore`)) {
  renameSync(`${DB_PATH}.restore`, DB_PATH);
  for (const ext of ['-wal', '-shm']) if (existsSync(DB_PATH + ext)) renameSync(DB_PATH + ext, `${DB_PATH}${ext}.old`);
}

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  permissions TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS taxes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  rate REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS product_groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#3b82f6'
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  barcode TEXT,
  group_id INTEGER REFERENCES product_groups(id) ON DELETE SET NULL,
  tax_id INTEGER REFERENCES taxes(id),
  supplier_id INTEGER,
  price REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'pz',
  stock REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  track_stock INTEGER NOT NULL DEFAULT 1,
  allow_price_change INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_group ON products(group_id);

-- Barcode aggiuntivi oltre a quello principale
CREATE TABLE IF NOT EXISTS product_barcodes (
  barcode TEXT PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('customer', 'supplier')),
  name TEXT NOT NULL,
  code TEXT,
  tax_number TEXT,
  address TEXT,
  city TEXT,
  phone TEXT,
  email TEXT,
  discount_pct REAL NOT NULL DEFAULT 0,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_types (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_cash INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  opening_cash REAL NOT NULL DEFAULT 0,
  expected_cash REAL,
  counted_cash REAL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id INTEGER PRIMARY KEY,
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('in', 'out')),
  amount REAL NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- type: sale | invoice | refund | purchase | adjustment
-- status: held (in sospeso) | completed | void
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  number TEXT,
  user_id INTEGER REFERENCES users(id),
  partner_id INTEGER REFERENCES partners(id),
  shift_id INTEGER REFERENCES shifts(id),
  ref_id INTEGER REFERENCES documents(id),
  discount_type TEXT NOT NULL DEFAULT 'pct',
  discount_value REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0,
  discount_total REAL NOT NULL DEFAULT 0,
  tax_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,
  change_given REAL NOT NULL DEFAULT 0,
  note TEXT,
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type, status);
CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(completed_at);
CREATE INDEX IF NOT EXISTS idx_documents_partner ON documents(partner_id);

CREATE TABLE IF NOT EXISTS document_items (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  qty REAL NOT NULL,
  price REAL NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  discount_pct REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  net REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_document ON document_items(document_id);
CREATE INDEX IF NOT EXISTS idx_items_product ON document_items(product_id);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  payment_type_id INTEGER NOT NULL REFERENCES payment_types(id),
  shift_id INTEGER REFERENCES shifts(id),
  amount REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_document ON payments(document_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id),
  qty REAL NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id);

CREATE TABLE IF NOT EXISTS counters (type TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);
`);

export const PERMISSIONS = {
  'pos.sell': 'Vendere in cassa',
  'pos.discount': 'Applicare sconti',
  'pos.price_change': 'Modificare i prezzi in cassa',
  'pos.refund': 'Emettere resi',
  'pos.void': 'Annullare documenti',
  'products.view': 'Vedere i prodotti',
  'products.edit': 'Modificare prodotti e gruppi',
  'partners.edit': 'Modificare clienti e fornitori',
  'purchases.manage': 'Registrare acquisti',
  'stock.adjust': 'Rettificare le giacenze',
  'register.manage': 'Movimenti di cassa e chiusura turni',
  'reports.view': 'Vedere i report',
  'users.manage': 'Gestire utenti e ruoli',
  'settings.manage': 'Gestire impostazioni e backup',
};
const ALL = Object.keys(PERMISSIONS);

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(String(password), salt, 32).toString('hex') };
}

const DEFAULT_SETTINGS = {
  company_name: 'Il mio negozio',
  company_address: '',
  company_tax_number: '',
  company_phone: '',
  currency: '€',
  receipt_header: '',
  receipt_footer: 'Grazie e arrivederci!',
  prices_include_tax: '1',
  require_shift: '1',
  allow_negative_stock: '0',
  sale_prefix: 'S',
  invoice_prefix: 'F',
  refund_prefix: 'R',
  purchase_prefix: 'A',
  adjustment_prefix: 'M',
};

function seedIfEmpty() {
  const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

  if (db.prepare(`SELECT COUNT(*) AS n FROM roles`).get().n === 0) {
    const role = db.prepare(`INSERT INTO roles (name, permissions) VALUES (?, ?)`);
    role.run('Amministratore', JSON.stringify(ALL));
    role.run('Responsabile', JSON.stringify(ALL.filter((p) => p !== 'users.manage' && p !== 'settings.manage')));
    role.run('Cassiere', JSON.stringify(['pos.sell', 'pos.discount', 'products.view', 'register.manage']));
  }
  if (db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n === 0) {
    const { salt, hash } = hashPassword('admin');
    const adminRole = db.prepare(`SELECT id FROM roles WHERE name = 'Amministratore'`).get().id;
    db.prepare(`INSERT INTO users (username, name, role_id, salt, hash) VALUES ('admin', 'Amministratore', ?, ?, ?)`).run(adminRole, salt, hash);
  }
  if (db.prepare(`SELECT COUNT(*) AS n FROM taxes`).get().n === 0) {
    const tax = db.prepare(`INSERT INTO taxes (name, rate) VALUES (?, ?)`);
    tax.run('IVA 22%', 22);
    tax.run('IVA 10%', 10);
    tax.run('IVA 4%', 4);
    tax.run('Esente', 0);
  }
  if (db.prepare(`SELECT COUNT(*) AS n FROM payment_types`).get().n === 0) {
    const pt = db.prepare(`INSERT INTO payment_types (name, is_cash, position) VALUES (?, ?, ?)`);
    pt.run('Contanti', 1, 1);
    pt.run('Carta', 0, 2);
    pt.run('Bonifico', 0, 3);
    pt.run('Buono', 0, 4);
  }
}
seedIfEmpty();

export function getSettings() {
  return Object.fromEntries(db.prepare(`SELECT key, value FROM settings`).all().map((r) => [r.key, r.value]));
}

export function getSetting(key) {
  return db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key)?.value ?? DEFAULT_SETTINGS[key] ?? '';
}

export function nextNumber(type) {
  db.prepare(`INSERT INTO counters (type, value) VALUES (?, 1) ON CONFLICT(type) DO UPDATE SET value = value + 1`).run(type);
  const value = db.prepare(`SELECT value FROM counters WHERE type = ?`).get(type).value;
  const prefix = getSetting(`${type}_prefix`);
  return `${prefix}${String(value).padStart(6, '0')}`;
}
