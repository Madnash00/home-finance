# Casa Finance

Dashboard installabile per contabilità familiare, Budget, Forecast e Actual. Il repository contiene solo codice: database, estratti conto e configurazioni personali restano privati.

## Installazione da GitHub

Prerequisiti: Python 3.12 oppure Docker Desktop.

```bash
git clone <URL-DEL-REPOSITORY>
cd Famiglia
cp .env.example .env
./setup.sh
./start.sh
```

Su Windows utilizzare `start.bat` dopo aver installato le dipendenze in un virtual environment. In alternativa:

```bash
docker compose up --build -d
```

## Avvio

```bash
./start.sh
```

Aprire `http://127.0.0.1:8766`. Al primo avvio viene creato un database privato in `data/contabilita.db`. Movimenti, categorie, Budget, Forecast e finanziamenti si gestiscono dall'app.

## Backup su Google Drive

Il metodo consigliato evita di pubblicare token o password Google:

1. Installare Google Drive per desktop e accedere all'account autorizzato.
2. Creare in Drive una cartella `CasaFinance`.
3. Copiare `.env.example` in `.env`.
4. Impostare `DRIVE_BACKUP_DIR` con il percorso locale della cartella sincronizzata.
5. Lasciare `DRIVE_AUTO_BACKUP=true`.

L'app crea un backup SQLite consistente dopo importazioni e modifiche, oltre al file `contabilita-latest.db`. La pagina Impostazioni permette un backup immediato. Su server Linux si può usare una cartella Drive montata tramite `rclone`.

Non inserire mai nel repository password, token OAuth, file `.env` o database. L'indirizzo Google non è scritto nel codice: l'accesso dipende dall'account collegato al client Drive o al mount configurato.

## Architettura

- Backend Python standard library con API JSON e server statico.
- Database SQLite normalizzato, indici per data/categoria/periodo e transazioni atomiche.
- Frontend responsive senza dipendenze di rete.
- `raw_transactions` conserva il payload originale ed è protetta da trigger contro modifica ed eliminazione.

## Importazione e deduplicazione

Il parser cerca semanticamente l'intestazione (`Data contabile`, `Descrizione`), legge i metadati del conto, normalizza date, testi e segni e calcola una fingerprint SHA-256 su conto, date, importo, descrizioni e canale. Un file già importato è riconosciuto dall'hash del file; una fingerprint identica non viene reinserita.

## Categorizzazione

Categorie e keyword provengono da `DB ANALISI_Consolidato`. Le regole sono ordinate per priorità e specificità; i movimenti senza match restano nella coda di revisione. Le modifiche manuali sono registrate nell'audit log.

## Modifica dei prospetti

- **Budget & Forecast**: consente di creare e modificare valori annuali, scenario, metodo, stato e note. Budget e Forecast restano separati; ogni aggiornamento incrementa la versione ed entra nell'audit log.
- **Finanziamenti**: consente di compilare e aggiornare finanziatore, rata, rate totali/pagate, scadenza e stato.
- **Regole e categorie**: consente di aggiungere, rinominare, descrivere e disattivare le voci che compongono i prospetti.
- **Actual vs LY / LLY**: confronta periodi YTD omogenei e mostra delta assoluti e percentuali. Per le uscite, una spesa meno negativa è indicata come favorevole.

L'importazione Excel aggiorna esclusivamente il registro dei movimenti e non sovrascrive Budget, Forecast, finanziamenti o struttura dei prospetti.

### Regole operative correnti

- I file Excel sono trattati esclusivamente come sorgente del database movimenti.
- Budget e Forecast sono gestiti in due sezioni separate dell'app e non includono più Scenario o Metodo.
- Le voci e le keyword sono gestite per anno. Dal 2027 l'apertura di un nuovo anno clona automaticamente voci e regole dell'anno precedente.
- I finanziamenti calcolano rate totali da attivazione/scadenza e rate pagate fino alla data dell'ultimo movimento disponibile.
- I valori negativi sono visualizzati con il segno meno; i colori degli scostamenti seguono il significato economico favorevole/sfavorevole.
- Tutte le tabelle operative hanno ordinamento crescente/decrescente dall'intestazione.
- Gli importi a valore sono mostrati senza decimali; le percentuali mantengono la precisione necessaria.
- Budget e Forecast sono presentati in un unico prospetto con Actual YTD, LY e LLY, pur restando entità modificabili separatamente.
- Il registro Movimenti contiene lo storico completo di `DB MOVIMENTI` e aggiunge soltanto le righe nuove degli estratti successivi. La consultazione è paginata per mantenere l'app fluida.
- La manutenzione dati ha rimosso le sole sovrapposizioni tra storico e nuovo estratto, conservando i payload originali dei batch importati.

## Backup e aggiornamento

La pagina Impostazioni consente di scaricare il database SQLite completo o salvarlo nella cartella Drive configurata. Per ripristinarlo, arrestare l'applicazione e sostituire `data/contabilita.db` con la copia verificata.

## Test

```bash
./test.sh
```

## Assunzioni e differenze rispetto a Excel

- Il 2026 è l'anno iniziale perché è l'anno di Budget/Forecast nel file sorgente.
- I grafici sono ridisegnati per il web e non copiano gli oggetti pivot di Excel.
- Il saldo disponibile viene letto dal nuovo estratto; lo storico rimane consultabile separatamente.
- L'applicazione privilegia tracciabilità e dati normalizzati: il file sorgente non viene mai modificato.
