import { db, slugify, normalizeCode } from '../db.js';
import { CATEGORIES, QUALITIES, COLORS, MODELS } from './catalog.js';

const insertCategory = db.prepare(
  `INSERT INTO categories (name, slug, icon, sort_order) VALUES (?, ?, ?, ?)
   ON CONFLICT(slug) DO UPDATE SET icon = excluded.icon, sort_order = excluded.sort_order`,
);
const insertQuality = db.prepare(
  `INSERT INTO qualities (name, slug, sort_order) VALUES (?, ?, ?) ON CONFLICT(slug) DO NOTHING`,
);
const insertColor = db.prepare(
  `INSERT INTO colors (name, slug) VALUES (?, ?) ON CONFLICT(slug) DO NOTHING`,
);
const insertBrand = db.prepare(
  `INSERT INTO brands (name, slug) VALUES (?, ?) ON CONFLICT(slug) DO NOTHING`,
);
const selectBrand = db.prepare(`SELECT id FROM brands WHERE slug = ?`);
const insertModel = db.prepare(
  `INSERT INTO models (brand_id, name, year) VALUES (?, ?, ?) ON CONFLICT(brand_id, name) DO NOTHING`,
);
const selectModel = db.prepare(`SELECT id FROM models WHERE brand_id = ? AND name = ?`);
const insertCode = db.prepare(
  `INSERT INTO model_codes (model_id, code, normalized, source) VALUES (?, ?, ?, 'seed')
   ON CONFLICT(model_id, normalized) DO NOTHING`,
);

export function seed() {
  const run = db.transaction(() => {
    CATEGORIES.forEach((cat, i) => insertCategory.run(cat.name, slugify(cat.name), cat.icon, i * 10));
    QUALITIES.forEach((name, i) => insertQuality.run(name, slugify(name), i * 10));
    COLORS.forEach((name) => insertColor.run(name, slugify(name)));

    let models = 0;
    let codes = 0;
    for (const [brandName, list] of Object.entries(MODELS)) {
      insertBrand.run(brandName, slugify(brandName));
      const brandId = selectBrand.get(slugify(brandName)).id;
      for (const [modelName, year, ...modelCodes] of list) {
        insertModel.run(brandId, modelName, year);
        const modelId = selectModel.get(brandId, modelName).id;
        models += 1;
        for (const code of modelCodes) {
          insertCode.run(modelId, code, normalizeCode(code));
          codes += 1;
        }
      }
    }
    return { models, codes };
  });

  const stats = run();
  return {
    categorie: CATEGORIES.length,
    qualita: QUALITIES.length,
    colori: COLORS.length,
    marche: Object.keys(MODELS).length,
    ...stats,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stats = seed();
  console.log('Catalogo caricato:', stats);
}
