# Journal d'optimisation

Harnais : `bench/run.sh <label> [runs]` (voir PERF.md pour le détail). Métriques :

- livraison du shell : requêtes et octets sur le fil à chaud (Chrome headless, cache HTTP actif, tuiles et API bloquées), déterministe ;
- serveur : benchs Go (`ns/op`, `B/op`, `allocs/op`), débit `ab` (32 connexions keep-alive), RSS max ;
- front : compteurs Chrome `RecalcStyleCount` / `LayoutCount` (déterministes) et durées `ScriptDuration` / `RecalcStyleDuration` (bruitées à ~20 %) sur 12 pans + 12 crans de zoom, tuiles mockées.

Un gain sur une durée n'est retenu que s'il dépasse l'écart-type mesuré ; les compteurs et les octets sont comparés tels quels.

## Réglages du harnais (non-optimisations, mais à ne pas refaire)

| Problème | Cause | Correction |
|---|---|---|
| Écart-type 30 à 85 % sur tout | machine pas au repos (mpv, node tsx d'un autre projet, gouverneur powersave), cœurs P/E mélangés | épinglage `taskset -c 0-11`, mode performance, aucune appli lourde en fond ; `ab` entrelacé ×3 |
| 0 × 304 au rechargement côté navigateur malgré l'ETag | `context.route()` de Playwright désactive le cache HTTP de Chrome | tuiles et API bloquées via CDP `Network.setBlockedURLs` pour la mesure de charge ; interception gardée seulement pour le scénario d'interaction |
| dérive des durées au fil des runs (105 → 156 ms) | vieillissement du processus navigateur partagé | navigateur neuf par run, run 0 = warmup exclu |

## Itérations

| # | Hypothèse | Fichiers | Résultat | Δ métrique | Δ RAM | Verdict |
|---|-----------|----------|----------|-----------|-------|---------|
| 1 | `embed.FS` n'a pas de date de modification, donc `http.FileServer` n'émet ni `Last-Modified` ni `ETag` : chaque visite retélécharge les 12 fichiers du shell (50 Ko). Un ETag par contenu calculé au démarrage + `Cache-Control: no-cache` doit transformer les revisites en 304 sans corps. nginx fait déjà le Brotli en prod, donc pas de compression côté Go. | `static.go`, `server.go`, `server_test.go` | Rechargement à chaud : 11 × 304, 2,4 Ko sur le fil au lieu de 53 Ko (-95 %), 0 octet de corps. Bench Go `ShellRevalidate` : 15 × 304, B/op 143 → 92 Ko. `ab` avec `If-None-Match` : +75 % req/s. Coût : une passe SHA-256 sur 100 Ko au démarrage. | -95 % octets à chaud | +3 % RSS (0,6 Mo) | Retenu |
| 2 | `initMap` appelait `resize()` (donc `render()` au zoom 2 sur le coin du monde) avant de lire le hash, puis `setView` jetait ces tuiles. Poser la vue du hash avant le premier rendu doit supprimer ces requêtes de tuiles sans changer l'affichage. | `web/js/map.js` | Tuiles demandées au chargement à froid : 232 → 219 (-13 sur 10 runs, sd 1 %). Rendu identique (48 tuiles, hash honoré), `buildZoomBar` appelé une fois au lieu de deux. Réel en prod : 13 requêtes OSM de moins par visite. | -13 requêtes de tuiles / visite | 0 | Retenu |
| 3 | Les 9 modules ES sont découverts en cascade (index → main → map/search/route/geo/autocomplete → tilemath/url/geocode) : 3 allers-retours avant que `main.js` s'exécute. `<link rel="modulepreload">` sur les 9 modules doit les faire partir en parallèle dès l'index. | `web/index.html` | Démarrage de la carte à 100 ms de latence émulée : 426 → 319 ms à chaud (sd 1 %), 459 → 347 ms à froid (médiane, runs perturbés par l'artefact de 1er Chromium). Un seul aller-retour gagné au lieu de deux : le serveur local est en HTTP/1.1 (6 connexions par hôte, 10 fichiers → 2 vagues) ; en prod nginx parle HTTP/2, le gain attendu est de 2 allers-retours. +639 octets d'index avant Brotli. | -107 ms (-25 %) démarrage carte | 0 | Retenu |
| 4 | Flash gris au zoom : les tuiles floues de l'ancien niveau étaient jetées après 1 s quoi qu'il arrive, à l'instant où la dernière nette *commence* son fondu, et d'un bloc au commit suivant. Garder chaque floue jusqu'à ce que les nettes qui la recouvrent soient chargées et fondues, la garder aussi d'un commit à l'autre (≤ 4 niveaux d'écart), filet de sécurité à 6 s. | `web/js/map.js` | `bench/flash.py` (tuiles à 1,5 s, zoom +2) : écran gris 96,9 % entre 1,1 et 1,3 s → 0 % à tous les instants. Floues retirées à 2 s dans tous les scénarios (zoom, dézoom −3, deux zooms rapprochés, zoom + pan). Première version : +50 % de script (taille réécrite sur les 48 nettes à chaque rendu) → taille écrite au seul changement de zoom, nettoyage sauté sans floue : script +12 % (sd 14 %, bruit), RecalcStyleCount −10 %, LayoutCount −17 %. | flash 96,9 % → 0 % | +0,1 Mo heap, +150 nœuds transitoires | Retenu |
