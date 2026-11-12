// "My creations" (from Spline AR): scenes saved in the browser.
//
// The share link is the single source of truth: a creation = the path of its
// link, /s/<id>?t=<title>&f=<Spline file>. Everything else is derived from it.
// No account: creations stay in this browser. The link itself is the backup:
// opening it then "Edit" brings it back into My creations.

const KEY = 'spline-xr-creations'
const LEGACY_KEY = 'spline-xr-v2-scenes'   // former "My scenes" list (URLs)

export const SCENE_ID_RE = /^[A-Za-z0-9_-]{6,64}$/
const FILE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TITLE_MAX = 80

export const sceneUrlFromId = id => `https://prod.spline.design/${id}/scene.splinecode`
export const fileUrlFromId = f => `https://app.spline.design/file/${f}`

// Accepts: Spline prod URL, the app's /s/<id> link, or a bare ID
export function parseSceneId(input) {
  const s = (input || '').trim()
  const m = s.match(/prod\.spline\.design\/([A-Za-z0-9_-]+)/) || s.match(/\/s\/([A-Za-z0-9_-]+)/)
  const id = m ? m[1] : s
  return SCENE_ID_RE.test(id) ? id : null
}

// Accepts: app.spline.design/file/<uuid> link or the bare uuid
export function parseFileId(input) {
  const s = (input || '').trim()
  const m = s.match(/spline\.design\/file\/([0-9a-f-]{36})/i)
  const f = m ? m[1] : s
  return FILE_ID_RE.test(f) ? f.toLowerCase() : null
}

const cleanTitle = t => (t || '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX)

// { id, t, f } → /s/<id>?t=…&f=…
export function scenePath({ id, t, f }) {
  const q = new URLSearchParams()
  if (cleanTitle(t)) q.set('t', cleanTitle(t))
  if (f) q.set('f', f)
  const qs = q.toString()
  return `/s/${id}${qs ? '?' + qs : ''}`
}

// Path or full URL → { id, t, f } (null if invalid)
export function readScenePath(pathOrUrl) {
  let u
  try { u = new URL(pathOrUrl, location.origin) } catch { return null }
  const m = u.pathname.match(/^\/s\/([A-Za-z0-9_-]+)\/?$/)
  const id = m ? m[1] : parseSceneId(u.searchParams.get('scene'))
  if (!id || !SCENE_ID_RE.test(id)) return null
  return { id, t: cleanTitle(u.searchParams.get('t')), f: parseFileId(u.searchParams.get('f')) }
}

// ── Stockage ─────────────────────────────────────────────────────────────────
function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]').filter(w => w && readScenePath(w.path))
  } catch { return [] }
}
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {}
  window.dispatchEvent(new CustomEvent('works-changed'))
}
const newKey = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const sceneOf = w => readScenePath(w.path)?.id

// Migrates the former "My scenes" list (once)
;(function migrateLegacy() {
  let legacy
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null') } catch { return }
  if (!Array.isArray(legacy)) return
  const list = read(), now = Date.now()
  legacy.forEach((url, i) => {
    const id = parseSceneId(url)
    if (id && !list.some(w => sceneOf(w) === id)) {
      list.push({ key: newKey() + i, path: scenePath({ id }), createdAt: now - i, updatedAt: now - i })
    }
  })
  try { localStorage.removeItem(LEGACY_KEY) } catch {}
  write(list)
})()

export function listWorks() {
  return read().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function findWorkByScene(id) {
  return read().find(w => sceneOf(w) === id) || null
}

// Creates or updates; one creation per Spline scene. Returns the key.
export function saveWork({ key, scene }) {
  const path = scenePath(scene)
  const now = Date.now()
  let list = read()
  let work = key && list.find(w => w.key === key)
  // Another creation already points to this scene: merge them
  const twin = list.find(w => sceneOf(w) === scene.id && w !== work)
  if (twin) {
    if (work) list = list.filter(w => w !== twin)
    else work = twin
  }
  if (work) {
    if (work.path === path && !twin) { work.updatedAt = now; write(list); return work.key }
    work.path = path
    work.updatedAt = now
  } else {
    work = { key: newKey(), path, createdAt: now, updatedAt: now }
    list.push(work)
  }
  write(list)
  return work.key
}

export function deleteWork(key) {
  write(read().filter(w => w.key !== key))
}

// Sync between tabs
export function onWorksChanged(fn) {
  window.addEventListener('works-changed', fn)
  window.addEventListener('storage', e => { if (e.key === KEY) fn() })
}
