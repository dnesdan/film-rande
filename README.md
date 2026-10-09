# Film Rande

Minimalistický výběr filmu pro jednoho i pro dva. Černé pozadí, bílá typografie, červený akcent a živý katalog Netflixu / HBO Maxu pro Česko. Bez frameworku, buildu, externích fontů a analytiky.

**Web:** https://dnesdan.github.io/film-rande/

## Začni s TMDb

Otevři web a vlož vlastní TMDb API v3 klíč nebo API Read Access Token z https://www.themoviedb.org/settings/api . Přihlašovací údaje k Netflixu ani HBO nejsou potřeba. Vyber služby, náladu a režim. Žánr, rok, stopáž a minimální hodnocení jsou pod **Upřesnit výběr**.

- **Ve dvou:** dva skryté průchody až 16 tituly. Druhý člověk dostane jiné pořadí a nevidí první hlasy. Zamítnutí kteréhokoli člověka titul vyřadí ze shod. Fungují tlačítka, šipky, klávesy 1/2/3 a dotykové gesto na kartě.
- **Pro jednoho:** katalog s plakáty nebo podrobným seznamem, postupné načítání dalších stran, doporučený tip s vysvětlením a řazení podle doporučení, hodnocení, popularity, novinek nebo názvu. Hledání v tomto režimu prohledává načtené tituly; globální hledání je v hlavičce.
- **Rychlý tip:** jeden kandidát po druhém, bez hlasování.

Doporučení vychází z tvých filtrů a z kombinace hodnocení, počtu hlasů a popularity načtených filmů. Počet hlasů tlumí extrémy s malým vzorkem. Nejde o přístup k historii Netflixu nebo osobní model. Doporučené a abecední pořadí se počítá nad načteným výběrem; hodnocení, popularita a novinky se řadí i na straně TMDb.

## Český / slovenský dabing a původní zvuk

**Samotný TMDb klíč nestačí pro zvukové stopy.** TMDb / JustWatch poskytuje nabídku služeb; `original_language`, `spoken_languages`, překlad názvu ani titulky nedokazují dabing na konkrétní službě.

V hlavičce otevři **Dabing**, vlož vlastní klíč pro **Streaming Availability API v4** a dej **Ověřit a připojit**. Zvol správný původ klíče:

- Přímo [Movie of the Night](https://developers.movieofthenight.com/) — požadavky jdou na `https://api.movieofthenight.com/v4` s hlavičkou `X-API-Key`.
- Alternativně RapidAPI, produkt Streaming Availability v4 — požadavky jdou na `https://streaming-availability.p.rapidapi.com` s hlavičkou `X-RapidAPI-Key`.

Stačí jeden z těchto dvou zdrojů. Klíč nepatří do kódu ani do repozitáře. Nastavení a ověření zdroje je oddělené od TMDb, takže katalog bez jazykového filtru funguje i bez tohoto druhého klíče.

Filtry **Český zvuk**, **Slovenský zvuk** a **Český nebo slovenský zvuk** fungují v katalogu, párovém hlasování i rychlém tipu. Údaj je z `streamingOptions.cz[].audios`, pouze z předplatného a konkrétních vybraných služeb. Český zvuk na HBO Max tak nesplní filtr Netflixu. Nákup, půjčení, doplňkové kanály, nabídka pro Slovensko a titulky se nepočítají.

Na kartách a v detailu jsou údaje rozlišené po službách. **CZ/SK zvuk zahrnuje dabing i původní český/slovenský zvuk.** Chybějící údaj je „neověřeno“, nikoli „dabing neexistuje“; neověřené tituly striktním filtrem neprocházejí. U seriálů jde o údaj pro seriál, jednotlivé řady a epizody mohou mít jiné stopy. Aktualizace zdroje se mohou opozdit; před přehráním ověř konkrétní stopu ve službě.

### Spotřeba API

Ověřování titulů čerpá kvótu tvého API tarifu. Bez klíče se zvuk neověřuje. S klíčem a bez jazykového filtru se ověřují viditelné karty / otevřený detail. Striktní filtr prověřuje kandidáty před zobrazením. Nejde o stažení celého katalogu naráz:

- Nejvýše tři souběžné požadavky; při vyčerpané kvótě se dotazy pozastaví.
- Jeden krok načte stránku TMDb, při nulové jazykové shodě nanejvýš dvě stránky. Další procházení spouštíš tlačítkem.
- Zvukové údaje mají mezipaměť v relaci na nejvýše šest hodin / 120 titulů. Klíče nejsou součástí této datové mezipaměti. Nabídky po uvedeném vypršení platnosti se nepoužívají.
- Náhled plakátů se při jazykovém filtru nenačítá automaticky, aby změna každého filtru nespotřebovávala kvótu. Ověřování lze v sólo režimu zastavit.

## Struktura a vývoj

`index.html` obsahuje obrazovky; `app.css` Cinema vzhled; `app.js` TMDb, náhledy a hlasování; `audio.js` klienta a normalizaci zvukových stop; `catalog.js` katalog pro jednoho a propojení zvuku; `catalog.css` navazující styly.

Všechny produkční soubory musí být ve stejné složce. Pro spuštění není potřeba npm:

```bash
python3 -m http.server 8000
# Otevři http://localhost:8000
node --check app.js
node --check audio.js
node --check catalog.js
node --test tests/audio.test.cjs
```

Volitelný integrační test potřebuje Python, Playwright a Chromium:

```bash
python3 -m pip install playwright
python3 -m playwright install chromium
python3 tests/browser_smoke.py
# Případně nastav CHROMIUM_PATH na vlastní Chromium.
```

Test používá skutečné produkční skripty, syntetické odpovědi API, testovací plakáty a simulovaná úložiště v prázdné stránce. Nevyžaduje klíče ani síť. Artefakty zapisuje do `tests/artifacts` nebo `TEST_OUTPUT`.

Ověřeno: 17 jednotkových testů zvukového klienta; prohlížečový průchod sólo katalogem, stránkováním, řazením, vyhledáváním, oběma hlasy, výsledky, rychlým tipem, seriály, detailním zvukem, CZ/SK filtry, odpojením, zrušenými požadavky, chybami 401/429 a prázdným katalogem. Testy kontrolují i mobilní rozložení. **Neověřují skutečnou nabídku služeb, skutečnou platnost uživatelových klíčů ani provozní CORS odpovědi externích API.** Testovací tituly a klíče nejsou v produkčních souborech.

GitHub Pages publikuje kořen větve `main`. Verze odkazů na CSS/JS je `cinema-2`; při úpravách ji zvyš pro obnovení cache.

## Soukromí a omezení

TMDb klíč odchází pouze TMDb; zvukový klíč jen zvolenému Movie of the Night nebo RapidAPI. Bez zapamatování jsou klíče v `sessionStorage`, se zapamatováním v `localStorage`; při nedostupném úložišti jen v paměti. **Odpojit** v hlavičce odstraní oba klíče. Zdroj zvuku lze odpojit také samostatně. Uložení v prohlížeči není šifrovaný trezor: používej vlastní zařízení. Projekt nemá sdílený serverový klíč ani účet.

Hlasy existují pouze v paměti stránky. Soukromí znamená skryté volby v rozhraní na jednom zařízení, ne oddělené účty, šifrované hlasování nebo synchronizaci telefonů. Obnovení stránky hlasování zahodí.

Filmy, žánry, plakáty i číselná ID poskytovatelů se načítají živě z TMDb. Zůstává regionální fallback a omezení `watch_region=CZ`, `with_watch_monetization_types=flatrate`. Nabídka ani překlady nejsou garantovaně úplné či okamžitě aktuální. Odkaz z TMDb je přehled nabídek; přímý odkaz na službu může dodat zdroj zvuku.

Metadata a plakáty: [TMDb](https://www.themoviedb.org). Nabídka: [JustWatch](https://www.justwatch.com/cz). Zvuk: [Streaming Availability API](https://www.movieofthenight.com/about/api), [dokumentace autentizace](https://docs.movieofthenight.com/guide/authentication), [oficiální schéma](https://github.com/movieofthenight/streaming-availability-api/blob/main/openapi.yaml). Data a značky patří příslušným vlastníkům; respektuj podmínky poskytovatelů a svého API tarifu.

This product uses the TMDB API but is not endorsed or certified by TMDB. Projekt není spojený s Netflixem ani HBO Max.
