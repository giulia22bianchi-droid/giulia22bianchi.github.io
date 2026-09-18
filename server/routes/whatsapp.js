import { Router } from 'express';
import { db } from '../db.js';
import { InventoryError } from '../lib/inventory.js';
import {
  rispondi, registraMessaggio, giaElaborato, leggiConversazione,
  dimenticaCliente, pulisciVecchieConversazioni,
} from '../lib/conversation.js';
import { config, stato, firmaValida, inviaMessaggio, estraiMessaggi } from '../lib/whatsapp.js';

export const whatsappRouter = Router();

whatsappRouter.get('/stato', (req, res) => {
  res.json({
    ...stato(),
    conversazioni: db.prepare(`SELECT COUNT(*) AS n FROM conversations`).get().n,
    messaggi: db.prepare(`SELECT COUNT(*) AS n FROM whatsapp_messages`).get().n,
  });
});

// Verifica iniziale del webhook richiesta da Meta
whatsappRouter.get('/webhook', (req, res) => {
  const modo = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (!config.verifyToken) {
    return res.status(503).send('WHATSAPP_VERIFY_TOKEN non configurato');
  }
  if (modo === 'subscribe' && token === config.verifyToken) {
    return res.status(200).send(String(challenge ?? ''));
  }
  res.sendStatus(403);
});

whatsappRouter.post('/webhook', async (req, res) => {
  if (!firmaValida(req.rawBody, req.get('x-hub-signature-256'))) {
    return res.sendStatus(401);
  }

  // Meta ripete la consegna se non riceve subito un 200
  res.sendStatus(200);

  try {
    for (const messaggio of estraiMessaggi(req.body)) {
      if (giaElaborato(messaggio.id)) continue;
      registraMessaggio({
        id: messaggio.id,
        phone: messaggio.telefono,
        direzione: 'entrata',
        testo: messaggio.testo,
      });

      const risposta = rispondi({
        telefono: messaggio.telefono,
        testo: messaggio.testo,
        nome: messaggio.nome,
      });
      await inviaMessaggio(messaggio.telefono, risposta.testo);
    }
    pulisciVecchieConversazioni();
  } catch (err) {
    console.error('Errore nella gestione del messaggio WhatsApp:', err);
  }
});

// Simulatore: stessa logica del bot, senza bisogno di credenziali
whatsappRouter.post('/simula', (req, res) => {
  const { telefono = '+390000000000', testo, nome = null } = req.body ?? {};
  if (!testo?.trim()) throw new InventoryError('Campo "testo" obbligatorio');

  const idEntrata = `sim-in-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  registraMessaggio({ id: idEntrata, phone: telefono, direzione: 'entrata', testo });

  const risposta = rispondi({ telefono, testo, nome });

  registraMessaggio({
    id: `sim-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    phone: telefono,
    direzione: 'uscita',
    testo: risposta.testo,
  });

  res.json(risposta);
});

whatsappRouter.get('/conversazioni', (req, res) => {
  const righe = db
    .prepare(
      `SELECT c.phone, c.name, c.lingua, c.stato, c.updated_at,
              (SELECT COUNT(*) FROM whatsapp_messages m WHERE m.phone = c.phone) AS messaggi,
              (SELECT COUNT(*) FROM sales s WHERE s.customer_phone = c.phone) AS ordini
       FROM conversations c ORDER BY c.updated_at DESC LIMIT 200`,
    )
    .all();
  res.json({ totale: righe.length, conversazioni: righe });
});

whatsappRouter.get('/conversazioni/:telefono', (req, res) => {
  const telefono = req.params.telefono;
  res.json({
    ...leggiConversazione(telefono),
    messaggi: db
      .prepare(`SELECT * FROM whatsapp_messages WHERE phone = ? ORDER BY created_at, rowid LIMIT 200`)
      .all(telefono),
  });
});

// Cancellazione dei dati personali di un cliente su richiesta
whatsappRouter.delete('/conversazioni/:telefono', (req, res) => {
  res.json(dimenticaCliente(req.params.telefono));
});
