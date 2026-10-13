# Aronium Clone

Clone di un punto cassa in stile **Aronium POS**, in italiano. App statica (JavaScript puro, nessuna dipendenza): i dati restano nel `localStorage` del browser.

> Ricostruito dalle funzionalità pubbliche di Aronium, non da una copia dell'installazione locale (non accessibile da questo ambiente). Non è affiliato ad Aronium.

## Avvio
```
cd aronium-clone
npm start        # http://localhost:8080  (PORT per cambiare porta)
npm test         # test del livello dati
```
Si può anche servire la cartella con un qualsiasi server statico.

## Funzioni
- **Cassa**: griglia prodotti per gruppo, ricerca/barcode (Invio), quantità, sconto riga e documento, cliente, ordini sospesi, pagamento misto (contanti con resto, carta, altro), stampa scontrino (80 mm).
- **Prodotti**: anagrafica con barcode univoco, gruppo, IVA, prezzo IVA inclusa, costo, scorta minima; archiviazione se già movimentati; export CSV.
- **Magazzino**: giacenze, valore a costo/prezzo, carico merce (aggiorna il costo), inventario con rettifica tracciata.
- **Documenti**: vendite, resi (parziali, mai oltre il venduto), acquisti, rettifiche; ristampa.
- **Clienti** con storico acquisti, **Report** (incasso, IVA, utile, per giorno/pagamento/gruppo/prodotto), **Impostazioni** (azienda, gruppi, IVA, pagamenti, backup JSON).

## Struttura
`js/store.js` logica e dati (senza DOM, testata) · `js/app.js` viste · `js/ui.js` helper DOM · `css/style.css`.

## Limiti noti
Un solo utente/terminale, nessun login, nessuna stampante fiscale/RT né sincronizzazione.
