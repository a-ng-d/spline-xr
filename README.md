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
| Joystick gauche | Déplacement |
| Joystick droit ← → | Rotation par crans |
| Joystick droit ↑ | Téléportation (relâcher) |
| Gâchette | Clic Spline (MouseDown / MouseUp / MousePress) |
| Ray droit | MouseHover |
| Pincement (main droite) | Clic Spline |

## Déploiement

Netlify, build `npm run build`, dossier publié `dist/`.
