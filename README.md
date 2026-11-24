# Nordiske Megleranbefalinger & Porteføljestyring (`rolldan/aksjer`)

Oversiktlig nettside og automatisert oppdateringsløsning for megleranbefalinger, kursmål og porteføljeforslag på Oslo Børs og i Norden, tilpasset reglene **maks 15 % i én enkeltaksje** og **maks 30 % i én enkeltsektor**.

## Innhold i repoet

- `index.html`, `css/styles.css`, `js/app.js`: Responsiv nettside på norsk med:
  - Filtrering på 10 nordiske meglerhus (**Pareto Securities**, **DNB Carnegie**, **ABG Sundal Collier**, **Arctic Securities**, **SB1 Markets**, **SEB**, **Fearnley Securities**, **Clarksons Securities**, **Nordea**, **Danske Bank**).
  - Filtrering på anbefaling (**KJØP**, **HOLD**, **SELG**) og **I porteføljen (16 aktive)** vs. **Nye kandidater**.
  - Sortering på porteføljevekt, snitt oppside til kursmål, høyeste kursmål og antall kjøpsanbefalinger.
  - Eget panel for **Porteføljegrep (15 % / 30 %-reglene)** med konkret rebalanseringsplan (Steg 1–3) og sektorbalanse før og etter grep.
  - Eget panel for **Modellporteføljer** (Paretos månedsportefølje og DNB Carnegies ukesportefølje) og automatisk nyhetsstrøm.
- `data/recommendations.json`: Strukturert datasett med alle verifiserte kursmål, datoer, kilder, porteføljevekter og rebalanseringsforslag.
- `scripts/fetch_recommendations.py`: Python-skript (kun standardbibliotek) som henter nye anbefalings- og kursmålnyheter fra Google News RSS (Finans Norge/Sverige) og E24 Børs og Finans RSS, og oppdaterer `data/recommendations.json`.
- `.github/workflows/update-recommendations.yml`: GitHub Actions-workflow som kjører automatisk 3 ganger daglig på hverdager (kl. 08:30, 12:30 og 16:45 CET) samt ved `workflow_dispatch`, committer oppdatert JSON og publiserer nettsiden til GitHub Pages.

## Lokal kjøring og oppdatering

1. **Oppdater nyhetsstrømmen fra RSS:**
   ```bash
   python3 scripts/fetch_recommendations.py
   ```
2. **Start lokal webserver for å se nettsiden:**
   ```bash
   python3 -m http.server 8000 --bind 127.0.0.1
   ```
   Åpne deretter `http://127.0.0.1:8000` i nettleseren.

## Aktivering av GitHub Pages

1. Gå til **Settings → Pages** i GitHub-repoet (`rolldan/aksjer`).
2. Under **Build and deployment → Source**, velg **GitHub Actions**.
3. Kjør workflowen **Oppdater Megleranbefalinger & Publiser GitHub Pages** under **Actions**-fanen (eller vent på neste planlagte kjøring).
