# Contributing to SplineXR

Thank you for wanting to help! SplineXR is a small tool made for design students, so the guiding rule is: **it must stay simple for the people who use it**. No account, no install, no code on their side — a Spline link in, a link to share out.

Contributions are welcome in English or French (issues, pull requests, discussions).

## Ways to help

- **Report a bug** — open an issue with the link that fails, the device (Meta Quest model, computer) and browser, and what you expected. Say whether it happened in VR or in the preview without a headset.
- **Suggest an idea** — open an issue first, so we can agree on the approach before you write code.
- **Translate** — fix a wording, or add a language (see below).
- **Write code** — pick an issue, say in a comment that you are on it, then open a pull request.
- **Share a template** — a Spline scene that shows off what works well in VR.

## Getting started

```bash
git clone https://github.com/a-ng-d/spline-xr.git
cd spline-xr
npm install
npx netlify dev     # site + Spline proxy + Functions + Blobs
npm run build       # must pass before you open a pull request
```

WebXR needs HTTPS: test in a headset with a Netlify deploy preview (opened automatically on pull requests) or a tunnel. On a computer, the [Immersive Web Emulator](https://chromewebstore.google.com/detail/immersive-web-emulator/cgffilbpcibhmcfbgggfhfolhkfbhmik) extension runs the VR engine; without it you get the Spline runtime preview. Add `?debug` to the address for the HUD and console logs, `?mode=vr` or `?mode=spline` to force an engine.

## Project layout

```
index.html                    the single page (home, loading screen, HUD, share bar)
src/
  main.js                     engine selection, WebXR rendering, input, Spline event runner, share bar
  animate.js                  easings, animated state transitions, expressions, timelines
  spline-preview.js           preview without a headset (official Spline runtime)
  home.js                     home page: form, "Get started", "My creations"
  works.js                    link format (read / write) and "My creations" storage (localStorage)
  i18n.js                     Tolgee setup and DOM translation helpers (shared with Spline AR)
locales/en.json, fr.json      interface strings
netlify/functions/thumb.mjs   link preview images (Netlify Blobs)
netlify/edge-functions/og.js  link preview tags (Open Graph), EN / FR
public/                       default preview images
```

## Conventions

- **Code in English**: identifiers, comments, file names, commit messages.
- **No user-facing text in the code**: every string goes through a key in `locales/*.json` (`t('key')` or `setText(el, 'key')` in JS, `data-i18n="key"` in HTML). Add the key to **both** files, with the same structure. Debug logs (`?debug`) stay in English and are not translated.
- **Do not break existing links.** The `/s/<id>` route, the `t`, `f`, `scene`, `debug`, `scale` and `mode` parameters, the `spline-xr-creations` `localStorage` key and the `/api/thumb/<id>` endpoint are shared by students and stored in their browsers. Keep them, or add a backward-compatible reader.
- **Keep the link as the single source of truth** for a creation: no server-side database.
- **Pinned dependencies**: `@splinetool/runtime` (`2.0.151`) and `@splinetool/loader` (`1.12.81`) are pinned because the code relies on undocumented internals (loader entity states, runtime canvas). Upgrade them only in a dedicated pull request, tested in a headset with an interactive, animated scene. `src/animate.js` reproduces values from that runtime version: check them again after an upgrade.
- **VR engine changes**: describe which Spline features you tested (hover, click, transitions, conditions, timelines, audio) and with which input (controllers, hands).
- Style: plain ES modules, no framework, no TypeScript, 2-space indentation, no semicolons — follow the surrounding code.

## Translations

Strings live in `locales/<lang>.json` as nested keys. Placeholders use `{name}` (Tolgee `FormatSimple`).

To **add a language**:

1. Copy `locales/en.json` to `locales/<code>.json` and translate the values (keep the keys and the `{placeholders}`; keep HTML tags in values that have them).
2. In `src/i18n.js`, import the file, add it to `staticData` and `availableLanguages`, and add an entry to `LANGUAGES`.
3. In `netlify/edge-functions/og.js`, add the language to `STRINGS` (and a `public/og-default-<code>.jpg` image if you like, handled in `netlify/functions/thumb.mjs`).
4. Run `npm run build` and check the home page, the share bar and the HUD with the switch.

## Pull requests

- One topic per pull request, with a short description of what changes for students.
- Explain how you tested it (headset or emulator, browser, controllers and/or hands, preview without a headset).
- Screenshots or a short video for visual changes.
- `npm run build` passes.
- Translations updated in every `locales/*.json` file.

## Code of conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By taking part, you agree to respect it.

## License

By contributing, you agree that your contributions are released under the [MIT License](LICENSE) of the project.
