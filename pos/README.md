# 🛒 Cassa POS (clone di Aronium)

Punto cassa completo, ispirato ad [Aronium](https://aronium.com): cassa touch con codice a barre,
magazzino, clienti e fornitori, fatture, resi, acquisti, turni di cassa, report, utenti con permessi,
stampa di scontrini ed etichette. Gira nel browser da PC, tablet o telefono, con un server Node.js e un
database SQLite (stesso stack del gestionale magazzino ricambi, ma completamente indipendente).

## Avvio

```bash
npm install
npm run pos          # http://localhost:3100
npm test             # include i test della cassa
```

Primo accesso: utente **admin**, password **admin**. Cambiala subito da *Impostazioni → La mia password*.

| Variabile | Descrizione | Default |
|---|---|---|
| `POS_PORT` (o `PORT`) | porta del server | `3100` |
| `POS_DB_PATH` | file SQLite | `data/pos.db` |

## Funzioni

| Area | Cosa fa |
|---|---|
| **Cassa** | griglia prodotti per gruppo/preferiti, ricerca e lettore codici a barre (`3*codice` per più pezzi), carrello, sconto riga e documento (% o importo), cliente con sconto abituale, righe libere, note, documenti in sospeso, pagamento diviso su più metodi con resto, scontrino 80 mm, fattura A4. Tasti: **F2** incassa, **F4** cerca, **F6** sospendi |
| **Documenti** | vendite, fatture, resi (parziali, con controllo sul venduto), acquisti, rettifiche; annullamento con ripristino giacenze; incassi successivi delle fatture; ristampa |
| **Prodotti** | codice, barcode principale e aggiuntivi, gruppo, IVA, costo/prezzo/ricarico, scorta minima, servizi senza giacenza, archiviazione, import/export CSV, etichette con Code 128 |
| **Gruppi, IVA, metodi di pagamento** | tutti configurabili |
| **Clienti e fornitori** | anagrafica, sconto, saldo da incassare/pagare, storico documenti |
| **Acquisti** | carico merce da fornitore: aumenta la giacenza e aggiorna il costo |
| **Magazzino** | giacenze, inventario con conta fisica, storico movimenti, valore a costo e a prezzo |
| **Cassa e turni** | apertura con fondo cassa, versamenti/prelievi, lettura X, chiusura Z con differenza contante |
| **Report** | riepilogo (ricavi, IVA, sconti, margine), per giorno/ora/prodotto/gruppo/operatore/cliente/aliquota, magazzino; export CSV |
| **Utenti e ruoli** | 14 permessi granulari (Amministratore, Responsabile, Cassiere di base) |
| **Impostazioni** | dati attività, prezzi IVA inclusa/esclusa, obbligo di turno, giacenza negativa, prefissi numerazione, backup |

## Note

- Il ripristino di un backup viene applicato al riavvio del server.
- Gli scontrini stampati **non sono documenti fiscali**: per l'uso commerciale in Italia serve un registratore
  telematico o una procedura web autorizzata dall'Agenzia delle Entrate. Questo software gestisce la
  parte gestionale.
- Pubblicazione: come il gestionale ricambi, serve un hosting Node.js con disco persistente (GitHub Pages non basta).
