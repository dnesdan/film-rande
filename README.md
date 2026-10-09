# Film Rande 🍿 — soukromý filmový selector pro dva

Samostatná webová aplikace v jediném souboru (`index.html`). Filmová data **nejsou součástí souboru**: po připojení se načítají online z TMDb API, včetně dostupnosti v českém katalogu Netflixu / HBO Maxu z dat JustWatch.

## Spuštění

1. Otevři `index.html` v moderním webovém prohlížeči.
2. Získej si TMDb API v3 klíč (nebo API Read Access Token) na https://www.themoviedb.org/settings/api — pro osobní nekomerční použití zdarma.
3. Vlož klíč do aplikace. Klíč se nikam mimo TMDb neodesílá. Bez zatrženého uložení je uchováván pouze pro aktuální relaci prohlížeče (pokud relace storage není dostupná, platí pouze pro otevřenou stránku).
4. Vyber streamovací služby, žánr/náladu a další filtry. Spusť hlasování nebo rychlý tip.

Pokud konkrétní prohlížeč omezuje přímé otevření místního HTML, spusť jednoduchý lokální server ve složce s `index.html`:

```bash
python3 -m http.server 8000
```

Pak otevři http://localhost:8000 .

## Na telefonu přes běžný odkaz

Projekt obsahuje jen statické `index.html`. Můžeš jej nasadit na GitHub Pages, Netlify nebo jiné statické HTTPS hostování (bez buildu). **API klíč nevkládej do publikovaného zdrojového kódu** — aplikace se na něj každého uživatele zeptá v prohlížeči.

## Co funguje

- Živé vyhledání Netflixu a HBO Maxu v seznamu poskytovatelů TMDb pro Česko (provider ID nejsou fixní v kódu).
- Aktuální filmy a seriály v předplatném, nikoli půjčovném, ze serverového vyhledávání TMDb (`watch_region=CZ`, `flatrate`).
- Nálady a žánry, rok vydání, délka, minimální hodnocení.
- Soukromé hlasování ve dvou průchodech: Ne / Možná / Jo. Ukáže společné shody.
- Rychlý náhodný tip, další várka, samostatné hledání titulu.
- Detail se skutečnou dostupností pro ČR a odkazem „kde sledovat“.

## Omezení

Dostupnost pochází z TMDb / JustWatch, **nikoli přímo z API Netflixu nebo HBO Maxu**. Aktualizace se může zpozdit. Nejde o garantovaný přímý odkaz do konkrétní streamovací aplikace. Češtinu dabingu/titulků aplikace neověřuje. Vždy si před spuštěním ověř dostupnost v cílové službě.

Data a obrázky: © příslušní vlastníci; metadata a plakáty pomocí [TMDb](https://www.themoviedb.org), streamovací dostupnost pomocí [JustWatch](https://www.justwatch.com/cz).

This product uses the TMDB API but is not endorsed or certified by TMDB.