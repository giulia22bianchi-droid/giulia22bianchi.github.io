// Livello dati di NovaCassa: tutto persistito in localStorage, nessun server.
const STORAGE_KEY = 'novacassa_data_v1';

function defaultData() {
  return {
    settings: {
      businessName: 'La Mia Attività',
      currency: '€',
      taxRate: 22,
    },
    categories: [
      { id: 1, name: 'Generale' },
      { id: 2, name: 'Bevande' },
      { id: 3, name: 'Alimentari' },
    ],
    products: [
      { id: 1, name: 'Caffè', categoryId: 2, price: 1.2, cost: 0.3, stock: 50, minStock: 10, barcode: '8001001' },
      { id: 2, name: 'Acqua 0.5L', categoryId: 2, price: 1.0, cost: 0.2, stock: 40, minStock: 10, barcode: '8001002' },
      { id: 3, name: 'Panino', categoryId: 3, price: 3.5, cost: 1.5, stock: 15, minStock: 5, barcode: '8001003' },
    ],
    customers: [],
    sales: [],
    movements: [],
    seq: { category: 3, product: 3, customer: 0, sale: 0, movement: 0 },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const data = JSON.parse(raw);
    return { ...defaultData(), ...data };
  } catch (err) {
    console.error('NovaCassa: dati corrotti, ripristino i valori di base', err);
    return defaultData();
  }
}

function save(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function nextId(data, kind) {
  data.seq[kind] = (data.seq[kind] || 0) + 1;
  return data.seq[kind];
}

export const Store = { load, save, nextId, defaultData, STORAGE_KEY };
