# SplineXR

**Play your Spline scenes in VR on a Meta Quest headset — in the browser, with a simple link.**

[Live site](https://spline-xr.netlify.app) · [Français](README.fr.md) · [Contributing](CONTRIBUTING.md)

SplineXR is an open-source WebXR tool made for design students. No app to install, no code, no Node.js for the people who use it: design a scene in [Spline](https://spline.design), paste its export link, get a link to share. The same link opens on a computer (mouse preview) and in a Meta Quest headset (immersive VR, with controllers or hand tracking).

- **No headset**: the scene runs in the official Spline runtime — exact rendering, animations, states, sounds and mouse interactions.
- **Headset detected**: the scene runs in a home-made WebXR engine that replays Spline interactions with the controllers' ray, the trigger, pinching or a fingertip touch.

It is the twin of [Spline AR](https://github.com/a-ng-d/spline-ar) (the same idea, in augmented reality on phones).

The interface is available in **English and French**. The browser language is used by default; a switch (EN | FR) changes it, and the choice is remembered.

## How it works

| Layer | Technology |
|---|---|
| Preview without a headset | Official runtime `@splinetool/runtime` (pinned `2.0.151`), loaded on demand |
| VR | `@splinetool/loader` (scene graph only) + three.js (`super-three`) + native WebXR |
| Spline interactions in VR | Home-made event runner (`src/main.js`) and animation engine (`src/animate.js`) |
| Hosting | Netlify: static site, a proxy for the Spline CDN, a Function + Blobs for link preview images, an Edge Function for preview tags |
| Interface language | [Tolgee](https://tolgee.io) (`@tolgee/web`) with JSON files in `locales/` |

The Spline runtime cannot run in VR: Spline removed the WebXR module from its bundled three.js (`setSession` throws "WebXR is not supported by the Spline runtime"). Hence the two engines. Force one with `?mode=spline` or `?mode=vr`.

## Home page

Three blocks, always visible (same logic as Spline AR):

- **New scene**: Spline export URL (required), title and Spline file link (optional).
- **Get started**: templates (iObeya VR, Minecraft VR) with "Play" and "Spline ↗" to open the original file in the Spline editor.
- **My creations**: scenes played from the form, saved in the browser (`localStorage`, key `spline-xr-creations`, `src/works.js`), with Play / Spline ↗ / Edit / Delete.

No account: **the link is the single source of truth**. A creation is its link `/s/<id>?t=<title>&f=<Spline file>`. Opening a shared link then "✎ Edit" brings it back into My creations, on any device.

## Shareable links

```
https://spline-xr.netlify.app/s/<id>?t=<title>&f=<Spline file uuid>
```

| Part | Role |
|---|---|
| `<id>` | ID of the Spline export URL `https://prod.spline.design/<id>/scene.splinecode` |
| `t` | optional title (tab, share bar, link preview), 80 characters max |
| `f` | optional uuid of the original file (`app.spline.design/file/<uuid>`), shown as "Spline ↗" |

- Pasting an export URL on the home page loads the scene and updates the address.
- The share bar shows the link with a **Copy** button.
- `?scene=<URL or ID>` is also accepted and converted to `/s/<id>`.
- Options: `debug` (HUD + console logs), `scale=<metres per Spline unit>` (default `0.001`), `mode=spline` / `mode=vr`.

No database: the link always points to the latest exported version of the scene in Spline; if the public export is removed, the link no longer loads.

### Link previews (social networks, portfolios)

Shared on LinkedIn, Slack or a portfolio, a `/s/<id>` link shows a picture of the scene.

- The first time a scene without a preview is opened (outside VR), the app captures the initial view (1200×630) and sends it to `/api/thumb/<id>` (`netlify/functions/thumb.mjs`), which stores it in Netlify Blobs.
- The 📷 button of the share bar replaces the preview with the current view.
- `netlify/edge-functions/og.js` rewrites the Open Graph tags for each link, in English or French depending on `Accept-Language`.
- Without a preview, `public/og-default.jpg` (or `og-default-fr.jpg`) is used.

Anyone opening the link can replace its preview (there are no accounts).

## VR controls

| Input | Action |
|---|---|
| Ray (controller or hand) | Spline hover (MouseHover) + cursor |
| Trigger or pinch on an object | Spline click (MouseDown / MouseUp / MousePress) |
| Touching an object with the index fingertip | Spline click (poke) |
| Trigger or pinch in empty space, or grip button | Grab and move the scene |
| Two-hand grab, hands apart / together | Scale the scene up / down |
| Left thumbstick | Move |
| Right thumbstick ← → | Snap turn |
| Right thumbstick ↑ | Teleport (on release) |
| Reset button | Puts the scene and the viewpoint back |

Hands use Meta's system ray (`targetRaySpace`) and the native WebXR pinch (`selectstart` / `selectend`).

**Scale**: Spline scenes are expressed in "pixels". By default 1 Spline unit = 1 mm: a 300-unit card is 30 cm wide and the Spline camera ends up within arm's reach, which makes poking possible. The eyes are placed at the Spline camera.

## Compatibility of the VR engine

The home-made engine (`src/animate.js`) reuses the easings, units and schedules of the `@splinetool/runtime` 2.0.151 code.

| Spline feature | Spline runtime (no headset) | VR engine |
|---|---|---|
| Geometry, materials, lights | ✅ | ✅ (loader rendering, small differences possible) |
| Post-processing (bloom, depth of field, vignette…) | ✅ | ❌ |
| Hover, click (down / up / press) and Start events | ✅ | ✅ ray, trigger, pinch, poke |
| Transition to a state | ✅ | ✅ animated: duration, delay, 9 easings (including spring and bezier), steps, repeat, ping-pong. Position, rotation, scale, colours and opacity are interpolated; a shape size changes at once |
| Audio (play / pause / stop) | ✅ | ✅ |
| Open a link | ✅ | ✅ |
| Condition (if / else) | ✅ | ✅ expressions with variables, object properties, comparisons, and / or / not (no API, webhook or AI) |
| Set Variable action, Variable Change event | ✅ | ✅ |
| Timeline (play / pause / stop) | ✅ | ⚠️ position, rotation, scale tracks (faithful) and opacity (approximate); material, shape size, light, camera and cloner tracks ignored |
| Animations of imported models | ✅ | ❌ |
| Distance and State events | ✅ | ❌ |
| Keyboard, scroll, drag and drop | ✅ | ❌ |
| Look At / Follow | ✅ | ❌ |
| Physics, collisions | ✅ | ❌ |
| Game controls, scene transitions, create / destroy objects | ✅ | ❌ |
| Particles, video, text inputs, API / AI | ✅ | ❓ untested |
| Spline camera (orbit, zoom) | ✅ | Replaced by VR locomotion; the Spline camera gives the starting point |

In practice, a scene designed for VR should rely on hover, click, state changes, sounds and simple timelines.

## Translations

- Strings live in `locales/en.json` and `locales/fr.json` (nested keys, same structure in both files). English is the fallback.
- `src/i18n.js` (shared with Spline AR) sets up Tolgee (`FormatSimple` for `{param}` placeholders, `LanguageDetector` for the browser language, `LanguageStorage` to remember the choice) and exposes `t()`, `setText()` and `mountLanguageSwitch()`.
- In HTML: `data-i18n="key"` (text), `data-i18n-html` (text with markup), `data-i18n-placeholder`, `data-i18n-title`, `data-i18n-aria-label`. Everything is re-translated when the language changes, without reloading.
- Link previews (`netlify/edge-functions/og.js`) follow the `Accept-Language` header.

Adding a language: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

```bash
npm install
npx netlify dev   # site + Spline proxy + Functions + Blobs
npm run build     # → dist/
```

`npm run dev` (Vite alone) works for the interface, but scenes need the Spline proxy: use `netlify dev`. WebXR needs HTTPS on the headset; use the Netlify deploy previews or a tunnel. On a computer, the [Immersive Web Emulator](https://chromewebstore.google.com/detail/immersive-web-emulator/cgffilbpcibhmcfbgggfhfolhkfbhmik) extension makes the browser behave like a headset (VR engine).

Deployment: a Netlify site linked to the repository, build `npm run build`, publish directory `dist/` (settings in `netlify.toml`).

## Known limits

- The Spline CDN sends no CORS headers: proxy `/spline-proxy/*` (`netlify.toml`).
- `@splinetool/loader` is older than Spline's current timeline format: timelines may not be found in some scenes (`?debug` lists them).
- The preview without a headset relies on undocumented runtime internals for capturing images: `@splinetool/runtime` is pinned.
- `PUT /api/thumb/<id>` is open (no account): images are limited to 500 KB JPEG.

## Attributions

SplineXR stands on the work of others. Thank you to them.

| Component | Use | License |
|---|---|---|
| [Spline](https://spline.design) runtime and loader (`@splinetool/runtime`, `@splinetool/loader`) | Preview without a headset, loading scenes for VR (the loader ships [howler.js](https://howlerjs.com) for audio) | Published on npm by Spline; use subject to Spline's terms of service ([spline.design](https://spline.design)) |
| [three.js](https://threejs.org) via [`super-three`](https://www.npmjs.com/package/super-three) | WebXR rendering, controllers, hand tracking | MIT |
| [Tolgee](https://github.com/tolgee/tolgee-js) (`@tolgee/web`) | Interface translation | BSD-3-Clause |
| [Netlify Blobs](https://github.com/netlify/blobs) (`@netlify/blobs`) and [`@netlify/functions`](https://github.com/netlify/primitives) | Storage of link preview images, cache purge | MIT |
| [Vite](https://vitejs.dev) | Build | MIT |
| [DM Sans](https://fonts.google.com/specimen/DM+Sans) via Google Fonts | Typeface | SIL Open Font License 1.1 |
| [Spline AR](https://github.com/a-ng-d/spline-ar) | "My creations" principle, `src/i18n.js` | Same author |

"Spline" is a trademark of Spline Design Inc.; "Meta Quest" is a trademark of Meta Platforms, Inc. This project is independent and **not affiliated with, endorsed or sponsored by** Spline or Meta.

## License

The code of this repository is released under the [MIT License](LICENSE). Third-party components keep their own licenses (see above).
