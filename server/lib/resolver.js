import { db, normalizeCode } from '../db.js';
import {
  CATEGORY_INDEX,
  QUALITY_INDEX,
  COLOR_INDEX,
  STOPWORDS,
  normalizeText,
} from './lexicon.js';

// Il catalogo cambia di rado ma viene letto a ogni ricerca: lo teniamo in memoria
// e lo invalidiamo quando qualcuno aggiunge modelli o codici.
let cache = null;

export function invalidateCatalogCache() {
  cache = null;
}

function catalog() {
  if (cache) return cache;

  const models = db
    .prepare(
      `SELECT m.id, m.name, m.year, b.id AS brand_id, b.name AS brand_name
       FROM models m JOIN brands b ON b.id = m.brand_id`,
    )
    .all();
  const codes = db.prepare(`SELECT model_id, code, normalized FROM model_codes`).all();

  const codesByModel = new Map();
  for (const row of codes) {
    if (!codesByModel.has(row.model_id)) codesByModel.set(row.model_id, []);
    codesByModel.get(row.model_id).push(row);
  }

  const entries = models.map((m) => ({
    id: m.id,
    name: m.name,
    year: m.year,
    brandId: m.brand_id,
    brandName: m.brand_name,
    codes: codesByModel.get(m.id) ?? [],
    nameTokens: normalizeText(m.name).split(' ').filter(Boolean),
    brandTokens: normalizeText(m.brand_name).split(' ').filter(Boolean),
  }));

  const brands = db.prepare(`SELECT id, name, slug FROM brands`).all();
  const brandAliases = new Map();
  for (const brand of brands) {
    brandAliases.set(normalizeText(brand.name), brand.id);
  }
  // Nel parlato comune la sottomarca vale come marca
  const extraAliases = {
    iphone: 'Apple',
    moto: 'Motorola',
    google: 'Google Pixel',
    pixel: 'Google Pixel',
    galaxy: 'Samsung',
  };
  for (const [alias, brandName] of Object.entries(extraAliases)) {
    const brand = brands.find((b) => b.name === brandName);
    if (brand) brandAliases.set(alias, brand.id);
  }

  const knownNameTokens = new Set(entries.flatMap((e) => e.nameTokens));

  // I fornitori scrivono "Xiaomi Redmi Note 11": le sottomarche vanno tenute insieme
  const FAMILIES = [['xiaomi', 'redmi', 'poco'], ['google-pixel']];
  const families = new Map();
  for (const group of FAMILIES) {
    const ids = group.map((slug) => brands.find((b) => b.slug === slug)?.id).filter(Boolean);
    for (const id of ids) families.set(id, new Set(ids));
  }

  cache = { entries, brands, brandAliases, knownNameTokens, families };
  return cache;
}

function extractKeyword(text, index) {
  // Le espressioni più lunghe vincono: "vetro fotocamera" prima di "vetro"
  const phrases = [...index.keys()].sort((a, b) => b.length - a.length);
  let rest = text;
  let key = null;
  const matched = [];
  for (const phrase of phrases) {
    const pattern = new RegExp(`(?:^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'u');
    if (pattern.test(rest)) {
      if (!key) key = index.get(phrase);
      matched.push(phrase);
      rest = rest.replace(pattern, ' ');
    }
  }
  return { key, rest: rest.replace(/\s+/g, ' ').trim(), matched };
}

function extractCodes(rawText) {
  const candidates = String(rawText ?? '').match(/[A-Za-z0-9][A-Za-z0-9\-/_.]*\d[A-Za-z0-9\-/_.]*/g) ?? [];
  const seen = new Set();
  const out = [];
  for (const candidate of candidates) {
    const normalized = normalizeCode(candidate);
    if (normalized.length < 3 || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({ raw: candidate, normalized });
  }
  return out;
}

function scoreModels({ codeCandidates, tokens, allTokens, brandId }) {
  const { entries, knownNameTokens, families } = catalog();
  const related = brandId ? (families.get(brandId) ?? new Set([brandId])) : null;
  const scored = [];
  // Le parole estranee al catalogo (sigle interne, importi) non devono impedire
  // il riconoscimento di un nome completo come "iPhone 13".
  const meaningful = tokens.filter((t) => knownNameTokens.has(t));

  for (const entry of entries) {
    let score = 0;
    const reasons = [];
    let codeMatched = false;
    let wordMatched = false;

    for (const candidate of codeCandidates) {
      for (const code of entry.codes) {
        if (code.normalized === candidate.normalized) {
          score += 100;
          codeMatched = true;
          reasons.push(`codice esatto ${code.code}`);
        } else if (candidate.normalized.length >= 4 && code.normalized.includes(candidate.normalized)) {
          score += 70;
          codeMatched = true;
          reasons.push(`codice ${code.code} contiene ${candidate.raw}`);
        } else if (code.normalized.length >= 4 && candidate.normalized.startsWith(code.normalized)) {
          score += 70;
          codeMatched = true;
          reasons.push(`codice ${code.code} riconosciuto in ${candidate.raw}`);
        }
      }
    }

    for (const token of tokens) {
      const hasDigit = /\d/.test(token);
      if (entry.nameTokens.includes(token)) {
        score += hasDigit ? 40 : 12;
        if (/[a-z]/.test(token)) wordMatched = true;
        reasons.push(`nome contiene "${token}"`);
      } else if (hasDigit && token.length >= 3 && entry.nameTokens.some((t) => t.includes(token))) {
        score += 20;
        if (/[a-z]/.test(token)) wordMatched = true;
        reasons.push(`nome simile a "${token}"`);
      }
    }

    // Un numero isolato ("10" di una colonna prezzi) non identifica un modello:
    // serve almeno un codice, una parola o la marca.
    if (score > 0 && !codeMatched && !wordMatched && !brandId) continue;

    if (score > 0 && brandId && related.has(entry.brandId)) {
      score += entry.brandId === brandId ? 15 : 8;
      reasons.push('marca corrispondente');
    }

    // "iPhone 13" deve battere "iPhone 13 Pro": il nome combacia per intero e la
    // richiesta non contiene parole che il modello non copre.
    if (score > 0) {
      const nameFullyAsked = entry.nameTokens.every((t) => allTokens.includes(t));
      const nothingExtraAsked = meaningful.every((t) => entry.nameTokens.includes(t));
      if (nameFullyAsked && nothingExtraAsked) {
        score += 30;
        reasons.push('nome completo corrispondente');
      }
    }

    if (score > 0) scored.push({ entry, score, reasons, codeMatched });
  }

  // Se la marca è esplicita gli altri candidati sono rumore, ma un codice esatto
  // vale più della marca scritta nella riga.
  if (brandId) {
    const sameBrand = scored.filter((s) => related.has(s.entry.brandId) || s.codeMatched);
    if (sameBrand.length) return sameBrand.sort((a, b) => b.score - a.score);
  }

  return scored.sort((a, b) => b.score - a.score);
}

function lookupRow(table, slug) {
  if (!slug) return null;
  return db.prepare(`SELECT id, name, slug FROM ${table} WHERE slug = ?`).get(slug) ?? null;
}

/**
 * Interpreta una richiesta libera ("A526 display nero", "avete display Samsung A16?").
 * Non tira a indovinare: se i candidati sono più di uno restituisce `ambiguous`
 * con l'elenco, così l'interfaccia (o il bot) può chiedere conferma.
 */
export function resolveQuery(rawText) {
  const original = String(rawText ?? '').trim();
  let text = normalizeText(original);

  const category = extractKeyword(text, CATEGORY_INDEX);
  text = category.rest;
  const quality = extractKeyword(text, QUALITY_INDEX);
  text = quality.rest;
  const color = extractKeyword(text, COLOR_INDEX);
  text = color.rest;

  const { brandAliases } = catalog();
  let brandId = null;
  const brandMatched = [];
  for (const [alias, id] of brandAliases) {
    const pattern = new RegExp(`(?:^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'u');
    if (pattern.test(text)) {
      brandId ??= id;
      brandMatched.push(alias);
      text = text.replace(pattern, ' ');
    }
  }
  text = text.replace(/\s+/g, ' ').trim();

  const tokens = text.split(' ').filter((t) => t && !STOPWORDS.has(t));
  const codeCandidates = extractCodes(original);
  const allTokens = [...tokens, ...brandMatched];
  const scored = scoreModels({ codeCandidates, tokens, allTokens, brandId });

  const best = scored[0];
  let status;
  let candidates = [];

  if (!best || best.score < 30) {
    status = 'not_found';
  } else {
    // Tutto ciò che sta entro il 10% del punteggio migliore è un'alternativa credibile
    candidates = scored.filter((s) => s.score >= best.score * 0.9).slice(0, 12);
    status = candidates.length === 1 ? 'ok' : 'ambiguous';
  }

  const brand = brandId ? db.prepare(`SELECT id, name, slug FROM brands WHERE id = ?`).get(brandId) : null;

  return {
    query: original,
    status,
    brand,
    category: lookupRow('categories', category.key),
    quality: lookupRow('qualities', quality.key),
    color: color.key,
    codes: codeCandidates.map((c) => c.raw),
    tokens,
    matchedWords: {
      category: category.matched,
      quality: quality.matched,
      color: color.matched,
      brand: brandMatched,
    },
    models: candidates.map(({ entry, score, reasons }) => ({
      id: entry.id,
      name: entry.name,
      year: entry.year,
      brand: entry.brandName,
      brand_id: entry.brandId,
      codes: entry.codes.map((c) => c.code),
      score,
      reasons: [...new Set(reasons)],
    })),
  };
}

export function logUnresolved({ query, reason, candidates = [], channel = 'web' }) {
  const info = db
    .prepare(
      `INSERT INTO unresolved_queries (query, reason, candidates, channel) VALUES (?, ?, ?, ?)`,
    )
    .run(query, reason, JSON.stringify(candidates), channel);
  return info.lastInsertRowid;
}
