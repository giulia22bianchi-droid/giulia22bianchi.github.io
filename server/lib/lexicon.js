// Sinonimi multilingua: il cliente può scrivere "display", "schermo", "screen",
// "écran", "pantalla", "شاشة" o "ecran" e deve arrivare alla stessa categoria.

export const CATEGORY_SYNONYMS = {
  display: ['display', 'displays', 'schermo', 'schermi', 'lcd', 'screen', 'ecran', 'écran', 'pantalla', 'ekran', 'شاشة', 'afisaj', 'afișaj', 'touch', 'vetro', 'glass', 'tela'],
  batterie: ['batteria', 'batterie', 'battery', 'batteries', 'pila', 'bateria', 'batería', 'baterie', 'akku', 'بطارية'],
  'back-cover': ['back cover', 'backcover', 'scocca', 'cover', 'posteriore', 'tapa', 'tapa trasera', 'vitre arriere', 'vitre arrière', 'capac', 'coperchio', 'retro'],
  fotocamere: ['fotocamera', 'fotocamere', 'camera', 'cameras', 'camara', 'cámara', 'caméra', 'appareil photo', 'كاميرا', 'obiettivo'],
  'connettori-di-ricarica': ['connettore', 'connettori', 'ricarica', 'dock', 'charging port', 'charging', 'porta ricarica', 'carga', 'conector', 'chargement', 'incarcare', 'încărcare', 'شاحن', 'usb', 'typec', 'type-c', 'lightning'],
  'flex-flat': ['flex', 'flat', 'flexible', 'nappe', 'cavo flat', 'flex cable'],
  'frame-telai': ['frame', 'telaio', 'telai', 'chassis', 'marco', 'cadre', 'rama', 'scocca centrale'],
  speaker: ['speaker', 'altoparlante', 'buzzer', 'altavoz', 'haut-parleur', 'difuzor', 'suoneria', 'سماعة'],
  auricolari: ['auricolare', 'auricolari', 'earpiece', 'capsula', 'ecouteur', 'écouteur', 'capsula auricolare'],
  microfoni: ['microfono', 'microfoni', 'mic', 'microfon', 'micro', 'microphone', 'micrófono', 'ميكروفون'],
  vibrazione: ['vibrazione', 'vibration', 'vibra', 'motorino', 'motor vibration', 'vibrator'],
  tasti: ['tasto', 'tasti', 'button', 'buttons', 'boton', 'botón', 'bouton', 'buton', 'pulsante', 'power', 'volume'],
  'vetro-fotocamera': ['vetro fotocamera', 'vetrino', 'vetrino fotocamera', 'lente', 'lens', 'camera lens', 'cristal camara', 'lentila'],
  sensori: ['sensore', 'sensori', 'sensor', 'prossimita', 'prossimità', 'proximity', 'senzor'],
  'sim-tray': ['sim', 'sim tray', 'simtray', 'carrello sim', 'porta sim', 'bandeja', 'tiroir sim', 'suport sim'],
  antenne: ['antenna', 'antenne', 'antena', 'antenne gsm', 'hoian'],
  'impronta-digitale': ['impronta', 'impronta digitale', 'fingerprint', 'huella', 'empreinte', 'touch id', 'amprenta', 'amprentă', 'بصمة'],
};

export const QUALITY_SYNONYMS = {
  originale: ['originale', 'original', 'orig', 'genuine', 'originala', 'originală', 'أصلي'],
  'service-pack': ['service pack', 'servicepack', 'sp', 'gh82', 'service-pack'],
  oled: ['oled', 'amoled', 'super amoled'],
  'soft-oled': ['soft oled', 'softoled', 'soft'],
  'hard-oled': ['hard oled', 'hardoled', 'hard'],
  incell: ['incell', 'in-cell', 'in cell'],
  tft: ['tft'],
  compatibile: ['compatibile', 'compatible', 'comp', 'aftermarket', 'copia', 'compatibil'],
  rigenerato: ['rigenerato', 'refurbished', 'refurb', 'rigenerata', 'reconditionne', 'reconditionné'],
};

export const COLOR_SYNONYMS = {
  Nero: ['nero', 'nera', 'black', 'noir', 'negro', 'negru', 'أسود', 'preto'],
  Bianco: ['bianco', 'bianca', 'white', 'blanc', 'blanco', 'alb', 'أبيض'],
  Blu: ['blu', 'blue', 'bleu', 'azul', 'albastru', 'أزرق'],
  Azzurro: ['azzurro', 'light blue', 'celeste chiaro'],
  Verde: ['verde', 'green', 'vert', 'أخضر'],
  Rosso: ['rosso', 'rossa', 'red', 'rouge', 'rojo', 'rosu', 'roșu', 'أحمر'],
  Viola: ['viola', 'purple', 'violet', 'morado', 'mov', 'lilla', 'lavender'],
  Rosa: ['rosa', 'pink', 'rose', 'roz'],
  Oro: ['oro', 'gold', 'dorado', 'doré', 'auriu', 'ذهبي'],
  Argento: ['argento', 'silver', 'argent', 'plata', 'argintiu'],
  Grigio: ['grigio', 'grigia', 'grey', 'gray', 'gris', 'graphite', 'grafite', 'gri'],
  Giallo: ['giallo', 'yellow', 'jaune', 'amarillo', 'galben'],
  Arancione: ['arancione', 'orange', 'naranja', 'portocaliu'],
  Celeste: ['celeste', 'sky blue', 'light blue'],
};

// Parole che non aiutano a identificare il prodotto
export const STOPWORDS = new Set([
  'avete', 'hai', 'ho', 'per', 'un', 'una', 'il', 'lo', 'la', 'di', 'da', 'del', 'della',
  'quanto', 'costa', 'prezzo', 'disponibile', 'disponibilita', 'disponibilità', 'serve',
  'vorrei', 'cerco', 'mi', 'ciao', 'buongiorno', 'salve', 'grazie', 'please', 'hello',
  'do', 'you', 'have', 'the', 'a', 'an', 'for', 'is', 'there', 'price', 'how', 'much',
  'available', 'need', 'want', 'hola', 'tienen', 'precio', 'bonjour', 'avez', 'vous',
  'prix', 'combien', 'buna', 'bună', 'pret', 'preț', 'aveti', 'aveți', 'مرحبا', 'سعر',
  'e', 'and', 'con', 'with', 'pz', 'pezzi', 'pcs',
]);

function buildIndex(map) {
  const index = new Map();
  for (const [key, words] of Object.entries(map)) {
    for (const word of words) {
      index.set(normalizeText(word), key);
    }
  }
  return index;
}

export const CATEGORY_INDEX = buildIndex(CATEGORY_SYNONYMS);
export const QUALITY_INDEX = buildIndex(QUALITY_SYNONYMS);
export const COLOR_INDEX = buildIndex(COLOR_SYNONYMS);

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
