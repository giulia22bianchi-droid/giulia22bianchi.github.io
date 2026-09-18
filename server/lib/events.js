// Hub Server-Sent Events: quando un dispositivo modifica il magazzino,
// tutti gli altri (PC, telefono, tablet) ricevono subito la nuova quantità.

const clients = new Set();
const listeners = new Set();
let lastId = 0;

/** Permette al codice del server di reagire agli eventi (es. avvisi su WhatsApp). */
export function onEvent(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

export function addClient(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

export function broadcast(type, payload = {}) {
  for (const handler of listeners) {
    try {
      handler(type, payload);
    } catch (err) {
      console.error('Errore in un ascoltatore di eventi:', err);
    }
  }

  lastId += 1;
  const frame = `id: ${lastId}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }
}

export function clientCount() {
  return clients.size;
}
