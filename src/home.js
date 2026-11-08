// Accueil : formulaire de scène, « Pour commencer » (modèles) et « Mes créations »,
// toujours les trois, comme dans Spline AR.
import {
  listWorks, deleteWork, findWorkByScene, onWorksChanged, timeAgo,
  parseSceneId, parseFileId, readScenePath, fileUrlFromId, scenePath,
} from './works.js'

// Modèles : export public à jouer + fichier d'origine à consulter dans Spline
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

// Vignette : aperçu de la scène (/api/thumb), sinon pictogramme
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
  a.title = 'Voir la scène d\'origine dans Spline'
  return a
}

// onPlay(scene, { save, editKey }) : lance la scène (fourni par main.js)
export function initHome({ onPlay }) {
  const form = $('scene-form'), urlIn = $('url-input'), titleIn = $('title-input'), fileIn = $('file-input')
  const goBtn = $('go-btn'), cancelBtn = $('cancel-edit'), formLabel = $('form-label')
  let editKey = null

  const flag = input => { input.classList.add('error'); setTimeout(() => input.classList.remove('error'), 500) }

  function setEditing(key) {
    editKey = key
    goBtn.textContent = key ? 'Enregistrer et jouer →' : 'Jouer la scène →'
    formLabel.textContent = key ? 'Modifier ma scène' : 'Nouvelle scène'
    cancelBtn.hidden = !key
    drawWorks()
  }

  // Remplit le formulaire avec une scène (depuis Mes créations ou une scène ouverte)
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

  // ── Pour commencer ─────────────────────────────────────────────────────────
  for (const ex of EXAMPLES) {
    const row = el('div', 'work')
    const info = el('div', 'work-info')
    info.append(el('div', 'work-title', ex.t), el('div', 'work-meta', 'Modèle · interactions et audio'))
    const actions = el('div', 'work-actions')
    const play = el('button', 'btn btn-sm btn-primary', '▶ Jouer')
    play.onclick = () => onPlay(ex, { save: false })
    actions.append(play, sourceLink(ex.f))
    row.append(thumb(ex.id), info, actions)
    $('examples').append(row)
  }

  // ── Mes créations ──────────────────────────────────────────────────────────
  function drawWorks() {
    const works = listWorks(), box = $('works')
    box.replaceChildren()
    $('count').hidden = !works.length
    $('count').textContent = works.length
    $('list-help').textContent = works.length
      ? 'Enregistrées dans ce navigateur. Le lien d\'une scène sert aussi de sauvegarde : ouvre-le, puis « Modifier ».'
      : ''
    if (!works.length) {
      box.append(el('p', 'help works-empty',
        'Rien pour l\'instant. Colle l\'URL d\'export d\'une scène Spline ci-dessus : elle apparaîtra ici avec son lien.'))
      return
    }
    for (const w of works) {
      const s = readScenePath(w.path)
      const row = el('div', 'work' + (w.key === editKey ? ' current' : ''))
      const info = el('div', 'work-info')
      info.append(el('div', 'work-title', s.t || 'Scène sans titre'), el('div', 'work-meta', `${s.id} · ${timeAgo(w.updatedAt)}`))
      const actions = el('div', 'work-actions')
      const play = el('button', 'btn btn-sm btn-primary', '▶ Jouer')
      play.onclick = () => onPlay(s, { save: true, editKey: w.key })
      const edit = el('button', 'btn btn-sm btn-ghost', w.key === editKey ? 'En cours' : 'Modifier')
      if (w.key === editKey) edit.classList.add('is-current')
      edit.onclick = () => editScene(s)
      const del = el('button', 'btn btn-sm btn-danger', '✕')
      del.title = 'Supprimer de mes créations'
      del.onclick = () => {
        if (!confirm(`Supprimer « ${s.t || s.id} » de tes créations ?\nLe lien partagé continuera de marcher.`)) return
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

  return {
    editScene,
    // Après un lancement réussi depuis le formulaire : formulaire vidé
    resetForm() { form.reset(); setEditing(null) },
    scenePath,
  }
}
