# Gheop Maps

Un clone de Google Maps ultra-léger : carte glissante en vanilla JS (zéro dépendance, aucun build), tuiles OpenStreetMap, et un petit proxy Go pour la recherche et les itinéraires. C'est la reprise modernisée d'un projet de 2009.

En ligne : **https://maps.gheop.com/**

![Gheop Maps](assets/screenshot.png)

Pour qui : ceux qui veulent une carte web qui démarre vite, tient dans un seul binaire et se déploie sans toolchain front.

## Fonctions

- 5 calques : Plan (OSM), Satellite (Esri), Relief (OpenTopoMap), Toner et Aquarelle (Stadia/Stamen)
- Recherche de lieu (Photon) et calcul d'itinéraire (OSRM)
- Géolocalisation
- Permalien `#calque/zoom/lat/lon` dans l'URL (calque inclus, donc partageable et conservé au rafraîchissement)
- Comblage des tuiles manquantes par la tuile parente dézoomée
- Minimap régionale, échelle, pyramide de zoom cliquable
- Double-clic pour zoomer (shift pour dézoomer)
- Fonctionne hors-ligne et revisites instantanées (Service Worker)

## Installation

Prérequis : Go 1.23+.

```bash
go build -o maps .
./maps
```

Le binaire embarque tout le front (`//go:embed web`), donc rien d'autre à servir. Par défaut il écoute sur `:8080` ; surcharger avec la variable `PORT`.

```bash
PORT=3000 ./maps
```

## Utilisation

Ouvrir http://localhost:8080. Le front parle au proxy via deux routes :

- `GET /api/geocode?q=...&lat=&lon=` → recherche Photon, biais position optionnel (mise en cache)
- `GET /api/route?from=...&to=...` → itinéraire OSRM
- `GET /healthz` → sonde de vivacité

Les tuiles sont chargées directement depuis les fournisseurs côté navigateur. Stadia (Toner, Aquarelle) utilise l'auth par domaine (`*.gheop.com`), aucune clé n'est embarquée.

## Stack

- Front : ES modules vanilla, modèle de tuiles centré sur le viewport (coordonnées du centre en pixels monde), projection Web Mercator
- Back : `net/http` stdlib, cache LRU borné, image distroless statique
- Déploiement : k3s (voir `deploy/README.md`)

## Licence

MIT, voir [LICENSE](LICENSE).

## Changelog

### v1.2.3 — Recherche via Photon (2026-06-21)

- Le géocodage passe de Nominatim à Photon (Komoot) : recherche ~110 ms au lieu de 1 à 8 s, et plus de throttling. Le proxy normalise la réponse au format attendu, biais vers la zone affichée
- Réponse Photon (GeoJSON) convertie côté serveur, donc aucun changement de contrat pour le front

### v1.2.2 — Recherche et itinéraire (2026-06-21)

- Cache mémoire des géocodages : une recherche déjà faite ne refait aucune requête réseau (instantanée)
- Simplification de la polyline d'itinéraire (Douglas-Peucker) : un trajet longue distance passe de plusieurs milliers de points à environ un millier, tracé identique mais bien moins de calculs au rendu

### v1.2.1 — Pinch fluide (2026-06-21)

- Le pinch sur mobile fait un zoom en direct (scale `transform`) pendant le geste, comme la molette, et commit le niveau au lever des doigts ; le pan reprend avec le doigt restant

### v1.2.0 — Déplacement et zoom à fond (2026-06-21)

- Déplacement par `transform: translate3d` (compositeur GPU) au lieu d'un re-rendu complet à chaque frame ; re-tuilage seulement par paliers
- Zoom : préchargement des tuiles du niveau visé pendant le scroll, commit raccourci à 90 ms, insertion groupée (`DocumentFragment`). Le gel du thread principal au zoom passe d'environ 215 ms à moins de 30 ms
- Anneau de tuiles préchargé au repos et dans le sens du déplacement : plus de tuile blanche au pan
- Service Worker : tuiles en cache (revisites instantanées), app servie hors-ligne
- Double-clic pour zoomer (shift = dézoom)
- Suppression du reflow forcé par frame, `fetchpriority`, écouteurs passifs, `will-change`

### v1.1.0 — Comblage des tuiles et calque dans l'URL (2026-06-20)

- Le calque est inscrit dans le permalien (`#calque/zoom/lat/lon`) : il survit au rafraîchissement et part avec un lien copié. Les vieux liens `#zoom/lat/lon` restent valides (calque par défaut : Plan)
- Les tuiles absentes (204 du fournisseur, throttling) sont comblées par la tuile parente (zoom-1) mise à l'échelle, en fond CSS et de façon asynchrone, sans ralentir l'affichage du reste
- Aquarelle remonte à un zoom max de 15 (les trous en zone rurale sont comblés par la z14, complète)
- Correction d'une bordure noire autour des tuiles comblées sous Firefox (pixel transparent au lieu d'un `src` vidé)
- Vérification des zooms max par calque : Plan 19, Satellite 19, Relief 17, Toner 20, Aquarelle 15
- Au changement de calque, dézoom automatique sur le max du nouveau calque en gardant le centre

### v1.0.0 — Reprise moderne (2026-06-20)

- Réécriture du moteur de carte en vanilla JS, modèle centré sur le viewport (corrige le gris et la dérive au-delà du zoom 17)
- Proxy Go en binaire statique unique, front embarqué, cache des géocodages
- Recherche, calques, géolocalisation, itinéraire
- Barre de recherche repliable translucide, sélecteur de calques repliable avec vignettes, favicon carte + épingle
- Migration sur le k3s de gheop.com
