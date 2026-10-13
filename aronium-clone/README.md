# Aronium Clone

Clone di un punto cassa in stile **Aronium POS**, in italiano. App statica (JavaScript puro, nessuna dipendenza): i dati restano nel `localStorage` del browser.

> Ricostruito dagli screenshot e dalle funzionalità pubbliche di Aronium, non da una copia dell'installazione locale (non accessibile da questo ambiente). Non è affiliato ad Aronium.

## Avvio
```
cd aronium-clone
npm start        # http://localhost:8080  (PORT per cambiare porta)
npm test         # test del livello dati
```
Si può anche servire la cartella con un qualsiasi server statico.

## Accesso
Login a sola password, con tastiera su schermo (anche tastiera fisica). Credenziali iniziali: **admin** (amministratore, accede anche al back office) e **1234** (cassiere, solo cassa). Cambiale da Impostazioni > Utenti: serve a bloccare la cassa, non protegge i dati (sono nel browser).

## Funzioni
- **Cassa** (layout come Aronium, tema scuro): barra di ricerca con 4 modalità (tutto / barcode / codice / nome), righe selezionabili, pannello pulsanti con scorciatoie **F2** sconto, **F3** cerca, **F4** quantità, **F7** sospesi, **F8** nuova vendita, **F9** salva, **F10** pagamento, **F12** contanti. Cash (con resto), Card e Check, pagamento misto, prezzo modificabile, cliente, Dine-in/Take-away, rimborso, blocco, stampa scontrino (80 mm).
- **Prodotti**: anagrafica con barcode univoco, gruppo, IVA, prezzo IVA inclusa, costo, scorta minima; archiviazione se già movimentati; export CSV.
- **Magazzino**: giacenze, valore a costo/prezzo, carico merce (aggiorna il costo), inventario con rettifica tracciata.
- **Documenti**: vendite, resi (parziali, mai oltre il venduto), acquisti, rettifiche; ristampa.
- **Clienti** con storico acquisti, **Report** (incasso, IVA, utile, per giorno/pagamento/gruppo/prodotto), **Impostazioni** (azienda, gruppi, IVA, pagamenti, backup JSON).

## Struttura
`js/store.js` logica e dati (senza DOM, testata) · `js/app.js` viste · `js/ui.js` helper DOM e icone · `css/style.css`.

## Limiti noti
Un solo terminale, nessuna stampante fiscale/RT né cassetto contanti reale, nessuna sincronizzazione. Il pulsante «Sospesi» sostituisce il «Trasferimento» di Aronium.
