import { createHmac, timingSafeEqual } from 'node:crypto';
import { onEvent } from './events.js';
import { registraMessaggio } from './conversation.js';
import { messaggio } from './i18n.js';

export const config = {
  token: process.env.WHATSAPP_TOKEN,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
  appSecret: process.env.WHATSAPP_APP_SECRET,
  alertPhone: process.env.WHATSAPP_ALERT_PHONE,
  apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
};

export const attivo = Boolean(config.token && config.phoneNumberId);

export function stato() {
  return {
    attivo,
    invio_configurato: Boolean(config.token && config.phoneNumberId),
    webhook_configurato: Boolean(config.verifyToken),
    firma_verificata: Boolean(config.appSecret),
    avvisi_scorte: config.alertPhone ? 'configurati' : 'non configurati',
    api: config.apiVersion,
  };
}

/**
 * Meta firma ogni richiesta con l'app secret: senza questo controllo chiunque
 * conosca l'indirizzo del webhook potrebbe inviare messaggi finti.
 */
export function firmaValida(rawBody, header) {
  if (!config.appSecret) return true; // nessun segreto configurato: controllo disattivato
  if (!header || !rawBody) return false;
  const atteso = `sha256=${createHmac('sha256', config.appSecret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(header);
  const b = Buffer.from(atteso);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Le risposte restano nello storico anche quando l'invio non è configurato:
// serve a rileggere la conversazione dall'interfaccia.
function annota(telefono, testo, id) {
  registraMessaggio({
    id: id ?? `locale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    phone: telefono,
    direzione: 'uscita',
    testo,
  });
}

export async function inviaMessaggio(telefono, testo) {
  if (!attivo) {
    console.log(`[whatsapp non configurato] a ${telefono}: ${testo}`);
    annota(telefono, testo);
    return { inviato: false, motivo: 'WhatsApp non configurato' };
  }

  const risposta = await fetch(
    `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: telefono,
        type: 'text',
        text: { preview_url: false, body: testo },
      }),
    },
  );

  const esito = await risposta.json().catch(() => ({}));
  if (!risposta.ok) {
    console.error('Invio WhatsApp fallito:', risposta.status, esito);
    return { inviato: false, motivo: esito?.error?.message ?? `HTTP ${risposta.status}` };
  }

  const id = esito?.messages?.[0]?.id;
  annota(telefono, testo, id);
  return { inviato: true, id };
}

/** Estrae i messaggi di testo da un payload del webhook Meta. */
export function estraiMessaggi(payload) {
  const messaggi = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const valore = change.value ?? {};
      const contatti = new Map(
        (valore.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]),
      );
      for (const m of valore.messages ?? []) {
        // Bottoni e liste arrivano come "interactive": si leggono come testo
        const testo =
          m.text?.body ??
          m.interactive?.button_reply?.title ??
          m.interactive?.list_reply?.title ??
          m.button?.text ??
          null;
        if (!testo) continue;
        messaggi.push({
          id: m.id,
          telefono: m.from,
          nome: contatti.get(m.from) ?? null,
          testo,
          timestamp: m.timestamp,
        });
      }
    }
  }
  return messaggi;
}

// Gli avvisi di scorta minima arrivano sul numero indicato dal negozio
let avvisiCollegati = false;

export function collegaAvvisiScorte() {
  if (avvisiCollegati || !config.alertPhone) return;
  avvisiCollegati = true;

  onEvent(async (tipo, dato) => {
    if (tipo !== 'scorta') return;
    const testo = messaggio('avviso_scorta', 'it', {
      articolo: [dato.brand, dato.model, '–', dato.category, dato.quality, dato.color]
        .filter(Boolean)
        .join(' '),
      codici: dato.codes ?? '—',
      quantita: dato.quantity,
      minimo: dato.min_stock,
    });
    try {
      await inviaMessaggio(config.alertPhone, testo);
    } catch (err) {
      console.error('Avviso scorta non inviato:', err.message);
    }
  });
}
