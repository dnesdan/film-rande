# Film Rande

Minimalistický filmový selector pro večer ve dvou. Černé pozadí, bílá typografie, červený akcent a skutečné plakáty. Bez frameworku, buildu, externích fontů a analytiky.

**Web:** https://dnesdan.github.io/film-rande/

## Spuštění

Otevři web, vlož vlastní TMDb API v3 klíč nebo API Read Access Token a vyber Netflix / HBO Max, náladu a způsob výběru. Klíč získáš v nastavení svého účtu: https://www.themoviedb.org/settings/api . Přihlašovací údaje k Netflixu ani HBO nejsou potřeba.

Filtry stopáže, žánru, hodnocení a roku jsou pod **Upřesnit výběr**. Náhled plakátů reaguje na zvolené filtry; nejde o předem připravený seznam titulů. Přepnutí na seriály mění katalog i popisek stopáže.

**Hlasování ve dvou:** každý postupně ohodnotí až 16 titulů jako Ne / Možná / Ano. Druhý člověk nevidí první hlasy a dostane jiné pořadí. Do shod se dostanou pouze filmy, u kterých nikdo nedal Ne. K dispozici je také rychlý tip, další výběr a hledání konkrétního titulu.

Na počítači lze hlasovat šipkami vlevo / nahoru / vpravo nebo klávesami 1 / 2 / 3. Na dotykovém zařízení fungují tlačítka i vodorovné gesto na filmové kartě.

## Struktura a lokální vývoj

- `index.html` — obrazovky a dialogy.
- `app.css` — responzivní Cinema vzhled.
- `app.js` — připojení TMDb, filtry, živé náhledy a hlasování.

Všechny tři soubory musí být ve stejné složce. Nejsou potřeba npm balíčky ani sestavení:

```bash
python3 -m http.server 8000
# otevři http://localhost:8000
node --check app.js
```

GitHub Pages používá obsah větve `main` v kořenové složce. CSS a JavaScript mají verzované odkazy; při změně souborů zvyš `?v=cinema-1` v HTML nebo při vývoji proveď tvrdé obnovení stránky.

## Data a soukromí

Filmy, žánry, plakáty i ID poskytovatelů se načítají online z TMDb. Netflix a HBO Max se identifikují dynamicky. Regionální vyhledávání má zachovaný fallback přes globální seznam, český seznam a ověření českého předplatného pomocí discover. Výběr používá `watch_region=CZ` a `with_watch_monetization_types=flatrate`.

API klíč nikdy nepatří do repozitáře. Aplikace jej posílá pouze TMDb. Bez volby zapamatování jej ukládá do `sessionStorage`, s ní do `localStorage`; při nedostupném úložišti zůstává jen v paměti otevřené stránky. **Odpojit** odstraní uložený klíč z obou úložišť. Nejde o trezor pro tajné údaje; používej vlastní prohlížeč a nepřidávej do aplikace nedůvěryhodné skripty.

Hlasy existují pouze v paměti stránky. Soukromé hlasování znamená skryté volby v rozhraní na jednom zařízení, ne oddělené účty, šifrované hlasovací lístky ani synchronizaci dvou telefonů. Obnovení stránky rozpracované hlasování zahodí.

## Ověření redesignu

Rozhraní bylo otestováno v Chromium na syntetických API odpovědích v šířkách 360, 390, 540, 768, 820, 1024 a 1440 px. Kontroly pokryly připojení, náhled a změny filtrů, oba hlasovací průchody, vyloučení zamítnutých filmů, výsledky, rychlý režim, seriály, hledání, prázdný katalog, chybu 401 a regionální fallback. JavaScript prošel `node --check` a prohlížeč nehlásil chyby skriptu.

Tyto testy neověřují skutečnou nabídku služeb ani platnost uživatelova API klíče. V testovacím prostředí bylo úložiště simulované. Testovací plakáty, tituly ani přístupové údaje nejsou součástí produkčních souborů.

## Omezení a zdroje

Dostupnost je z TMDb / JustWatch, nikoli z přímého API Netflixu či HBO Maxu. Změny katalogů se mohou projevit se zpožděním. Dabing a titulky aplikace neověřuje; před přehráním zkontroluj cílovou službu. Odkaz na přehled nabídek není zaručený přímý odkaz do přehrávače.

Metadata a plakáty: [TMDb](https://www.themoviedb.org). Dostupnost: [JustWatch](https://www.justwatch.com/cz). Data, obrázky a značky náleží příslušným vlastníkům. Projekt není spojený s Netflixem ani HBO Max.

This product uses the TMDB API but is not endorsed or certified by TMDB.
