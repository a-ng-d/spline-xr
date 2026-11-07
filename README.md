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
| Gâchette ou pincement pouce-index | Clic Spline (MouseDown / MouseUp / MousePress) |
| Joystick gauche | Déplacement |
| Joystick droit ← → | Rotation par crans |
| Joystick droit ↑ | Téléportation (relâcher) |

Les mains utilisent le rayon système de Meta (`targetRaySpace`) et le pincement natif WebXR (`selectstart` / `selectend`).

## Audio

Les actions Audio de Spline (play / pause / stop, volume, boucle, délai) sont jouées via le lecteur Howler embarqué dans le loader. La musique d'un événement Start démarre au chargement de la scène.

## Debug

Ajouter `?debug` à l'URL pour afficher le HUD (sources d'entrée, cible visée, survols) et les logs `[SplineXR]` dans la console.

## Déploiement

Netlify, build `npm run build`, dossier publié `dist/`.
