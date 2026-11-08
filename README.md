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

## Accueil

Trois blocs, toujours visibles (même logique que Spline AR) :

- **Nouvelle scène** : URL d'export Spline (obligatoire), titre et lien du fichier Spline (facultatifs).
- **Pour commencer** : les modèles (iObeya VR, Minecraft VR), avec « Jouer » et « Spline ↗ » pour ouvrir la scène d'origine.
- **Mes créations** : les scènes jouées depuis le formulaire, enregistrées dans le navigateur (`src/works.js`), avec Jouer / Spline ↗ / Modifier / Supprimer.

Pas de compte : le lien est la seule source de vérité. Une création = son lien `/s/<id>?t=<titre>&f=<fichier Spline>`. Ouvrir un lien partagé puis « ✎ Modifier » le reprend dans Mes créations, sur n'importe quel appareil.

## Liens partageables

Chaque scène a une adresse : `https://spline-xr.netlify.app/s/<identifiant>`, où l'identifiant est celui de l'URL d'export Spline (`https://prod.spline.design/<identifiant>/scene.splinecode`).

- Coller l'URL d'export dans l'accueil charge la scène et met l'adresse à jour.
- Le bouton **Copier le lien** donne l'adresse à partager.
- Le lien fonctionne sur ordinateur (aperçu) comme dans le casque (bouton VR).
- Le titre (`t`) et le fichier Spline d'origine (`f`) voyagent dans le lien : `/s/<identifiant>?t=Ma%20scène&f=<uuid du fichier>`.
- `?scene=<URL ou identifiant>` est aussi accepté et converti en `/s/<identifiant>`.

Aucune base de données : le lien est l'enregistrement. Il pointe toujours vers la dernière version exportée de la scène dans Spline ; si l'export public est retiré, le lien ne charge plus.

### Aperçu des liens (réseaux sociaux, portfolio)

Partagé sur LinkedIn, Slack, un portfolio…, un lien `/s/<identifiant>` affiche une image de la scène.

- À la première ouverture d'une scène qui n'a pas encore d'aperçu, l'app photographie la vue de départ (1200×630) et l'envoie à `/api/thumb/<identifiant>` (`netlify/functions/thumb.mjs`), qui la range dans Netlify Blobs. Pas de base de données.
- Le bouton 📷 du bandeau remplace l'aperçu par la vue actuelle (hors VR).
- `netlify/edge-functions/og.js` réécrit les balises Open Graph de la page pour chaque lien.
- Sans aperçu, l'image par défaut `public/og-default.jpg` est utilisée.

N'importe qui ouvrant le lien peut remplacer l'aperçu. Les fonctions Netlify ne tournent qu'avec un déploiement depuis le dépôt (pas avec un glisser-déposer du dossier `dist`).

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
