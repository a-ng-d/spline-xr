// Home: scene form, "Get started" (templates) and "My creations", always the
// three of them, as in Spline AR.
import {
  listWorks, deleteWork, findWorkByScene, onWorksChanged,
  parseSceneId, parseFileId, readScenePath, fileUrlFromId, scenePath,
} from './works.js'
import { t, setText, onLanguageChange, getLanguage } from './i18n.js'

// Templates: public export to play + original file to look at in Spline
export const EXAMPLES = [
  { id: 'h7gKpO9w4utya2UU', t: 'iObeya VR', f: '2120202b-13d1-42f7-8b1b-fc1b5d21ffba' },
  { id: 'mFRY0tOewmI6FvRK', t: 'Minecraft VR', f: '5f421421-186f-481d-a837-d467713b081b' },
]

const $ = id => document.getElementById(id)
function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}
// Element whose text comes from a translation key (re-translated on language switch)
function elKey(tag, cls, key, params) {
  const e = el(tag, cls)
  setText(e, key, params)
  return e
}
function setTitleKey(e, key) {
  e.dataset.i18nTitle = key
  e.title = t(key)
}

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return t('time.now')
  if (s < 3600) return t('time.minutes', { n: Math.round(s / 60) })
  if (s < 86400) return t('time.hours', { n: Math.round(s / 3600) })
  const d = Math.round(s / 86400)
  return d < 30 ? t('time.days', { n: d }) : new Date(ts).toLocaleDateString(getLanguage())
}

// Thumbnail: scene preview (/api/thumb), otherwise an icon
function thumb(id) {
  const box = el('div', 'work-thumb')
  const img = el('img'); img.alt = ''; img.loading = 'lazy'
  img.src = `/api/thumb/${id}`
  img.onerror = () => { box.replaceChildren(); box.textContent = '◆' }
  box.append(img)
  return box
}

function sourceLink(f) {
  const a = el('a', 'btn btn-sm btn-ghost', 'Spline ↗')
  a.href = fileUrlFromId(f); a.target = '_blank'; a.rel = 'noopener'
  setTitleKey(a, 'actions.sourceTitle')
  return a
}

// onPlay(scene, { save, editKey }): starts the scene (provided by main.js)
export function initHome({ onPlay }) {
  const form = $('scene-form'), urlIn = $('url-input'), titleIn = $('title-input'), fileIn = $('file-input')
  const goBtn = $('go-btn'), cancelBtn = $('cancel-edit'), formLabel = $('form-label')
  let editKey = null

  const flag = input => { input.classList.add('error'); setTimeout(() => input.classList.remove('error'), 500) }

  function setEditing(key) {
    editKey = key
    setText(goBtn, key ? 'form.saveAndPlay' : 'form.play')
    setText(formLabel, key ? 'form.edit' : 'form.new')
    cancelBtn.hidden = !key
    drawWorks()
  }

  // Fills the form with a scene (from My creations or an open scene)
  function editScene(scene) {
    urlIn.value = scene.id ? `https://prod.spline.design/${scene.id}/scene.splinecode` : ''
    titleIn.value = scene.t || ''
    fileIn.value = scene.f ? fileUrlFromId(scene.f) : ''
    setEditing(findWorkByScene(scene.id)?.key ?? null)
    form.scrollIntoView({ behavior: 'smooth', block: 'center' })
    titleIn.focus({ preventScroll: true })
  }

  form.addEventListener('submit', e => {
    e.preventDefault()
    const id = parseSceneId(urlIn.value)
    if (!id) return flag(urlIn)
    const fRaw = fileIn.value.trim()
    const f = fRaw ? parseFileId(fRaw) : null
    if (fRaw && !f) return flag(fileIn)
    onPlay({ id, t: titleIn.value, f }, { save: true, editKey })
  })
  cancelBtn.onclick = () => { form.reset(); setEditing(null) }

  // ── Get started ────────────────────────────────────────────────────────────
  for (const ex of EXAMPLES) {
    const row = el('div', 'work')
    const info = el('div', 'work-info')
    info.append(el('div', 'work-title', ex.t), elKey('div', 'work-meta', 'templates.meta'))
    const actions = el('div', 'work-actions')
    const play = elKey('button', 'btn btn-sm btn-primary', 'actions.play')
    play.onclick = () => onPlay(ex, { save: false })
    actions.append(play, sourceLink(ex.f))
    row.append(thumb(ex.id), info, actions)
    $('examples').append(row)
  }

  // ── My creations ───────────────────────────────────────────────────────────
  function drawWorks() {
    const works = listWorks(), box = $('works')
    box.replaceChildren()
    $('count').hidden = !works.length
    $('count').textContent = works.length
    setText($('list-help'), works.length ? 'works.help' : '')
    if (!works.length) {
      box.append(elKey('p', 'help works-empty', 'works.empty'))
      return
    }
    for (const w of works) {
      const s = readScenePath(w.path)
      const current = w.key === editKey
      const row = el('div', 'work' + (current ? ' current' : ''))
      const info = el('div', 'work-info')
      const title = s.t ? el('div', 'work-title', s.t) : elKey('div', 'work-title', 'works.untitled')
      info.append(title, el('div', 'work-meta', `${s.id} · ${timeAgo(w.updatedAt)}`))
      const actions = el('div', 'work-actions')
      const play = elKey('button', 'btn btn-sm btn-primary', 'actions.play')
      play.onclick = () => onPlay(s, { save: true, editKey: w.key })
      const edit = elKey('button', 'btn btn-sm btn-ghost', current ? 'works.editing' : 'actions.edit')
      if (current) edit.classList.add('is-current')
      edit.onclick = () => editScene(s)
      const del = el('button', 'btn btn-sm btn-danger', '✕')
      setTitleKey(del, 'works.delete')
      del.onclick = () => {
        if (!confirm(t('works.confirmDelete', { name: s.t || s.id }))) return
        deleteWork(w.key)
        if (w.key === editKey) { form.reset(); setEditing(null) }
      }
      actions.append(play)
      if (s.f) actions.append(sourceLink(s.f))
      actions.append(edit, del)
      row.append(thumb(s.id), info, actions)
      box.append(row)
    }
  }
  drawWorks()
  onWorksChanged(drawWorks)
  onLanguageChange(drawWorks)   // relative dates ("2 h ago")

  return {
    editScene,
    // After a successful start from the form: clear the form
    resetForm() { form.reset(); setEditing(null) },
    scenePath,
  }
}
