# SplineXR

Jouer des scènes [Spline](https://spline.design) en VR sur Meta Quest via WebXR.

La scène est chargée avec `@splinetool/loader` (Three.js) et rendue par un `WebGLRenderer` avec XR activé. Les interactions Spline (MouseHover, MouseDown, MouseUp, MousePress, Start) sont rejouées à partir du raycast des manettes ou du pincement en hand tracking.

## Démarrage

```bash
npm install
npm run dev      # serveur local Vite
npm run build    # build dans dist/
```

En local, le proxy `/spline-proxy/*` n'existe pas : il est fourni par Netlify (`netlify.toml`). Utiliser `netlify dev` pour le reproduire.

## Contrôles VR

| Entrée | Action |
|---|---|
| Rayon (manette ou main) | Survol Spline (MouseHover) + curseur |
| Gâchette ou pincement sur un objet | Clic Spline (MouseDown / MouseUp / MousePress) |
| Toucher un objet du bout de l'index | Clic Spline (poke) |
| Gâchette ou pincement dans le vide, ou bouton grip | Saisir la scène et la déplacer |
| Saisie à deux mains, écarter / rapprocher | Agrandir / réduire la scène |
| Joystick gauche | Déplacement |
| Joystick droit ← → | Rotation par crans |
| Joystick droit ↑ | Téléportation (relâcher) |
| Bouton Reset | Remet la scène et le point de vue à l'état initial |

Les mains utilisent le rayon système de Meta (`targetRaySpace`) et le pincement natif WebXR (`selectstart` / `selectend`).

## Échelle

Les scènes Spline sont exprimées en « pixels ». Par défaut, 1 unité Spline = 1 mm : une carte de 300 unités mesure 30 cm et la caméra Spline se retrouve à portée de bras, ce qui rend le poke possible. Les yeux sont placés à la position de la caméra Spline.

Ajuster avec `?scale=` (mètres par unité), par exemple `?scale=0.002` pour doubler la taille. La saisie à deux mains permet aussi de redimensionner en direct.

## Audio

Les actions Audio de Spline (play / pause / stop, volume, boucle, délai) sont jouées via le lecteur Howler embarqué dans le loader. La musique d'un événement Start démarre au chargement de la scène.

## Debug

Ajouter `?debug` à l'URL pour afficher le HUD (sources d'entrée, cible visée, survols, poke, saisie, échelle) et les logs `[SplineXR]` dans la console.

## Déploiement

Netlify, build `npm run build`, dossier publié `dist/`.
