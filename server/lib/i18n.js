import { normalizeText } from './lexicon.js';

export const LINGUE = ['it', 'en', 'fr', 'es', 'ar', 'ro', 'pt', 'de'];

// Parole frequenti che tradiscono la lingua del messaggio. Non servono per capire
// la richiesta (quello lo fa il lexicon), solo per decidere come rispondere.
const SPIE = {
  it: ['ciao', 'buongiorno', 'buonasera', 'salve', 'avete', 'vorrei', 'quanto', 'costa', 'prezzo', 'disponibile', 'grazie', 'serve', 'cerco', 'mi', 'per', 'anche', 'quanti', 'nero', 'bianco', 'schermo', 'batteria'],
  en: ['hello', 'hi', 'good', 'morning', 'do', 'you', 'have', 'how', 'much', 'price', 'available', 'need', 'want', 'thanks', 'thank', 'please', 'screen', 'battery', 'black', 'white', 'is', 'there'],
  fr: ['bonjour', 'salut', 'bonsoir', 'avez', 'vous', 'combien', 'prix', 'disponible', 'merci', 'besoin', 'voudrais', 'ecran', 'batterie', 'noir', 'blanc', 'pour', 'est', 'ce'],
  es: ['hola', 'buenos', 'buenas', 'tienen', 'tiene', 'cuanto', 'cuesta', 'precio', 'disponible', 'gracias', 'necesito', 'quiero', 'pantalla', 'bateria', 'negro', 'blanco', 'para'],
  ro: ['buna', 'salut', 'aveti', 'cat', 'costa', 'pret', 'disponibil', 'multumesc', 'vreau', 'am', 'nevoie', 'ecran', 'baterie', 'negru', 'alb', 'pentru', 'da'],
  pt: ['ola', 'bom', 'dia', 'boa', 'tarde', 'tem', 'quanto', 'custa', 'preco', 'disponivel', 'obrigado', 'obrigada', 'preciso', 'quero', 'ecra', 'tela', 'bateria', 'preto', 'branco', 'para'],
  de: ['hallo', 'guten', 'tag', 'haben', 'sie', 'wie', 'viel', 'kostet', 'preis', 'verfugbar', 'danke', 'brauche', 'mochte', 'display', 'akku', 'schwarz', 'weiss', 'fur'],
};

const INDICE_SPIE = (() => {
  const mappa = new Map();
  for (const [lingua, parole] of Object.entries(SPIE)) {
    for (const parola of parole) {
      const chiave = normalizeText(parola);
      if (!mappa.has(chiave)) mappa.set(chiave, new Set());
      mappa.get(chiave).add(lingua);
    }
  }
  return mappa;
})();

/**
 * Riconosce la lingua del messaggio. Se il testo non contiene indizi
 * (per esempio è solo "A526") mantiene la lingua già in uso.
 */
export function rilevaLingua(testo, precedente = 'it') {
  const originale = String(testo ?? '');
  if (/[؀-ۿ]/.test(originale)) return 'ar';

  const parole = normalizeText(originale).split(' ').filter(Boolean);
  const punteggi = Object.fromEntries(LINGUE.map((l) => [l, 0]));
  let indizi = 0;

  for (const parola of parole) {
    const lingue = INDICE_SPIE.get(parola);
    if (!lingue) continue;
    indizi += 1;
    // Una parola comune a più lingue vale meno di una parola caratteristica
    const peso = 1 / lingue.size;
    for (const lingua of lingue) punteggi[lingua] += peso;
  }

  if (indizi === 0) return precedente;

  const ordinate = Object.entries(punteggi).sort((a, b) => b[1] - a[1]);
  const [migliore, punteggio] = ordinate[0];
  if (punteggio === 0) return precedente;
  // In caso di parità resta la lingua già in uso, se è fra le prime
  if (ordinate[1] && ordinate[1][1] === punteggio && ordinate.some(([l, p]) => l === precedente && p === punteggio)) {
    return precedente;
  }
  return migliore;
}

const SI = ['si', 'sì', 'ok', 'va bene', 'confermo', 'certo', 'yes', 'yeah', 'sure', 'oui', 'd accord', 'vale', 'claro', 'da', 'sim', 'ja', 'نعم', 'okay', 'perfetto', 'confirm'];
const NO = ['no', 'non', 'annulla', 'lascia', 'niente', 'cancel', 'nope', 'nu', 'nein', 'nao', 'não', 'لا', 'stop'];

export function interpretaRisposta(testo) {
  const t = normalizeText(testo);
  if (!t) return null;
  if (SI.some((s) => t === normalizeText(s) || t.startsWith(`${normalizeText(s)} `))) return 'si';
  if (NO.some((s) => t === normalizeText(s) || t.startsWith(`${normalizeText(s)} `))) return 'no';
  return null;
}

function elenco(voci) {
  return voci.map((voce, i) => `${i + 1}. ${voce}`).join('\n');
}

// Le opzioni proposte al cliente vanno nella sua lingua, non in quella del catalogo.
const COLORI = {
  Nero: { en: 'Black', fr: 'Noir', es: 'Negro', ar: 'أسود', ro: 'Negru', pt: 'Preto', de: 'Schwarz' },
  Bianco: { en: 'White', fr: 'Blanc', es: 'Blanco', ar: 'أبيض', ro: 'Alb', pt: 'Branco', de: 'Weiß' },
  Blu: { en: 'Blue', fr: 'Bleu', es: 'Azul', ar: 'أزرق', ro: 'Albastru', pt: 'Azul', de: 'Blau' },
  Azzurro: { en: 'Light blue', fr: 'Bleu clair', es: 'Celeste', ar: 'أزرق فاتح', ro: 'Bleu', pt: 'Azul claro', de: 'Hellblau' },
  Celeste: { en: 'Sky blue', fr: 'Bleu ciel', es: 'Celeste', ar: 'سماوي', ro: 'Bleu', pt: 'Azul céu', de: 'Himmelblau' },
  Verde: { en: 'Green', fr: 'Vert', es: 'Verde', ar: 'أخضر', ro: 'Verde', pt: 'Verde', de: 'Grün' },
  Rosso: { en: 'Red', fr: 'Rouge', es: 'Rojo', ar: 'أحمر', ro: 'Roșu', pt: 'Vermelho', de: 'Rot' },
  Viola: { en: 'Purple', fr: 'Violet', es: 'Morado', ar: 'بنفسجي', ro: 'Mov', pt: 'Roxo', de: 'Lila' },
  Rosa: { en: 'Pink', fr: 'Rose', es: 'Rosa', ar: 'وردي', ro: 'Roz', pt: 'Rosa', de: 'Rosa' },
  Oro: { en: 'Gold', fr: 'Or', es: 'Dorado', ar: 'ذهبي', ro: 'Auriu', pt: 'Dourado', de: 'Gold' },
  Argento: { en: 'Silver', fr: 'Argent', es: 'Plata', ar: 'فضي', ro: 'Argintiu', pt: 'Prateado', de: 'Silber' },
  Grigio: { en: 'Grey', fr: 'Gris', es: 'Gris', ar: 'رمادي', ro: 'Gri', pt: 'Cinzento', de: 'Grau' },
  Giallo: { en: 'Yellow', fr: 'Jaune', es: 'Amarillo', ar: 'أصفر', ro: 'Galben', pt: 'Amarelo', de: 'Gelb' },
  Arancione: { en: 'Orange', fr: 'Orange', es: 'Naranja', ar: 'برتقالي', ro: 'Portocaliu', pt: 'Laranja', de: 'Orange' },
};

const CATEGORIE = {
  display: { en: 'Screen', fr: 'Écran', es: 'Pantalla', ar: 'شاشة', ro: 'Ecran', pt: 'Ecrã', de: 'Display' },
  batterie: { en: 'Battery', fr: 'Batterie', es: 'Batería', ar: 'بطارية', ro: 'Baterie', pt: 'Bateria', de: 'Akku' },
  'back-cover': { en: 'Back cover', fr: 'Vitre arrière', es: 'Tapa trasera', ar: 'الغطاء الخلفي', ro: 'Capac spate', pt: 'Tampa traseira', de: 'Rückseite' },
  fotocamere: { en: 'Camera', fr: 'Caméra', es: 'Cámara', ar: 'كاميرا', ro: 'Cameră', pt: 'Câmara', de: 'Kamera' },
  'connettori-di-ricarica': { en: 'Charging port', fr: 'Connecteur de charge', es: 'Conector de carga', ar: 'منفذ الشحن', ro: 'Conector încărcare', pt: 'Conector de carga', de: 'Ladebuchse' },
  'flex-flat': { en: 'Flex cable', fr: 'Nappe', es: 'Flex', ar: 'كابل مرن', ro: 'Bandă flex', pt: 'Flex', de: 'Flexkabel' },
  'frame-telai': { en: 'Frame', fr: 'Châssis', es: 'Marco', ar: 'الهيكل', ro: 'Ramă', pt: 'Chassi', de: 'Rahmen' },
  speaker: { en: 'Speaker', fr: 'Haut-parleur', es: 'Altavoz', ar: 'سماعة', ro: 'Difuzor', pt: 'Altifalante', de: 'Lautsprecher' },
  auricolari: { en: 'Earpiece', fr: 'Écouteur', es: 'Auricular', ar: 'سماعة الأذن', ro: 'Cască', pt: 'Auricular', de: 'Hörmuschel' },
  microfoni: { en: 'Microphone', fr: 'Microphone', es: 'Micrófono', ar: 'ميكروفون', ro: 'Microfon', pt: 'Microfone', de: 'Mikrofon' },
  vibrazione: { en: 'Vibration motor', fr: 'Vibreur', es: 'Vibrador', ar: 'محرك الاهتزاز', ro: 'Motor vibrații', pt: 'Vibrador', de: 'Vibrationsmotor' },
  tasti: { en: 'Buttons', fr: 'Boutons', es: 'Botones', ar: 'أزرار', ro: 'Butoane', pt: 'Botões', de: 'Tasten' },
  'vetro-fotocamera': { en: 'Camera lens', fr: 'Vitre caméra', es: 'Cristal de cámara', ar: 'زجاج الكاميرا', ro: 'Lentilă cameră', pt: 'Vidro da câmara', de: 'Kameraglas' },
  sensori: { en: 'Sensors', fr: 'Capteurs', es: 'Sensores', ar: 'حساسات', ro: 'Senzori', pt: 'Sensores', de: 'Sensoren' },
  'sim-tray': { en: 'SIM tray', fr: 'Tiroir SIM', es: 'Bandeja SIM', ar: 'حامل الشريحة', ro: 'Suport SIM', pt: 'Gaveta SIM', de: 'SIM-Halter' },
  antenne: { en: 'Antenna', fr: 'Antenne', es: 'Antena', ar: 'هوائي', ro: 'Antenă', pt: 'Antena', de: 'Antenne' },
  'impronta-digitale': { en: 'Fingerprint reader', fr: 'Lecteur d\'empreinte', es: 'Lector de huella', ar: 'قارئ البصمة', ro: 'Senzor amprentă', pt: 'Leitor de impressão', de: 'Fingerabdrucksensor' },
  altro: { en: 'Other', fr: 'Autre', es: 'Otro', ar: 'أخرى', ro: 'Altele', pt: 'Outro', de: 'Sonstiges' },
};

const QUALITA = {
  originale: { en: 'Original', fr: 'Originale', es: 'Original', ar: 'أصلي', ro: 'Original', pt: 'Original', de: 'Original' },
  compatibile: { en: 'Compatible', fr: 'Compatible', es: 'Compatible', ar: 'متوافق', ro: 'Compatibil', pt: 'Compatível', de: 'Kompatibel' },
  rigenerato: { en: 'Refurbished', fr: 'Reconditionné', es: 'Reacondicionado', ar: 'مجدد', ro: 'Recondiționat', pt: 'Recondicionado', de: 'Generalüberholt' },
};

function traduci(tabella, chiave, nome, lingua) {
  if (lingua === 'it') return nome;
  return tabella[chiave]?.[lingua] ?? nome;
}

export const traduciColore = (nome, lingua) => traduci(COLORI, nome, nome, lingua);
export const traduciCategoria = (slug, nome, lingua) => traduci(CATEGORIE, slug, nome, lingua);
// Le sigle tecniche (OLED, Incell, Service Pack) restano invariate in ogni lingua
export const traduciQualita = (slug, nome, lingua) => traduci(QUALITA, slug, nome, lingua);

// Tutti i testi che l'assistente può inviare, nelle lingue supportate.
const MESSAGGI = {
  chiedi_modello: {
    it: () => 'Ciao! Non ho riconosciuto il modello. Puoi scrivermi marca e modello (es. "Samsung A52 5G") oppure il codice che trovi sul telefono (es. SM-A526B)?',
    en: () => 'Hi! I could not identify the model. Can you send me the brand and model (e.g. "Samsung A52 5G") or the code printed on the phone (e.g. SM-A526B)?',
    fr: () => 'Bonjour ! Je n\'ai pas reconnu le modèle. Pouvez-vous m\'indiquer la marque et le modèle (ex. "Samsung A52 5G") ou le code du téléphone (ex. SM-A526B) ?',
    es: () => '¡Hola! No he reconocido el modelo. ¿Puedes indicarme la marca y el modelo (ej. "Samsung A52 5G") o el código del teléfono (ej. SM-A526B)?',
    ar: () => 'مرحبا! لم أتعرف على الموديل. هل يمكنك إرسال الماركة والموديل (مثل "Samsung A52 5G") أو الكود المكتوب على الهاتف (مثل SM-A526B)؟',
    ro: () => 'Bună! Nu am recunoscut modelul. Îmi poți scrie marca și modelul (ex. "Samsung A52 5G") sau codul telefonului (ex. SM-A526B)?',
    pt: () => 'Olá! Não reconheci o modelo. Pode enviar a marca e o modelo (ex. "Samsung A52 5G") ou o código do telemóvel (ex. SM-A526B)?',
    de: () => 'Hallo! Ich habe das Modell nicht erkannt. Können Sie mir Marke und Modell (z. B. "Samsung A52 5G") oder den Code des Telefons (z. B. SM-A526B) schicken?',
  },
  scegli_modello: {
    it: (d) => `Ho trovato più modelli compatibili. Quale ti serve?\n${elenco(d.voci)}\n\nRispondi con il numero.`,
    en: (d) => `I found several matching models. Which one do you need?\n${elenco(d.voci)}\n\nReply with the number.`,
    fr: (d) => `J'ai trouvé plusieurs modèles compatibles. Lequel vous faut-il ?\n${elenco(d.voci)}\n\nRépondez avec le numéro.`,
    es: (d) => `He encontrado varios modelos compatibles. ¿Cuál necesitas?\n${elenco(d.voci)}\n\nResponde con el número.`,
    ar: (d) => `وجدت أكثر من موديل مطابق. أيهما تريد؟\n${elenco(d.voci)}\n\nأجب برقم الخيار.`,
    ro: (d) => `Am găsit mai multe modele compatibile. De care ai nevoie?\n${elenco(d.voci)}\n\nRăspunde cu numărul.`,
    pt: (d) => `Encontrei vários modelos compatíveis. Qual precisa?\n${elenco(d.voci)}\n\nResponda com o número.`,
    de: (d) => `Ich habe mehrere passende Modelle gefunden. Welches brauchen Sie?\n${elenco(d.voci)}\n\nAntworten Sie mit der Nummer.`,
  },
  scegli_ricambio: {
    it: (d) => `${d.modello}: quale ricambio ti serve?\n${elenco(d.voci)}\n\nRispondi con il numero o scrivi il nome.`,
    en: (d) => `${d.modello}: which part do you need?\n${elenco(d.voci)}\n\nReply with the number or the name.`,
    fr: (d) => `${d.modello} : quelle pièce vous faut-il ?\n${elenco(d.voci)}\n\nRépondez avec le numéro ou le nom.`,
    es: (d) => `${d.modello}: ¿qué repuesto necesitas?\n${elenco(d.voci)}\n\nResponde con el número o el nombre.`,
    ar: (d) => `${d.modello}: ما القطعة التي تحتاجها؟\n${elenco(d.voci)}\n\nأجب برقم الخيار أو بالاسم.`,
    ro: (d) => `${d.modello}: de ce piesă ai nevoie?\n${elenco(d.voci)}\n\nRăspunde cu numărul sau cu numele.`,
    pt: (d) => `${d.modello}: de que peça precisa?\n${elenco(d.voci)}\n\nResponda com o número ou o nome.`,
    de: (d) => `${d.modello}: welches Ersatzteil brauchen Sie?\n${elenco(d.voci)}\n\nAntworten Sie mit der Nummer oder dem Namen.`,
  },
  scegli_qualita: {
    it: (d) => `${d.modello} – ${d.ricambio}: ho più versioni. Quale preferisci?\n${elenco(d.voci)}`,
    en: (d) => `${d.modello} – ${d.ricambio}: there are several versions. Which one do you prefer?\n${elenco(d.voci)}`,
    fr: (d) => `${d.modello} – ${d.ricambio} : il y a plusieurs versions. Laquelle préférez-vous ?\n${elenco(d.voci)}`,
    es: (d) => `${d.modello} – ${d.ricambio}: hay varias versiones. ¿Cuál prefieres?\n${elenco(d.voci)}`,
    ar: (d) => `${d.modello} – ${d.ricambio}: هناك عدة إصدارات. أيها تفضل؟\n${elenco(d.voci)}`,
    ro: (d) => `${d.modello} – ${d.ricambio}: am mai multe versiuni. Pe care o preferi?\n${elenco(d.voci)}`,
    pt: (d) => `${d.modello} – ${d.ricambio}: há várias versões. Qual prefere?\n${elenco(d.voci)}`,
    de: (d) => `${d.modello} – ${d.ricambio}: es gibt mehrere Versionen. Welche bevorzugen Sie?\n${elenco(d.voci)}`,
  },
  scegli_colore: {
    it: (d) => `Disponibile in più colori. Quale preferisci?\n${elenco(d.voci)}`,
    en: (d) => `Available in several colours. Which one do you prefer?\n${elenco(d.voci)}`,
    fr: (d) => `Disponible en plusieurs couleurs. Laquelle préférez-vous ?\n${elenco(d.voci)}`,
    es: (d) => `Disponible en varios colores. ¿Cuál prefieres?\n${elenco(d.voci)}`,
    ar: (d) => `متوفر بعدة ألوان. أي لون تفضل؟\n${elenco(d.voci)}`,
    ro: (d) => `Disponibil în mai multe culori. Pe care o preferi?\n${elenco(d.voci)}`,
    pt: (d) => `Disponível em várias cores. Qual prefere?\n${elenco(d.voci)}`,
    de: (d) => `In mehreren Farben verfügbar. Welche bevorzugen Sie?\n${elenco(d.voci)}`,
  },
  prezzo: {
    it: (d) => `${d.articolo}\nPrezzo: ${d.prezzo}\nDisponibile: sì\n\nVuoi confermare l'ordine? Rispondi "sì" (oppure indica la quantità, es. "2 pezzi").`,
    en: (d) => `${d.articolo}\nPrice: ${d.prezzo}\nIn stock: yes\n\nDo you want to confirm the order? Reply "yes" (or tell me the quantity, e.g. "2 pieces").`,
    fr: (d) => `${d.articolo}\nPrix : ${d.prezzo}\nDisponible : oui\n\nVoulez-vous confirmer la commande ? Répondez "oui" (ou indiquez la quantité, ex. "2 pièces").`,
    es: (d) => `${d.articolo}\nPrecio: ${d.prezzo}\nDisponible: sí\n\n¿Quieres confirmar el pedido? Responde "sí" (o indica la cantidad, ej. "2 piezas").`,
    ar: (d) => `${d.articolo}\nالسعر: ${d.prezzo}\nمتوفر: نعم\n\nهل تريد تأكيد الطلب؟ أجب بـ "نعم" (أو حدد الكمية، مثل "قطعتين").`,
    ro: (d) => `${d.articolo}\nPreț: ${d.prezzo}\nDisponibil: da\n\nVrei să confirmi comanda? Răspunde "da" (sau spune cantitatea, ex. "2 bucăți").`,
    pt: (d) => `${d.articolo}\nPreço: ${d.prezzo}\nDisponível: sim\n\nQuer confirmar a encomenda? Responda "sim" (ou indique a quantidade, ex. "2 peças").`,
    de: (d) => `${d.articolo}\nPreis: ${d.prezzo}\nVerfügbar: ja\n\nMöchten Sie die Bestellung bestätigen? Antworten Sie "ja" (oder nennen Sie die Menge, z. B. "2 Stück").`,
  },
  esaurito: {
    it: (d) => `${d.articolo}\nAl momento è esaurito. Vuoi che ti avvisi quando torna disponibile?`,
    en: (d) => `${d.articolo}\nIt is out of stock at the moment. Would you like me to let you know when it is back?`,
    fr: (d) => `${d.articolo}\nActuellement en rupture de stock. Voulez-vous être prévenu dès son retour ?`,
    es: (d) => `${d.articolo}\nAhora mismo está agotado. ¿Quieres que te avise cuando vuelva a estar disponible?`,
    ar: (d) => `${d.articolo}\nغير متوفر حاليا. هل تريد أن أخبرك عند توفره؟`,
    ro: (d) => `${d.articolo}\nMomentan este epuizat. Vrei să te anunț când revine în stoc?`,
    pt: (d) => `${d.articolo}\nDe momento está esgotado. Quer que o avise quando voltar a haver?`,
    de: (d) => `${d.articolo}\nDerzeit nicht auf Lager. Soll ich Sie benachrichtigen, sobald es wieder da ist?`,
  },
  non_a_catalogo: {
    it: (d) => `Mi dispiace, non ho ${d.ricambio} per ${d.modello}.`,
    en: (d) => `Sorry, I do not carry ${d.ricambio} for ${d.modello}.`,
    fr: (d) => `Désolé, je n'ai pas de ${d.ricambio} pour ${d.modello}.`,
    es: (d) => `Lo siento, no tengo ${d.ricambio} para ${d.modello}.`,
    ar: (d) => `عذرا، لا يتوفر لدي ${d.ricambio} لـ ${d.modello}.`,
    ro: (d) => `Îmi pare rău, nu am ${d.ricambio} pentru ${d.modello}.`,
    pt: (d) => `Lamento, não tenho ${d.ricambio} para ${d.modello}.`,
    de: (d) => `Leider habe ich kein ${d.ricambio} für ${d.modello}.`,
  },
  variante_non_disponibile: {
    it: (d) => `Questa combinazione non ce l'ho. Disponibili: ${d.alternative}.`,
    en: (d) => `I do not have that combination. Available: ${d.alternative}.`,
    fr: (d) => `Je n'ai pas cette combinaison. Disponibles : ${d.alternative}.`,
    es: (d) => `No tengo esa combinación. Disponibles: ${d.alternative}.`,
    ar: (d) => `هذا الخيار غير متوفر. المتوفر: ${d.alternative}.`,
    ro: (d) => `Nu am această combinație. Disponibile: ${d.alternative}.`,
    pt: (d) => `Não tenho essa combinação. Disponíveis: ${d.alternative}.`,
    de: (d) => `Diese Kombination habe ich nicht. Verfügbar: ${d.alternative}.`,
  },
  quantita_insufficiente: {
    it: (d) => `Ne ho solo ${d.disponibili}. Vuoi confermare per ${d.disponibili}?`,
    en: (d) => `I only have ${d.disponibili} left. Shall I confirm ${d.disponibili}?`,
    fr: (d) => `Il m'en reste seulement ${d.disponibili}. Je confirme pour ${d.disponibili} ?`,
    es: (d) => `Solo me quedan ${d.disponibili}. ¿Confirmo ${d.disponibili}?`,
    ar: (d) => `لدي ${d.disponibili} فقط. هل أؤكد ${d.disponibili}؟`,
    ro: (d) => `Mai am doar ${d.disponibili}. Confirm pentru ${d.disponibili}?`,
    pt: (d) => `Só tenho ${d.disponibili}. Confirmo ${d.disponibili}?`,
    de: (d) => `Ich habe nur noch ${d.disponibili}. Soll ich ${d.disponibili} bestätigen?`,
  },
  ordine_confermato: {
    it: (d) => `✅ Ordine confermato!\n${d.articolo}\nQuantità: ${d.quantita}\nTotale: ${d.totale}\n\nLo prepariamo subito. Grazie!`,
    en: (d) => `✅ Order confirmed!\n${d.articolo}\nQuantity: ${d.quantita}\nTotal: ${d.totale}\n\nWe are preparing it. Thank you!`,
    fr: (d) => `✅ Commande confirmée !\n${d.articolo}\nQuantité : ${d.quantita}\nTotal : ${d.totale}\n\nNous la préparons. Merci !`,
    es: (d) => `✅ ¡Pedido confirmado!\n${d.articolo}\nCantidad: ${d.quantita}\nTotal: ${d.totale}\n\nLo preparamos enseguida. ¡Gracias!`,
    ar: (d) => `✅ تم تأكيد الطلب!\n${d.articolo}\nالكمية: ${d.quantita}\nالإجمالي: ${d.totale}\n\nسنجهزه حالا. شكرا لك!`,
    ro: (d) => `✅ Comandă confirmată!\n${d.articolo}\nCantitate: ${d.quantita}\nTotal: ${d.totale}\n\nO pregătim imediat. Mulțumim!`,
    pt: (d) => `✅ Encomenda confirmada!\n${d.articolo}\nQuantidade: ${d.quantita}\nTotal: ${d.totale}\n\nVamos preparar já. Obrigado!`,
    de: (d) => `✅ Bestellung bestätigt!\n${d.articolo}\nMenge: ${d.quantita}\nGesamt: ${d.totale}\n\nWir bereiten sie vor. Danke!`,
  },
  annullato: {
    it: () => 'Va bene, non ho registrato nulla. Se ti serve altro scrivimi pure.',
    en: () => 'No problem, nothing has been ordered. Let me know if you need anything else.',
    fr: () => 'Très bien, rien n\'a été commandé. N\'hésitez pas si vous avez besoin d\'autre chose.',
    es: () => 'De acuerdo, no he registrado nada. Escríbeme si necesitas algo más.',
    ar: () => 'حسنا، لم أسجل أي طلب. راسلني إذا احتجت شيئا آخر.',
    ro: () => 'În regulă, nu am înregistrat nimic. Scrie-mi dacă mai ai nevoie de ceva.',
    pt: () => 'Tudo bem, não registei nada. Diga-me se precisar de mais alguma coisa.',
    de: () => 'In Ordnung, es wurde nichts bestellt. Melden Sie sich, wenn Sie etwas brauchen.',
  },
  non_capito: {
    it: () => 'Non ho capito la risposta. Puoi rispondere con il numero della scelta?',
    en: () => 'I did not understand. Could you reply with the number of your choice?',
    fr: () => 'Je n\'ai pas compris. Pouvez-vous répondre avec le numéro de votre choix ?',
    es: () => 'No he entendido. ¿Puedes responder con el número de la opción?',
    ar: () => 'لم أفهم. هل يمكنك الرد برقم الخيار؟',
    ro: () => 'Nu am înțeles. Poți răspunde cu numărul opțiunii?',
    pt: () => 'Não percebi. Pode responder com o número da opção?',
    de: () => 'Das habe ich nicht verstanden. Können Sie mit der Nummer antworten?',
  },
  avviso_scorta: {
    it: (d) => `⚠️ Scorta minima raggiunta\n${d.articolo}\nCodici: ${d.codici}\nRimasti: ${d.quantita} (minimo ${d.minimo})`,
    en: (d) => `⚠️ Minimum stock reached\n${d.articolo}\nCodes: ${d.codici}\nLeft: ${d.quantita} (minimum ${d.minimo})`,
  },
};

export function messaggio(chiave, lingua, dati = {}) {
  const gruppo = MESSAGGI[chiave];
  if (!gruppo) throw new Error(`Messaggio sconosciuto: ${chiave}`);
  const testo = gruppo[lingua] ?? gruppo.en ?? gruppo.it;
  return testo(dati);
}
