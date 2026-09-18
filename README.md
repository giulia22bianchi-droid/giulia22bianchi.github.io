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
npm test             # test su codici, lettura righe fornitore e conversazioni
npm run seed         # ricarica il catalogo di base
```

### Configurazione

| Variabile | Descrizione | Default |
|---|---|---|
| `PORT` | porta del server | `3000` |
| `DB_PATH` | file SQLite del magazzino | `data/magazzino.db` |
| `ACCESS_CODE` | se impostato, le API rispondono solo a chi conosce il codice | *(nessuna protezione)* |
| `WHATSAPP_TOKEN` | token permanente dell'app Meta | — |
| `WHATSAPP_PHONE_NUMBER_ID` | id del numero WhatsApp Business | — |
| `WHATSAPP_VERIFY_TOKEN` | parola scelta da te per la verifica del webhook | — |
| `WHATSAPP_APP_SECRET` | app secret Meta, verifica la firma dei messaggi | — |
| `WHATSAPP_ALERT_PHONE` | numero che riceve gli avvisi di scorta minima | — |
| `CONVERSATION_RETENTION_DAYS` | dopo quanti giorni cancellare le conversazioni | `90` |

> **Importante:** senza `ACCESS_CODE` chiunque raggiunga il server può modificare il
> magazzino. Impostalo sempre quando pubblichi l'applicazione su internet.

### Pubblicazione

Serve un hosting che esegua Node.js (Render, Railway, Fly.io, un VPS…): GitHub Pages
ospita solo file statici e non può eseguire il server né il database. Il disco che contiene
il file del database deve essere persistente, altrimenti il magazzino si azzera a ogni riavvio.

Il file `render.yaml` è già pronto per [render.com](https://render.com):

1. Crea un account e scegli **New → Blueprint**.
2. Collega questo repository: Render legge `render.yaml` e configura tutto da solo.
3. Serve un piano con disco (il piano gratuito non conserva i dati e spegne il servizio).
4. A fine installazione, nella scheda **Environment**, copia il valore di `ACCESS_CODE`:
   è la password che ti verrà chiesta la prima volta su ogni dispositivo.
5. Apri l'indirizzo che Render ti assegna da PC, telefono e tablet: è lo stesso magazzino.

## Come si usa

| Pagina | A cosa serve |
|---|---|
| 🏪 **Banco** | Cerchi "A526 display nero" o "batteria iPhone 13" e ottieni prezzo, disponibilità e pulsanti rapidi −1 / −2 / +1 |
| 📦 **Magazzino** | Tutte le varianti, con filtri; prezzi, quantità e scorte minime sempre modificabili a mano |
| 🔧 **Categorie** | Una pagina per tipo di ricambio: Display, Batterie, Back Cover, Fotocamere… |
| 🛒 **Da ordinare** | Elenco automatico di ciò che è sotto scorta o esaurito |
| 🔔 **Avvisi scorte** | Segnalazioni generate quando una variante tocca la sua soglia |
| 📄 **Carico merce** | Carichi il PDF del fornitore, controlli l'anteprima, confermi |
| 💬 **Assistente WhatsApp** | Provi il bot come se fossi un cliente, rileggi le conversazioni, cancelli i dati di un cliente |
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
    conversation.js   la conversazione del cliente, passo per passo
    i18n.js           lingua del cliente e testi tradotti
    whatsapp.js       invio, firma dei webhook e avvisi di scorta
    events.js         sincronizzazione tra dispositivi (SSE)
  routes/             API REST
  seed/               catalogo iniziale di marche, modelli e codici
public/               interfaccia web (nessun passaggio di build)
test/                 test su codici, lettura PDF e conversazioni
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

GET  /api/whatsapp/webhook               verifica richiesta da Meta
POST /api/whatsapp/webhook               messaggi in arrivo (firma verificata)
POST /api/whatsapp/simula                stessa logica, senza WhatsApp collegato
GET  /api/whatsapp/conversazioni
DELETE /api/whatsapp/conversazioni/:tel  cancella i dati di un cliente
```

## Assistente WhatsApp

Il cliente scrive come gli viene naturale ("Avete display Samsung A16?", "A526 display",
"Do you have a screen for A526?") e l'assistente riconosce la lingua, identifica il telefono,
chiede il ricambio, la qualità e il colore, comunica il prezzo del tuo listino e scarica il
magazzino **solo dopo la conferma**.

```
👤 Hello, do you have a screen for A526?
🤖 Available in several colours. Which one do you prefer?
   1. White  2. Blue  3. Black
👤 black
🤖 Samsung Galaxy A52 5G – Screen OLED Black
   Price: 59.90 €
   In stock: yes
   Do you want to confirm the order? Reply "yes"...
👤 yes
🤖 ✅ Order confirmed! Quantity: 1 — Total: 59.90 €
```

Lingue riconosciute: italiano, inglese, francese, spagnolo, arabo, rumeno, portoghese e
tedesco. Anche le opzioni proposte (colori, ricambi) vengono tradotte, e il cliente può
rispondere con il numero della scelta oppure con la parola nella sua lingua.

Puoi provare tutto dalla pagina **💬 Assistente WhatsApp** anche prima di collegare WhatsApp.

### Collegare WhatsApp Business API

1. Crea un'app su [developers.facebook.com](https://developers.facebook.com) e aggiungi il
   prodotto **WhatsApp**.
2. Prendi nota di **Phone number ID**, **token permanente** e **App secret**.
3. Avvia il server con le variabili `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_APP_SECRET` e un `WHATSAPP_VERIFY_TOKEN` scelto da te.
4. Nella configurazione dei webhook indica `https://tuo-dominio/api/whatsapp/webhook`,
   lo stesso verify token, e iscriviti al campo **messages**.
5. Imposta `WHATSAPP_ALERT_PHONE` per ricevere su WhatsApp gli avvisi di scorta minima.

Il webhook accetta solo richieste con firma valida (`X-Hub-Signature-256`) e ignora i
messaggi già elaborati, così i rinvii automatici di Meta non generano ordini doppi.

### Dati dei clienti

Di ogni cliente WhatsApp vengono conservati numero, nome del profilo, lingua, stato della
conversazione e messaggi scambiati: servono a riprendere il discorso e a ricostruire gli
ordini. Le conversazioni più vecchie di `CONVERSATION_RETENTION_DAYS` (90 giorni di default)
vengono cancellate da sole, e dalla pagina dell'assistente puoi cancellare su richiesta tutti
i dati di un singolo cliente.

## Stato delle funzioni richieste

| # | Funzione | Stato |
|---|---|---|
| 1 | Magazzino centrale sincronizzato | ✅ |
| 2 | Categorie ricambi separate | ✅ 18 categorie, se ne aggiungono altre |
| 3 | Database modelli e codici | ✅ 181 modelli, cresce con l'uso |
| 4 | Ricerca automatica dei codici online | ⚠️ i codici sconosciuti vengono registrati e li associ tu in un clic; la ricerca automatica richiede una fonte dati esterna da scegliere |
| 5 | Assistente WhatsApp | ✅ conversazione completa; per i clienti veri servono le credenziali Meta |
| 6 | Colori | ✅ |
| 7 | Qualità/tipi di display | ✅ |
| 8 | Prezzo automatico dal tuo listino | ✅ |
| 9 | Richieste incomplete: chiede invece di presumere | ✅ |
| 10 | Multilingua | ✅ riconosce la lingua e risponde nella stessa: italiano, inglese, francese, spagnolo, arabo, rumeno, portoghese, tedesco |
| 11 | Conferma ordine prima dello scarico | ✅ |
| 12 | Scarico automatico dopo la conferma | ✅ |
| 13 | Numero cliente registrato sulla vendita | ✅ con cancellazione su richiesta e scadenza automatica |
| 14 | Vendita diretta al banco | ✅ |
| 15 | Sincronizzazione in tempo reale | ✅ |
| 16 | Scorta minima per variante | ✅ |
| 17 | Avviso scorte | ✅ in app, via API e su WhatsApp al numero configurato |
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

### Cosa resta da concordare

- **Ricerca automatica dei codici online** (punto 4): serve scegliere una fonte dati
  (GSMArena, un servizio a pagamento, i cataloghi dei tuoi fornitori). Nel frattempo ogni
  codice sconosciuto viene registrato e lo associ con un clic da "Modelli e codici".
- **Lettura dei cataloghi dei fornitori** (punto 23): oggi confronti incollando le righe;
  la lettura automatica va concordata sito per sito.
