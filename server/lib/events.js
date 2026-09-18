// Hub Server-Sent Events: quando un dispositivo modifica il magazzino,
// tutti gli altri (PC, telefono, tablet) ricevono subito la nuova quantità.

const clients = new Set();
let lastId = 0;

export function addClient(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

export function broadcast(type, payload = {}) {
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
