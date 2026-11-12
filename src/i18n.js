// Internationalisation (English / French) with Tolgee.
//
// - Translations live in /locales/<lang>.json (flat keys, ICU-free {param} placeholders,
//   rendered by Tolgee's FormatSimple). They are bundled as static data: no Tolgee server,
//   no API key. The JSON files can later be connected to a Tolgee project for collaborative
//   translation without changing this module.
// - The initial language follows the browser (LanguageDetector), falls back to English, and
//   the visitor's choice is remembered (LanguageStorage).
// - Static HTML is translated through attributes:
//     data-i18n="key"              → textContent
//     data-i18n-html="key"         → innerHTML (trusted strings from our own locale files only)
//     data-i18n-placeholder="key"  → placeholder
//     data-i18n-title="key"        → title
//     data-i18n-aria-label="key"   → aria-label
//     data-i18n-params='{"n":3}'   → parameters for any of the above
//   Dynamic text set with setText() carries the same attributes, so a language switch
//   re-translates everything already on screen.

import { Tolgee, FormatSimple, LanguageDetector, LanguageStorage } from '@tolgee/web'
import en from '../locales/en.json'
import fr from '../locales/fr.json'

export const LANGUAGES = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'fr', label: 'FR', name: 'Français' },
]

export const tolgee = Tolgee()
  .use(FormatSimple())
  .use(LanguageDetector())
  .use(LanguageStorage())
  .init({
    availableLanguages: LANGUAGES.map(l => l.code),
    defaultLanguage: 'en',
    fallbackLanguage: 'en',
    staticData: { en, fr },
  })

/** Translate a key. `params` fills {placeholders}. */
export function t(key, params) {
  return tolgee.t(key, params)
}

/** Pick the "one" or "other" variant of a key: `${base}.one` / `${base}.other`, with {n}. */
export function tn(base, n, params = {}) {
  return t(`${base}.${n === 1 ? 'one' : 'other'}`, { n, ...params })
}

export const getLanguage = () => tolgee.getLanguage() || 'en'

const ATTRS = [
  ['i18n', (el, v) => { el.textContent = v }],
  ['i18nHtml', (el, v) => { el.innerHTML = v }],
  ['i18nPlaceholder', (el, v) => { el.placeholder = v }],
  ['i18nTitle', (el, v) => { el.title = v }],
  ['i18nAriaLabel', (el, v) => { el.setAttribute('aria-label', v) }],
]
const SELECTOR = '[data-i18n],[data-i18n-html],[data-i18n-placeholder],[data-i18n-title],[data-i18n-aria-label]'

function translateElement(el) {
  let params
  try { params = el.dataset.i18nParams ? JSON.parse(el.dataset.i18nParams) : undefined } catch { params = undefined }
  for (const [attr, apply] of ATTRS) {
    const key = el.dataset[attr]
    if (key) apply(el, t(key, params))
  }
}

/** Translate every element carrying data-i18n* attributes under `root`. */
export function translateDom(root = document) {
  if (root.matches?.(SELECTOR)) translateElement(root)
  root.querySelectorAll(SELECTOR).forEach(translateElement)
}

/**
 * Set an element's text from a key and keep it translatable on language switch.
 * An empty key clears the text.
 */
export function setText(el, key, params) {
  if (!el) return
  if (!key) {
    delete el.dataset.i18n
    delete el.dataset.i18nParams
    el.textContent = ''
    return
  }
  el.dataset.i18n = key
  if (params) el.dataset.i18nParams = JSON.stringify(params)
  else delete el.dataset.i18nParams
  translateElement(el)
}

const listeners = new Set()
/** Run `fn` after each language change (re-render dynamic parts not covered by setText). */
export function onLanguageChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function changeLanguage(code) {
  await tolgee.changeLanguage(code)
}

/** Load translations, set <html lang>, translate the page. Call once per page, before rendering. */
export async function initI18n() {
  await tolgee.run()
  const apply = () => {
    document.documentElement.lang = getLanguage()
    translateDom()
    listeners.forEach(fn => fn(getLanguage()))
    document.querySelectorAll('.lang-switch').forEach(updateSwitch)
  }
  tolgee.on('language', apply)
  apply()
}

function updateSwitch(sw) {
  const current = getLanguage()
  sw.querySelectorAll('button').forEach(b => {
    const active = b.dataset.lang === current
    b.classList.toggle('active', active)
    b.setAttribute('aria-pressed', String(active))
  })
}

/** Append an EN | FR switch to `container`. */
export function mountLanguageSwitch(container) {
  if (!container) return
  const sw = document.createElement('div')
  sw.className = 'lang-switch'
  sw.setAttribute('role', 'group')
  sw.dataset.i18nAriaLabel = 'lang.switch'
  for (const lang of LANGUAGES) {
    const b = document.createElement('button')
    b.type = 'button'
    b.dataset.lang = lang.code
    b.textContent = lang.label
    b.title = lang.name
    b.lang = lang.code
    b.onclick = () => changeLanguage(lang.code)
    sw.append(b)
  }
  container.append(sw)
  translateElement(sw)
  updateSwitch(sw)
}
