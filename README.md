# Nordiske Megleranbefalinger, Børsmeldinger & Porteføljestyring (`rolldan/aksjer`)

**Live nettside:** [https://rolldan.github.io/aksjer/](https://rolldan.github.io/aksjer/)

Oversiktlig nettside og automatisert oppdateringsløsning for megleranbefalinger, kursmål, børsmeldinger fra Oslo Børs (NewsWeb) og porteføljestyring, tilpasset reglene **maks 15 % i én enkeltaksje** og **maks 30 % i én enkeltsektor**.

## Funksjoner

1. **Aktuell daglig porteføljeverdi og time-for-time-oppdatering:**
   - `.github/workflows/update-recommendations.yml` kjører **hver time** (`cron: "5 * * * *"`) hele uken og oppdaterer aksjekurser og valutakurser (`NOK`, `SEK`, `DKK`, `EUR`), total porteføljeverdi i NOK, dagens endring i NOK og %, urealisert gevinst/tap, porteføljevekter og oppside til kursmål.
   - Daglig verdiutvikling logges automatisk i `daily_values` og vises under fanen **Porteføljegrep & Daglig verdi**.
2. **Siste børsmeldinger fra Oslo Børs (NewsWeb):**
   - Egen fane **Børsmeldinger (Oslo Børs)** som henter meldinger direkte fra Oslo Børs NewsWeb API.
   - Filtrer på **Kun mine porteføljeaksjer**, **Mine aksjer + kandidataksjer**, **Kun kandidataksjer** eller **Øvrige selskaper på Oslo Børs**, samt kategorifilter for **Meldepliktig handel (Innsidehandel)**, **Resultat- og kvartalsrapporter**, **Flagging / Kapitalendringer** og **Kontrakter / øvrige børsmeldinger**.
3. **Manuell oppdatering av aksjelisten direkte på nettsiden:**
   - Under fanen **Rediger aksjeliste / Portefølje** kan du endre antall aksjer, GAV (snittkurs), kurs, sektor og kontantbeløp, legge til nye aksjer, fjerne aksjer eller hurtigimportere linjer (`TICKER ANTALL GAV`).
   - Endringer lagres umiddelbart i nettleserens `localStorage` og kan også lagres permanent tilbake til GitHub-repoet (`rolldan/aksjer`) med et GitHub Personal Access Token eller lastes ned som JSON.
4. **Megleranbefalinger og kursmål:**
   - Filtrering på 10 nordiske meglerhus (**Pareto Securities**, **DNB Carnegie**, **ABG Sundal Collier**, **Arctic Securities**, **SB1 Markets**, **SEB**, **Fearnley Securities**, **Clarksons Securities**, **Nordea**, **Danske Bank**), anbefaling (`KJØP`, `HOLD`, `SELG`) og porteføljestatus.
