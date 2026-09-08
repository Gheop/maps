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
