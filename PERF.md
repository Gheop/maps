# Bilan performance (2026-09-08)

Cible définie en phase 0 : le temps jusqu'à la carte affichée, du point de vue d'un visiteur sur réseau mobile (latence 100 ms), et le coût de chaque visite pour le serveur et les fournisseurs de tuiles. Le serveur Go n'était pas un goulot (7 µs par requête de shell, 4 µs par géocodage en cache, pod limité à 10 millicœurs) : il n'a été touché que pour les validateurs HTTP.

Métrique principale : démarrage de la carte (première tuile insérée dans `#map`) sous latence émulée. Garde-fous : octets et requêtes par visite, RSS du serveur, compteurs de style/layout et durée de script sur un scénario pan/zoom (12 pans, 12 crans de zoom).

## 1. Bilan

| Métrique | Avant (bea16a4) | Après | Δ |
|---|---|---|---|
| Rechargement à chaud : octets sur le fil | 52,7 Ko (12 × 200) | 2,4 Ko (11 × 304) | -95 % |
| Rechargement à chaud : corps transférés | 49,9 Ko | 0 | -100 % |
| Démarrage carte, latence 100 ms, à froid | 456 ms | 347 ms | -24 % |
| Démarrage carte, latence 100 ms, à chaud | 423 ms | 319 ms | -25 % |
| Requêtes de tuiles au chargement (harnais, tuiles bloquées) | 232 | 219 | -13 |
| `ab` /js/map.js avec `If-None-Match`, req/s | 48 450 | 93 110 | +92 % |
| `ab` /js/map.js sans validateur, req/s | 47 829 | 49 895 | +4 % (bruit) |
| RSS max serveur | 21,0 Mo | 21,2 Mo | +1 % |
| Pan/zoom : `RecalcStyleCount` | 393 | 385 | -2 % (bruit) |
| Pan/zoom : `ScriptDuration` | 112 ms | 106 ms | -5 % (bruit) |
| Chargement à froid, octets | 52,7 Ko | 54,2 Ko | +2,8 % (commentaires + `modulepreload`, avant Brotli) |

Le poids brut du shell à froid n'a pas bougé : la source n'est pas minifiée (choix du projet) et nginx la sert déjà en Brotli.

## 2. Ce qui a payé

1. **ETag par contenu + `Cache-Control: no-cache` sur les assets embarqués** (`static.go`). `embed.FS` n'a pas de date de modification, donc `http.FileServer` n'émettait aucun validateur et chaque visite retéléchargeait tout. Un SHA-256 tronqué par fichier, calculé au démarrage, suffit : le binaire est immuable.
2. **`modulepreload` des 9 modules ES** (`web/index.html`). Le graphe de modules était découvert en cascade sur 3 niveaux ; les préchargements partent tous dès l'index. Gain mesuré : un aller-retour en HTTP/1.1 (limite de 6 connexions par hôte du harnais local), deux attendus derrière nginx en HTTP/2.
3. **Vue du hash posée avant le premier rendu** (`web/js/map.js`). `initMap` rendait le zoom 2 sur le coin du monde avant de lire le hash, puis jetait ces tuiles : 13 requêtes de tuiles inutiles par visite, dont 12 vers OpenStreetMap.

## 3. Ce qui n'a pas payé (ou n'a pas été tenté, et pourquoi)

- **Compression côté Go** : nginx sert déjà `content-encoding: br` en prod (vérifié sur maps.gheop.com). Gain nul, code en plus.
- **Optimiser `render()` et le pan/zoom** : le profil CPU (`bench/profile.py`) attribue 2 % des échantillons au JavaScript sur le scénario d'interaction, dont 1 % à `render`. Le reste est natif (style, peinture, décodage des tuiles). Les micro-gains possibles (ne pas réécrire `left/top` des tuiles inchangées, ne pas rafraîchir la barre de zoom à chaque rendu) sont sous le bruit de 5 à 10 % des durées.
- **Serveur Go (parsing Photon, LRU)** : 51 µs et 0,2 µs par opération, face à un appel amont de 110 ms. Code froid, non touché.
- **Minifier JS/CSS** : exclu par la consigne du projet (source lisible versionnée), et sans intérêt derrière Brotli.

## 4. Plafond atteint

- **Démarrage** : il reste 2 allers-retours incompressibles sans build (index, puis modules + CSS). Aller plus loin demanderait d'inliner `main.js` ou de bundler, c'est-à-dire une toolchain que le projet refuse.
- **Revisites** : 12 requêtes de revalidation subsistent (des 304). Les supprimer demande soit des URL versionnées avec `immutable` (build), soit un Service Worker en stale-while-revalidate pour le shell. Ce second point est un changement de comportement (la version précédente serait servie une fois après une mise à jour) : le SW actuel est volontairement en network-first, décision à prendre séparément.
- **Interaction** : le thread principal est dominé par la peinture et le décodage des tuiles, inhérents à une carte DOM/`<img>`. Le pas suivant serait un rendu canvas ou WebGL, autre projet.
- **Prod** : `index.html` préconnecte 4 hôtes de tuiles alors qu'un seul sert le calque courant. Non mesurable dans le harnais (tuiles bloquées) ; à tester en conditions réelles avant d'y toucher.

## 5. Reproduire

Machine au repos (pas de lecteur vidéo, pas de jeu, pas de build en fond), gouverneur `performance`. Le harnais s'épingle sur les P-cores 0-11.

```bash
bench/run.sh <label> 10          # benchs Go + ab + front (Playwright), -> bench/results/<label>.json
bench/compare.py <a> <b>         # tableau comparatif de deux résultats
bench/profile.py http://127.0.0.1:18080   # profil CPU du scénario pan/zoom (serveur à lancer soi-même)
go test -run xxx -bench . -benchmem -count 10 .   # benchs Go seuls
```

Prérequis : Go, `ab` (apache-tools), Python 3 avec `playwright` et son Chromium.

Deux artefacts du harnais à connaître : le tout premier Chromium lancé par un processus met parfois 2 s de plus à démarrer la carte (un run à froid > 1,5 s est refait, champ `retries`), et l'interception `context.route()` de Playwright désactive le cache HTTP, d'où la mesure de charge sans interception (tuiles bloquées via CDP).

## 6. Surveiller

À jouer en CI ou avant chaque release, seuils d'alerte :

| Vérification | Commande | Seuil |
|---|---|---|
| Revalidation | `go test -run xxx -bench ShellRevalidate -benchmem .` | `304s/load` < 15 ou `bodyBytes/load` > 0 → régression |
| Test fonctionnel des validateurs | `go test -run TestStaticETagRevalidation .` | doit passer |
| Octets à chaud | `bench/front.py` (`warm.wire_bytes`) | > 5 Ko → régression |
| Requêtes de tuiles au chargement | `bench/front.py` (`cold.tile_requests`) | > 225 → un rendu jeté est revenu |
| Démarrage carte | `bench/front.py` (`warm.map_init_ms`, latence 100 ms) | > 360 ms → un aller-retour est revenu |
| Coût pan/zoom | `bench/front.py` (`RecalcStyleCount`, `LayoutCount`) | +20 % → régression de rendu |
