# 📦 Magazzino Ricambi

Gestionale per un negozio di ricambi per telefonia: catalogo modelli e codici, magazzino
sincronizzato su più dispositivi, vendite, carico merce da PDF, scorte e statistiche.

Funziona da PC, telefono e tablet sullo stesso magazzino centrale: se scarichi un pezzo dal
telefono, il PC vede la nuova quantità nello stesso istante.

## Avvio

```bash
npm install
npm start            # http://localhost:3000
```

Al primo avvio il database viene creato e popolato con 18 categorie ricambi, 9 qualità,
12 marche e 181 modelli con 362 codici (Samsung, Apple, Xiaomi, Redmi, POCO, Oppo, Realme,
Honor, Huawei, Motorola, OnePlus, Google Pixel).

```bash
npm test             # test su riconoscimento codici e lettura righe fornitore
npm run seed         # ricarica il catalogo di base
```

### Configurazione

| Variabile | Descrizione | Default |
|---|---|---|
| `PORT` | porta del server | `3000` |
| `DB_PATH` | file SQLite del magazzino | `data/magazzino.db` |
| `ACCESS_CODE` | se impostato, le API rispondono solo a chi conosce il codice | *(nessuna protezione)* |

> **Importante:** senza `ACCESS_CODE` chiunque raggiunga il server può modificare il
> magazzino. Impostalo sempre quando pubblichi l'applicazione su internet.

### Pubblicazione

Serve un hosting che esegua Node.js (Render, Railway, Fly.io, un VPS…): GitHub Pages
ospita solo file statici e non può eseguire il server né il database. Il disco che contiene
`data/` deve essere persistente, altrimenti il magazzino si azzera a ogni riavvio.

## Come si usa

| Pagina | A cosa serve |
|---|---|
| 🏪 **Banco** | Cerchi "A526 display nero" o "batteria iPhone 13" e ottieni prezzo, disponibilità e pulsanti rapidi −1 / −2 / +1 |
| 📦 **Magazzino** | Tutte le varianti, con filtri; prezzi, quantità e scorte minime sempre modificabili a mano |
| 🔧 **Categorie** | Una pagina per tipo di ricambio: Display, Batterie, Back Cover, Fotocamere… |
| 🛒 **Da ordinare** | Elenco automatico di ciò che è sotto scorta o esaurito |
| 🔔 **Avvisi scorte** | Segnalazioni generate quando una variante tocca la sua soglia |
| 📄 **Carico merce** | Carichi il PDF del fornitore, controlli l'anteprima, confermi |
| 📊 **Vendite giornaliere** | Tutto il venduto della giornata, banco e WhatsApp insieme |
| 💶 **Riepilogo giornata** | Pezzi, incassi, canali, categorie, articoli sotto scorta |
| 📈 **Statistiche** | Prodotti più venduti, modelli richiesti, andamento, articoli fermi |
| ➕ **Prodotti mancanti** | Ricambi visti da fornitori esterni che tu non hai a catalogo |
| 📚 **Modelli e codici** | Il database dei telefoni; qui insegni al sistema i codici che non conosce |

### Le regole che il sistema rispetta

- **Un preventivo non scarica il magazzino.** Le quantità scendono solo quando registri la
  vendita.
- **Non si tira a indovinare.** Se scrivi "A52" il sistema non sceglie fra A52 4G, A52 5G e
  A52s: chiede quale. Se scrivi solo "A526" non presume che tu voglia un display.
- **Il PDF non modifica niente da solo.** Prima mostra l'anteprima (`4 + 10 = 14`), e solo
  dopo la tua conferma somma le quantità.
- **I prodotti nuovi vengono segnalati**, non creati in silenzio.
- **Le righe poco chiare restano bloccate** finché non le confermi tu.

## Struttura

```
server/
  db.js               schema SQLite e normalizzazione dei codici
  index.js            server Express, protezione accesso, eventi realtime
  lib/
    resolver.js       da "A526" o "display Samsung A16" al modello giusto
    lexicon.js        sinonimi multilingua di categorie, qualità e colori
    assistant.js      logica di risposta: cosa chiedere quando manca un dato
    inventory.js      movimenti, vendite, avvisi di scorta
    pdfIntake.js      lettura delle righe dei documenti fornitore
    events.js         sincronizzazione tra dispositivi (SSE)
  routes/             API REST
  seed/               catalogo iniziale di marche, modelli e codici
public/               interfaccia web (nessun passaggio di build)
test/                 test su riconoscimento codici e lettura PDF
```

### API principali

```
GET  /api/search?q=A526 display nero     risposta completa: modello, prezzo, cosa chiedere
GET  /api/catalog/identify?q=SM-A526B    solo identificazione del modello
GET  /api/items?category=display         magazzino con filtri
POST /api/items/:id/adjust {delta:-1}    operazioni rapide da banco
POST /api/sales                          conferma vendita e scarico
GET  /api/sales/daily · /api/sales/summary
GET  /api/stock/da-ordinare · /api/stock/alerts
POST /api/intake/pdf                     analisi documento → bozza (non tocca il magazzino)
POST /api/intake/drafts/:id/conferma     carico effettivo
GET  /api/stats
GET  /api/events                         flusso realtime degli aggiornamenti
```

## Stato delle funzioni richieste

| # | Funzione | Stato |
|---|---|---|
| 1 | Magazzino centrale sincronizzato | ✅ |
| 2 | Categorie ricambi separate | ✅ 18 categorie, se ne aggiungono altre |
| 3 | Database modelli e codici | ✅ 181 modelli, cresce con l'uso |
| 4 | Ricerca automatica dei codici online | ⚠️ i codici sconosciuti vengono registrati e li associ tu in un clic; la ricerca automatica richiede una fonte dati esterna da scegliere |
| 5 | Assistente WhatsApp | ⏳ la logica c'è già (`/api/search`); manca il collegamento a WhatsApp Business API |
| 6 | Colori | ✅ |
| 7 | Qualità/tipi di display | ✅ |
| 8 | Prezzo automatico dal tuo listino | ✅ |
| 9 | Richieste incomplete: chiede invece di presumere | ✅ |
| 10 | Multilingua | ⚠️ capisce italiano, inglese, francese, spagnolo, rumeno e arabo; le risposte sono in italiano (la traduzione arriva con il bot) |
| 11 | Conferma ordine prima dello scarico | ✅ |
| 12 | Scarico automatico dopo la conferma | ✅ |
| 13 | Numero cliente registrato sulla vendita | ✅ |
| 14 | Vendita diretta al banco | ✅ |
| 15 | Sincronizzazione in tempo reale | ✅ |
| 16 | Scorta minima per variante | ✅ |
| 17 | Avviso scorte | ✅ in app e via API; il canale WhatsApp si collega in fase 2 |
| 18 | Pagina DA ORDINARE | ✅ |
| 19 | Storico vendite | ✅ |
| 20 | Vendite giornaliere | ✅ |
| 21 | Riepilogo fine giornata | ✅ |
| 22 | Statistiche | ✅ |
| 23 | Analisi di cataloghi esterni | ⚠️ confronto sulle righe che incolli; la lettura automatica dei siti fornitore va concordata sito per sito |
| 24 | Pagina PRODOTTI MANCANTI | ✅ |
| 25 | Caricamento merce da PDF | ✅ |
| 26 | Anteprima prima del carico | ✅ |
| 27 | Conferma carico | ✅ |
| 28 | Segnalazione nuovi articoli | ✅ |
| 29 | Storico carichi | ✅ |
| 30 | Controlli contro gli errori | ✅ |

### Cosa serve per la fase 2 (WhatsApp)

1. Un account **WhatsApp Business API** (Meta Cloud API, Twilio o 360dialog).
2. Un numero dedicato e le credenziali del provider.
3. Un indirizzo pubblico in HTTPS per ricevere i webhook dei messaggi.

Il motore che interpreta le richieste, controlla il magazzino, chiede colore e qualità e
calcola il prezzo è già pronto: il bot dovrà solo passargli il testo del cliente
(`assist()` in `server/lib/assistant.js`) e tradurre la risposta nella lingua del messaggio.
