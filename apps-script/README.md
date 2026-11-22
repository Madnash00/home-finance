# Backend Google Drive di Home Finance

L’interfaccia rimane su [GitHub Pages](https://madnash00.github.io/home-finance/). Il progetto Apps Script espone due operazioni JSON, lettura e salvataggio. La cartella rimane nel Drive dell’account che esegue il deployment. La PWA cifra l’intero IndexedDB (movimenti, categorie, piani, finanziamenti e metadati) con AES-GCM prima dell’invio.

## Configurare il progetto Apps Script

1. Aggiungere `Code.gs` al progetto. Usare il runtime V8. Se si modifica il manifest esplicito, usare `appsscript.json`.
2. In **Home Finance → Importazione e Backup → Sincronizzazione con Google Drive**, scegliere **Genera chiave**, **Mostra chiave** e conservarla in un gestore di password. Selezionare **Codice di verifica per Apps Script** e copiare quel codice separato.
3. In **Impostazioni progetto → Proprietà script**, impostare `HF_FOLDER_ID` con l’ID della cartella autorizzata e `HF_AUTH_SHA256` con il codice di verifica. Il valore di quest’ultimo è un hash e non permette di decifrare il database.
4. Eseguire `checkDatabaseFolder` dall’editor. Autorizzare l’accesso a Drive dal proprio account Google. Apps Script richiede lo scope Google Drive in lettura e scrittura. Il codice usa soltanto la cartella configurata e il file `home-finance-database.encrypted.json` al suo interno.
5. Eseguire il deployment come **App web**, eseguita come proprietario e accessibile a **Chiunque**. È necessario che GitHub Pages possa raggiungere l’endpoint senza affidarsi ai cookie di Google. Una chiamata senza credenziale valida non legge né modifica il file. La richiesta contiene solo la credenziale derivata dalla chiave. Il codice non contiene identificativi della cartella o chiavi.
6. Copiare l’URL che termina in `/exec`. Inserirlo in Home Finance, partendo dal dispositivo che contiene l’archivio da conservare, insieme alla chiave privata. Selezionare **Collega e sincronizza**. Su ogni altro dispositivo inserire gli stessi valori. Il file viene creato al primo salvataggio riuscito.

In caso di modifiche concorrenti, l’app chiede quale archivio conservare e scarica prima la copia locale. Il backend accetta le scritture solo quando la revisione attesa corrisponde alla revisione corrente. Offline, le modifiche rimangono in IndexedDB e la sincronizzazione riprende quando torna la connessione. Conservare la chiave privata insieme ai backup. La chiave privata è indispensabile per il recupero.

## Collegare altri dispositivi

Dopo il primo collegamento, scegliere **Collega un altro dispositivo** per generare un QR e un link monouso. Sul nuovo dispositivo aprire Home Finance, scegliere **Collega questo dispositivo** e scansionare il QR. In alternativa usare il link. La PWA cifra la chiave privata con una chiave temporanea presente solo nel frammento del link. Apps Script conserva il pacchetto cifrato in cache per massimo cinque minuti e lo rimuove quando viene ritirato. Se ci sono già dati locali diversi, l'app chiede conferma prima di scaricare l'archivio Drive.

Per rilasciare una modifica al backend, aggiornare la versione del deployment esistente in Apps Script per mantenere lo stesso URL.

## Accesso Google

Creare un client OAuth di tipo Applicazione web in un progetto Google Cloud dedicato. Impostare come URI di reindirizzamento esatto `https://madnash00.github.io/home-finance/` e usare gli scope `openid email`. In Apps Script aggiungere `GoogleAuth.gs` e le proprietà `HF_GOOGLE_CLIENT_ID`, `HF_GOOGLE_CLIENT_SECRET` e `HF_GOOGLE_OWNER` (indirizzo Gmail del proprietario). Tenere il segreto OAuth solo nelle proprietà dello script. La chiamata al servizio token di Google richiede lo scope `script.external_request`.

Prima di attivare la nuova interfaccia sui dispositivi, completare il primo accesso dal browser già collegato all’archivio. Il backend usa la chiave già conservata dal browser dopo aver verificato sia il profilo Google autorizzato sia la chiave. Il file cifrato esistente rimane l’archivio comune. Gli accessi successivi usano una sessione Home Finance di 30 giorni per browser.
