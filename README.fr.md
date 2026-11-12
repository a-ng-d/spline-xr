# SplineXR

**Joue tes scènes Spline en VR dans un casque Meta Quest — dans le navigateur, avec un simple lien.**

[Site en ligne](https://spline-xr.netlify.app) · [English](README.md) · [Contribuer](CONTRIBUTING.md)

SplineXR est un outil WebXR open source pensé pour des étudiants en design. Pas d'appli à installer, pas de code, pas de Node.js pour celles et ceux qui l'utilisent : on crée une scène dans [Spline](https://spline.design), on colle son lien d'export, on obtient un lien à partager. Le même lien s'ouvre sur ordinateur (aperçu à la souris) et dans un casque Meta Quest (VR immersive, avec les manettes ou les mains).

- **Sans casque** : la scène tourne dans le runtime officiel de Spline — rendu, animations, états, sons et interactions à la souris exacts.
- **Casque détecté** : la scène tourne dans un moteur WebXR maison qui rejoue les interactions Spline avec le rayon des manettes, la gâchette, le pincement ou le toucher du bout du doigt.

C'est le jumeau de [Spline AR](https://github.com/a-ng-d/spline-ar) (la même idée, en réalité augmentée sur téléphone).

L'interface existe en **anglais et en français**. La langue du navigateur est utilisée par défaut ; un sélecteur (EN | FR) permet d'en changer, et le choix est mémorisé.

## Fonctionnement

| Couche | Technologie |
|---|---|
| Aperçu sans casque | Runtime officiel `@splinetool/runtime` (figé en `2.0.151`), chargé à la demande |
| VR | `@splinetool/loader` (graphe de scène seul) + three.js (`super-three`) + WebXR natif |
| Interactions Spline en VR | Exécution maison des événements (`src/main.js`) et moteur d'animation (`src/animate.js`) |
| Hébergement | Netlify : site statique, proxy vers le CDN Spline, une Function + Blobs pour les images d'aperçu, une Edge Function pour les balises d'aperçu |
| Langue de l'interface | [Tolgee](https://tolgee.io) (`@tolgee/web`) avec des fichiers JSON dans `locales/` |

Le runtime Spline ne peut pas tourner en VR : Spline a retiré le module WebXR de son three.js embarqué (`setSession` lève « WebXR is not supported by the Spline runtime »). D'où les deux moteurs. Forcer l'un ou l'autre : `?mode=spline` ou `?mode=vr`.

## Accueil

Trois blocs, toujours visibles (même logique que Spline AR) :

- **Nouvelle scène** : URL d'export Spline (obligatoire), titre et lien du fichier Spline (facultatifs).
- **Pour commencer** : les modèles (iObeya VR, Minecraft VR), avec « Jouer » et « Spline ↗ » pour ouvrir le fichier d'origine dans l'éditeur Spline.
- **Mes créations** : les scènes jouées depuis le formulaire, enregistrées dans le navigateur (`localStorage`, clé `spline-xr-creations`, `src/works.js`), avec Jouer / Spline ↗ / Modifier / Supprimer.

Pas de compte : **le lien est la seule source de vérité**. Une création, c'est son lien `/s/<id>?t=<titre>&f=<fichier Spline>`. Ouvrir un lien partagé puis « ✎ Modifier » le reprend dans Mes créations, sur n'importe quel appareil.

## Liens partageables

```
https://spline-xr.netlify.app/s/<id>?t=<titre>&f=<uuid du fichier Spline>
```

| Élément | Rôle |
|---|---|
| `<id>` | Identifiant de l'URL d'export Spline `https://prod.spline.design/<id>/scene.splinecode` |
| `t` | titre facultatif (onglet, bandeau, aperçu du lien), 80 caractères max |
| `f` | uuid facultatif du fichier d'origine (`app.spline.design/file/<uuid>`), affiché en « Spline ↗ » |

- Coller une URL d'export dans l'accueil charge la scène et met l'adresse à jour.
- Le bandeau du lien l'affiche avec un bouton **Copier**.
- `?scene=<URL ou identifiant>` est aussi accepté et converti en `/s/<id>`.
- Options : `debug` (HUD + journaux console), `scale=<mètres par unité Spline>` (défaut `0.001`), `mode=spline` / `mode=vr`.

Pas de base de données : le lien pointe toujours vers la dernière version exportée de la scène dans Spline ; si l'export public est retiré, le lien ne charge plus.

### Aperçu des liens (réseaux sociaux, portfolio)

Partagé sur LinkedIn, Slack ou un portfolio, un lien `/s/<id>` affiche une image de la scène.

- À la première ouverture d'une scène sans aperçu (hors VR), l'app photographie la vue de départ (1200×630) et l'envoie à `/api/thumb/<id>` (`netlify/functions/thumb.mjs`), qui la range dans Netlify Blobs.
- Le bouton 📷 du bandeau remplace l'aperçu par la vue actuelle.
- `netlify/edge-functions/og.js` réécrit les balises Open Graph de chaque lien, en anglais ou en français selon `Accept-Language`.
- Sans aperçu, `public/og-default.jpg` (ou `og-default-fr.jpg`) est utilisée.

N'importe qui ouvrant le lien peut remplacer son aperçu (il n'y a pas de comptes).

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
| Joystick droit ↑ | Téléportation (au relâchement) |
| Bouton Recentrer | Remet la scène et le point de vue en place |

Les mains utilisent le rayon système de Meta (`targetRaySpace`) et le pincement natif WebXR (`selectstart` / `selectend`).

**Échelle** : les scènes Spline sont exprimées en « pixels ». Par défaut, 1 unité Spline = 1 mm : une carte de 300 unités mesure 30 cm et la caméra Spline se retrouve à portée de bras, ce qui rend le poke possible. Les yeux sont placés à la position de la caméra Spline.

## Compatibilité du moteur VR

Le moteur maison (`src/animate.js`) reprend les courbes, unités et calendriers du code de `@splinetool/runtime` 2.0.151.

| Élément Spline | Runtime Spline (sans casque) | Moteur VR |
|---|---|---|
| Géométrie, matériaux, lumières | ✅ | ✅ (rendu du loader, légères différences possibles) |
| Post-effets (bloom, profondeur de champ, vignette…) | ✅ | ❌ |
| Événements survol, clic (down / up / press) et Start | ✅ | ✅ rayon, gâchette, pincement, poke |
| Transition vers un état | ✅ | ✅ animée : durée, délai, 9 courbes (dont ressort et bézier), étapes, répétition, aller-retour. Position, rotation, échelle, couleurs et opacité interpolées ; une taille de forme change d'un coup |
| Audio (play / pause / stop) | ✅ | ✅ |
| Ouvrir un lien | ✅ | ✅ |
| Condition (si / sinon) | ✅ | ✅ expressions avec variables, propriétés d'objets, comparaisons, and / or / not (sans API, webhook ni IA) |
| Action Variable, événement Changement de variable | ✅ | ✅ |
| Timeline (play / pause / stop) | ✅ | ⚠️ pistes position, rotation, échelle (fidèles) et opacité (approchée) ; matériau, taille de forme, lumière, caméra et cloner ignorés |
| Animations des modèles importés | ✅ | ❌ |
| Événements Distance et État | ✅ | ❌ |
| Clavier, scroll, glisser-déposer | ✅ | ❌ |
| Look At / Follow | ✅ | ❌ |
| Physique, collisions | ✅ | ❌ |
| Contrôles de jeu, changement de scène, création / destruction d'objets | ✅ | ❌ |
| Particules, vidéo, champs de texte, API / IA | ✅ | ❓ non testé |
| Caméra Spline (orbite, zoom) | ✅ | Remplacée par la locomotion VR ; la caméra Spline donne le point de départ |

En pratique, une scène pensée pour la VR s'appuie sur le survol, le clic, les changements d'état, les sons et des timelines simples.

## Traductions

- Les textes sont dans `locales/en.json` et `locales/fr.json` (clés imbriquées, même structure dans les deux fichiers). L'anglais sert de repli.
- `src/i18n.js` (partagé avec Spline AR) configure Tolgee (`FormatSimple` pour les `{paramètres}`, `LanguageDetector` pour la langue du navigateur, `LanguageStorage` pour mémoriser le choix) et expose `t()`, `setText()` et `mountLanguageSwitch()`.
- En HTML : `data-i18n="clé"` (texte), `data-i18n-html` (texte avec balises), `data-i18n-placeholder`, `data-i18n-title`, `data-i18n-aria-label`. Tout est retraduit au changement de langue, sans rechargement.
- Les aperçus de liens (`netlify/edge-functions/og.js`) suivent l'en-tête `Accept-Language`.

Ajouter une langue : voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Développement

```bash
npm install
npx netlify dev   # site + proxy Spline + Functions + Blobs
npm run build     # → dist/
```

`npm run dev` (Vite seul) suffit pour l'interface, mais les scènes ont besoin du proxy Spline : utiliser `netlify dev`. Le WebXR exige HTTPS dans le casque ; utiliser les aperçus de déploiement Netlify ou un tunnel. Sur ordinateur, l'extension [Immersive Web Emulator](https://chromewebstore.google.com/detail/immersive-web-emulator/cgffilbpcibhmcfbgggfhfolhkfbhmik) fait passer le navigateur pour un casque (moteur VR).

Déploiement : un site Netlify relié au dépôt, build `npm run build`, dossier publié `dist/` (réglages dans `netlify.toml`).

## Limites connues

- Le CDN Spline n'envoie pas d'en-têtes CORS : proxy `/spline-proxy/*` (`netlify.toml`).
- `@splinetool/loader` est plus ancien que le format actuel des timelines de Spline : certaines scènes peuvent ne pas exposer leurs timelines (`?debug` les liste).
- L'aperçu sans casque s'appuie sur des détails internes non documentés du runtime pour la capture d'image : `@splinetool/runtime` est figé.
- `PUT /api/thumb/<id>` est ouvert (pas de compte) : images limitées à 500 Ko en JPEG.

## Attributions

Voir la section [Attributions du README anglais](README.md#attributions) : Spline (runtime et loader, avec howler.js), three.js via `super-three`, Tolgee, Netlify Blobs et Functions, Vite, DM Sans, Spline AR.

« Spline » est une marque de Spline Design Inc. ; « Meta Quest » est une marque de Meta Platforms, Inc. Ce projet est indépendant et **n'est ni affilié, ni approuvé, ni sponsorisé** par Spline ou Meta.

## Licence

Le code de ce dépôt est publié sous [licence MIT](LICENSE). Les composants tiers gardent leurs propres licences.
