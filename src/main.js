import SplineLoader from '@splinetool/loader'
import {
  WebGLRenderer, PerspectiveCamera, Scene, AmbientLight, DirectionalLight,
  Color, Clock, Vector3, Group, Raycaster, Box3,
  BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial,
  SphereGeometry, MeshBasicMaterial, Mesh, RingGeometry, Matrix4, CircleGeometry,
  Euler, Quaternion
} from 'three'

// ── Paramètres d'URL ───────────────────────────────────────────────────────────
//   ?debug        HUD + logs
//   ?scale=0.002  échelle de la scène (mètres par unité Spline, défaut 0.001)
const PARAMS = new URLSearchParams(location.search)
const DEBUG = PARAMS.has('debug')
// Les scènes Spline sont exprimées en « pixels » : à 1 unité = 1 mm, une carte
// de 300 unités mesure 30 cm et la caméra Spline (≈ 800 unités) se retrouve à
// portée de bras. C'est ce qui rend le poke et la saisie possibles.
const WORLD_SCALE = parseFloat(PARAMS.get('scale')) || 0.001
const EYE_HEIGHT = 1.6        // hauteur des yeux supposée en local-floor (m)
const MIN_SCALE = WORLD_SCALE / 20, MAX_SCALE = WORLD_SCALE * 20
const log  = (...a) => { if (DEBUG) console.log('[SplineXR]', ...a) }
const warn = (...a) => console.warn('[SplineXR]', ...a)

// ── Constantes ─────────────────────────────────────────────────────────────────
const SCENES = [
  { name: 'iObeya vVR', url: 'https://prod.spline.design/h7gKpO9w4utya2UU/scene.splinecode' },
  { name: 'Streamr',    url: 'https://prod.spline.design/eekFw3BQ0ebdE9ze/scene.splinecode' },
]
const LS_KEY = 'spline-xr-v2-scenes'
const getSaved = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') } catch { return [] } }
const setSaved = a => localStorage.setItem(LS_KEY, JSON.stringify(a))

// ── DOM ────────────────────────────────────────────────────────────────────────
const configEl  = document.getElementById('config')
const loadingEl = document.getElementById('loading')
const loadMsg   = document.getElementById('load-msg')
const hudEl     = document.getElementById('hud')
const btnVr     = document.getElementById('btn-vr')
const btnBack   = document.getElementById('btn-back')
const urlInput  = document.getElementById('url-input')
const goBtn     = document.getElementById('go-btn')
const sceneList = document.getElementById('scene-list')
const saveBtn   = document.getElementById('save-btn')
const saveSec   = document.getElementById('save-section')
const myList    = document.getElementById('my-scenes-list')
const errBar    = document.getElementById('err-bar')
const btnReset  = document.getElementById('btn-reset')
const xrCanvas  = document.getElementById('xr-canvas')
const bgCanvas  = document.getElementById('bg-canvas')

// ── Debug HUD ──────────────────────────────────────────────────────────────────
const debugEl = document.createElement('div')
debugEl.style.cssText = 'position:fixed;top:8px;left:8px;z-index:30;color:#0f0;font:11px monospace;background:rgba(0,0,0,.85);padding:8px 12px;border-radius:6px;pointer-events:none;display:none;max-width:400px;white-space:pre-wrap;line-height:1.4;'
document.body.appendChild(debugEl)
function debugLog(msg) { if (!DEBUG) return; debugEl.style.display = 'block'; debugEl.textContent = msg }

// ── Fond animé ─────────────────────────────────────────────────────────────────
{
  const ctx = bgCanvas.getContext('2d')
  let t = 0
  const orbs = Array.from({ length: 4 }, (_, i) => ({
    x: 0.2 + i * 0.2, y: 0.3 + (i % 2) * 0.4,
    r: 180 + i * 60, hue: [250, 190, 280, 160][i],
    speed: 0.0003 + i * 0.0001, phase: i * 1.3
  }))
  ;(function drawBg() {
    bgCanvas.width = window.innerWidth; bgCanvas.height = window.innerHeight
    ctx.clearRect(0, 0, bgCanvas.width, bgCanvas.height); t += 1
    orbs.forEach(o => {
      const cx = (o.x + Math.sin(t * o.speed + o.phase) * 0.08) * bgCanvas.width
      const cy = (o.y + Math.cos(t * o.speed * 0.7 + o.phase) * 0.06) * bgCanvas.height
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, o.r)
      g.addColorStop(0, `hsla(${o.hue},70%,55%,0.12)`)
      g.addColorStop(1, `hsla(${o.hue},70%,55%,0)`)
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, o.r, 0, Math.PI * 2); ctx.fill()
    })
    requestAnimationFrame(drawBg)
  })()
}

function showErr(msg) {
  errBar.textContent = msg; errBar.classList.add('visible')
  setTimeout(() => errBar.classList.remove('visible'), 6000)
}
const proxyUrl = url => url.replace('https://prod.spline.design/', '/spline-proxy/')

// ── Liens partageables ─────────────────────────────────────────────────────────
// Une scène = son identifiant Spline. Le lien /s/<id> suffit pour la rouvrir :
// pas de base de données, l'URL est l'enregistrement.
const SCENE_ID_RE = /^[A-Za-z0-9_-]{6,64}$/
const sceneUrlFromId = id => `https://prod.spline.design/${id}/scene.splinecode`

// Accepte : URL prod Spline, lien /s/<id> de l'app, ou identifiant seul
function parseSceneId(input) {
  const s = (input || '').trim()
  let m = s.match(/prod\.spline\.design\/([A-Za-z0-9_-]+)/) || s.match(/\/s\/([A-Za-z0-9_-]+)/)
  const id = m ? m[1] : s
  return SCENE_ID_RE.test(id) ? id : null
}

// Conserve ?debug / ?scale d'une page à l'autre
const routeUrl = path => path + location.search
const shareUrl = id => `${location.origin}/s/${id}`
let currentSceneId = null

function sceneIdFromLocation() {
  const m = location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)\/?$/)
  if (m && SCENE_ID_RE.test(m[1])) return m[1]
  const q = PARAMS.get('scene')
  return q ? parseSceneId(q) : null
}

SCENES.forEach(s => {
  const btn = document.createElement('button'); btn.className = 'scene-btn'
  const slug = s.url.replace('https://prod.spline.design/', '').replace('/scene.splinecode', '')
  btn.innerHTML = `<div><div class="scene-name">${s.name}</div><div class="scene-slug">${slug}</div></div><span class="scene-arrow">▶</span>`
  btn.onclick = () => loadScene(s.url); sceneList.appendChild(btn)
})

function renderMyScenes() {
  const saved = getSaved(); myList.innerHTML = ''
  if (saved.length) {
    saveSec.style.display = 'block'
    saved.forEach((url, i) => {
      const row = document.createElement('div'); row.className = 'saved-scene'
      const slug = url.replace('https://prod.spline.design/', '').replace('/scene.splinecode', '')
      row.innerHTML = `<div class="saved-scene-url">${slug}</div>`
      const bL = document.createElement('button'); bL.className = 'btn btn-sm btn-ghost'; bL.textContent = '▶'; bL.onclick = () => loadScene(url)
      const bD = document.createElement('button'); bD.className = 'btn btn-sm btn-danger'; bD.textContent = '✕'; bD.onclick = () => { const a = getSaved(); a.splice(i,1); setSaved(a); renderMyScenes() }
      row.appendChild(bL); row.appendChild(bD); myList.appendChild(row)
    })
  } else { saveSec.style.display = 'none' }
}
renderMyScenes()
saveBtn.onclick = () => {
  const url = urlInput.value.trim()
  const id = parseSceneId(url)
  if (!id) { urlInput.classList.add('error'); setTimeout(() => urlInput.classList.remove('error'), 500); return }
  const full = sceneUrlFromId(id)
  const saved = getSaved(); if (!saved.includes(full)) { saved.push(full); setSaved(saved) }; renderMyScenes()
}
goBtn.onclick = () => loadScene(urlInput.value.trim())
urlInput.addEventListener('keydown', e => e.key === 'Enter' && loadScene(urlInput.value.trim()))

// ══════════════════════════════════════════════════════════════════════════════
// THREE.JS RENDERER
// ══════════════════════════════════════════════════════════════════════════════
const renderer = new WebGLRenderer({ canvas: xrCanvas, antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.xr.enabled = true
renderer.setClearColor(new Color('#06060f'))

const cameraRig = new Group()
const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 2000)
cameraRig.add(camera)
const clock = new Clock()
let threeScene = null

// Conteneur de la scène Spline : c'est lui qu'on met à l'échelle, déplace et
// redimensionne. Le rig (le joueur) reste en mètres.
const world = new Group()

// Point de vue initial issu de la caméra Spline : position des yeux (monde),
// lacet du rig, et inclinaison résiduelle utilisée hors VR uniquement.
const UP = new Vector3(0, 1, 0)
const view = {
  eye: new Vector3(0, EYE_HEIGHT, 1),   // monde, scène à sa position par défaut
  eyeLocal: new Vector3(),              // même point dans le repère de la scène
  yaw: 0, tilt: new Quaternion(),
}

// Place le rig pour que les yeux tombent sur view.eye. En VR, le casque ajoute
// déjà la hauteur de tête (local-floor) : on l'enlève du rig.
function placeRig() {
  cameraRig.position.copy(view.eye)
  if (renderer.xr.isPresenting) cameraRig.position.y -= EYE_HEIGHT
  cameraRig.quaternion.setFromAxisAngle(UP, view.yaw)
  if (!renderer.xr.isPresenting) { camera.position.set(0, 0, 0); camera.quaternion.copy(view.tilt) }
}

function resetWorld() {
  world.position.set(0, 0, 0)
  world.quaternion.identity()
  world.scale.setScalar(WORLD_SCALE)
}

renderer.xr.addEventListener('sessionstart', placeRig)
renderer.xr.addEventListener('sessionend', placeRig)

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)

// ══════════════════════════════════════════════════════════════════════════════
// VISUELS DE POINTAGE
// La scène pouvant être agrandie ou réduite, rayon, curseur et marqueur de
// téléport sont mis à l'échelle de la distance pour garder une taille
// apparente fixe.
// ══════════════════════════════════════════════════════════════════════════════
const RAY_IDLE_LENGTH = 4     // longueur du rayon sans cible (m)
const CURSOR_ANGULAR  = 0.012 // taille du curseur ≈ 0,7° de champ de vision

function makeRayLine(color) {
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3))
  const line = new Line(geo, new LineBasicMaterial({ color, transparent: true, opacity: 0.55 }))
  line.scale.z = RAY_IDLE_LENGTH
  line.visible = false
  return line
}

function makeCursor(color) {
  const g = new Group()
  const ringMat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false })
  const dotMat  = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false })
  const ring = new Mesh(new RingGeometry(0.55, 1, 32), ringMat)
  const dot  = new Mesh(new CircleGeometry(0.28, 24), dotMat)
  ring.renderOrder = dot.renderOrder = 999
  g.add(ring, dot)
  g.visible = false
  return { group: g, ring, dot, ringMat }
}

function makeTeleportMarker() {
  const g = new Group()
  const ring = new Mesh(new RingGeometry(0.7, 1, 32), new MeshBasicMaterial({ color: 0x3ecfcf, transparent: true, opacity: 0.85, side: 2 }))
  ring.rotation.x = -Math.PI / 2
  g.add(ring)
  g.visible = false
  return g
}
const teleportMarker = makeTeleportMarker()

const loco = {
  speed: 1.5, snapAngle: Math.PI / 4, snapCooldown: 0, snapDelay: 0.35,
  deadzone: 0.25, teleportPending: false, teleportTarget: new Vector3(),
  sceneSize: 0,          // plus grande dimension de la scène, en unités Spline
  outOfBoundsShown: false, outOfBoundsTimer: 0,
}

function createControllerModel(side) {
  const g = new Group()
  const accent = side === 0 ? 0x7b6ef6 : 0x3ecfcf
  const accentMat = new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.9 })
  const bodyMat   = new MeshBasicMaterial({ color: 0x1a1a2e, transparent: true, opacity: 0.85 })
  const trimMat   = new MeshBasicMaterial({ color: 0x2a2a4a, transparent: true, opacity: 0.9 })
  const glowMat   = new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.25 })
  const body = new Mesh(new SphereGeometry(0.034, 10, 8), bodyMat)
  body.scale.set(1, 1.35, 0.9); body.position.set(0, -0.01, -0.01); g.add(body)
  const ring = new Mesh(new RingGeometry(0.042, 0.052, 32), accentMat.clone())
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.005; g.add(ring)
  const halo = new Mesh(new RingGeometry(0.052, 0.072, 32), glowMat)
  halo.rotation.x = -Math.PI / 2; halo.position.y = 0.004; g.add(halo)
  const stickBase = new Mesh(new SphereGeometry(0.012, 8, 6), trimMat)
  stickBase.scale.set(1, 0.4, 1); stickBase.position.set(side === 0 ? -0.018 : 0.018, 0.03, -0.01); g.add(stickBase)
  const stick = new Mesh(new SphereGeometry(0.008, 8, 6), accentMat.clone())
  stick.scale.set(1, 0.6, 1); stick.position.copy(stickBase.position); stick.position.y += 0.006; g.add(stick)
  const trigger = new Mesh(new SphereGeometry(0.012, 8, 6), trimMat)
  trigger.scale.set(0.7, 0.5, 1.2); trigger.position.set(0, 0.005, -0.042); g.add(trigger)
  const triggerLight = new Mesh(new SphereGeometry(0.006, 6, 4),
    new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }))
  triggerLight.position.copy(trigger.position); g.add(triggerLight)
  g.rotation.x = 0.3
  return { group: g, stick, triggerLight }
}

// ── Modèle de main (articulations) ────────────────────────────────────────────
const HAND_JOINTS = [
  'wrist',
  'thumb-metacarpal','thumb-phalanx-proximal','thumb-phalanx-distal','thumb-tip',
  'index-finger-metacarpal','index-finger-phalanx-proximal','index-finger-phalanx-intermediate','index-finger-phalanx-distal','index-finger-tip',
  'middle-finger-metacarpal','middle-finger-phalanx-proximal','middle-finger-phalanx-intermediate','middle-finger-phalanx-distal','middle-finger-tip',
  'ring-finger-metacarpal','ring-finger-phalanx-proximal','ring-finger-phalanx-intermediate','ring-finger-phalanx-distal','ring-finger-tip',
  'pinky-finger-metacarpal','pinky-finger-phalanx-proximal','pinky-finger-phalanx-intermediate','pinky-finger-phalanx-distal','pinky-finger-tip',
]
function createHandModel(side) {
  const group = new Group()
  const matJoint = new MeshBasicMaterial({ color: side === 0 ? 0x7b6ef6 : 0x3ecfcf, transparent: true, opacity: 0.75 })
  const matTip   = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
  const meshes = {}
  HAND_JOINTS.forEach(name => {
    const isTip = name.endsWith('-tip')
    const r = isTip ? 0.007 : name === 'wrist' ? 0.012 : 0.006
    const m = new Mesh(new SphereGeometry(r, 8, 6), isTip ? matTip : matJoint)
    m.visible = false; group.add(m); meshes[name] = m
  })
  return { group, meshes, matTip }
}
// Les articulations sont des enfants de l'objet main (même repère que le rig) :
// on recopie simplement leur position locale.
function updateHandModel(model, hand, selecting) {
  for (const name of HAND_JOINTS) {
    const j = hand.joints[name], m = model.meshes[name]
    if (j && j.visible !== false) { m.position.copy(j.position); m.visible = true }
    else m.visible = false
  }
  model.matTip.color.setHex(selecting ? 0x3ecfcf : 0xffffff)
}

// ══════════════════════════════════════════════════════════════════════════════
// POINTEURS XR
// Un pointeur par source d'entrée (manette OU main). Le rayon utilisé est le
// targetRaySpace fourni par le système : sur Quest, c'est le rayon officiel
// de Meta pour les mains (épaule → pincement), stable et précis. Le clic passe
// par les événements WebXR natifs selectstart/selectend, déclenchés aussi bien
// par la gâchette que par le pincement pouce-index.
// ══════════════════════════════════════════════════════════════════════════════
const raycaster = new Raycaster()
const _mat = new Matrix4(), _origin = new Vector3(), _dir = new Vector3()
const _fwd = new Vector3(), _right = new Vector3(), _camPos = new Vector3()

const pointers = [0, 1].map(i => {
  const color = i === 0 ? 0x7b6ef6 : 0x3ecfcf
  const ctrl  = renderer.xr.getController(i)      // targetRaySpace
  const grip  = renderer.xr.getControllerGrip(i)  // gripSpace
  const hand  = renderer.xr.getHand(i)
  const model = createControllerModel(i); grip.add(model.group)
  const handModel = createHandModel(i); hand.add(handModel.group)
  const ray = makeRayLine(color); ctrl.add(ray)
  const cursor = makeCursor(color)

  const p = {
    i, ctrl, grip, hand, model, handModel, ray, cursor,
    source: null, hit: null, entity: null,
    hoverEntity: null, pressEntity: null, selecting: false,
    poking: null,                          // entité touchée du doigt
    grabbing: false, grabPrev: null,       // saisie de la scène
    squeezing: false, selectGrab: false,   // origine de la saisie (grip / pincement)
  }
  ctrl.addEventListener('connected', e => {
    p.source = e.data
    model.group.visible = !e.data.hand
    log('Source connectée', i, e.data.handedness, e.data.hand ? 'main' : 'manette', e.data.targetRayMode)
  })
  ctrl.addEventListener('disconnected', () => {
    endPoke(p)
    setHover(p, null)
    p.source = null; p.hit = null; p.entity = null; p.selecting = false; p.pressEntity = null
    p.squeezing = false; p.selectGrab = false
    setGrab(p, false)
    ray.visible = false; cursor.group.visible = false
  })
  ctrl.addEventListener('selectstart', () => onSelectStart(p))
  ctrl.addEventListener('selectend',   () => onSelectEnd(p))
  // Bouton grip des manettes : saisie de la scène, quelle que soit la cible
  ctrl.addEventListener('squeezestart', () => { p.squeezing = true; setGrab(p, true) })
  ctrl.addEventListener('squeezeend',   () => { p.squeezing = false; if (!p.selectGrab) setGrab(p, false) })
  return p
})

// ══════════════════════════════════════════════════════════════════════════════
// EVENT SYSTEM — exécution des événements Spline
// Le loader stocke les events dans entity.data.events (collection Map-like :
// .forEach() mais ni .length ni Symbol.iterator). Idem pour actions et tweens.
// ══════════════════════════════════════════════════════════════════════════════
let splineContext = null          // { scene, shared } : contexte attendu par le loader
let meshToEntity = new Map()      // uuid du mesh → entité Spline portant les events
let interactiveObjects = []
const hoverCount = new Map()      // entité → nombre de pointeurs qui la survolent

function toArray(thing) {
  if (!thing) return []
  if (Array.isArray(thing)) return thing
  if (typeof thing.forEach === 'function') { const arr = []; thing.forEach(item => arr.push(item)); return arr }
  if (typeof thing[Symbol.iterator] === 'function') return [...thing]
  return []
}
function getEventsArray(obj) { return toArray(obj?.data?.events) }
function hasEvents(obj) { return getEventsArray(obj).length > 0 }

function collectObjects(splineScene) {
  interactiveObjects = []
  meshToEntity = new Map()
  const entityByUuid = new Map()
  splineScene.traverse(obj => { if (obj.uuid) entityByUuid.set(obj.uuid, obj) })
  splineScene.traverse(obj => {
    if (!obj.isMesh) return
    interactiveObjects.push(obj)
    let cur = obj
    while (cur && !cur.isScene) {
      if (hasEvents(cur)) { meshToEntity.set(obj.uuid, cur); return }
      cur = cur.parent
    }
  })
  splineContext.entityByUuid = entityByUuid

  const withEvents = [...new Set(meshToEntity.values())]
  log('Meshes:', interactiveObjects.length, '| Entités interactives:', withEvents.length)
  withEvents.forEach(e => log('  →', e.name, getEventsArray(e).map(ev => (ev?.data ?? ev)?.type)))
}

// Entité interactive touchée (null si le premier objet touché n'a pas d'event :
// l'occlusion est ainsi respectée)
function entityOf(hit) { return hit ? (meshToEntity.get(hit.object.uuid) ?? null) : null }

function fireRay(source) {
  _mat.extractRotation(source.matrixWorld)
  _origin.setFromMatrixPosition(source.matrixWorld)
  _dir.set(0, 0, -1).applyMatrix4(_mat).normalize()
  raycaster.set(_origin, _dir)
  const hits = raycaster.intersectObjects(interactiveObjects, true)
  return hits.length ? hits[0] : null
}

// ── Audio ────────────────────────────────────────────────────────────────────
// Le loader embarque Howler : shared.getAudio(id) renvoie un lecteur
// (play / pause / stop, volume, loop, delay).
function getSound(id) {
  const shared = splineContext?.shared
  if (!id || !shared?.getAudio || !shared.audios?.[id]) return null
  try { return shared.getAudio(id) } catch (e) { warn('Audio introuvable:', id, e.message); return null }
}

function runAudioAction(a) {
  if (a.interaction === 'play') {
    const s = getSound(a.audio)
    if (!s) return
    if (a.volume !== undefined) s.volume = a.volume > 1 ? a.volume / 100 : a.volume
    if (a.loop !== undefined) s.loop = a.loop
    if (a.delay !== undefined) s.delay = a.delay
    if (a.toggle && s.status === 'playing') { s.pause(); log('Audio pause (toggle)', a.audio); return }
    s.play(); log('Audio play', a.audio)
  } else if (a.interaction === 'pause' || a.interaction === 'stop') {
    const ids = [a.audio, a.playAudio].filter(Boolean)
    const targets = ids.map(getSound).filter(Boolean)
    // Sans cible explicite, on arrête tous les sons de la scène
    const list = targets.length ? targets : Object.keys(splineContext?.shared?.audios ?? {}).map(getSound).filter(Boolean)
    list.forEach(s => a.interaction === 'pause' ? s.pause() : s.stop())
    log('Audio', a.interaction, ids.join(',') || 'tous')
  }
}

function stopAllAudio() {
  const audios = splineContext?.shared?.audios
  if (!audios) return
  Object.values(audios).forEach(s => { try { s?.stop?.() } catch {} })
}

// ── Exécution des actions ────────────────────────────────────────────────────
// phase : 'in' (entrée de survol), 'out' (sortie de survol) ou undefined (clic)
function runActions(actions, phase) {
  if (!actions || !splineContext) return
  for (const action of toArray(actions)) {
    const a = action?.data ?? action
    if (!a) continue
    const run = () => runAction(a, phase)
    // Le délai ne s'applique pas à l'audio, qui le gère lui-même
    if (a.type !== 'Audio' && a.delay > 0 && phase !== 'out') setTimeout(run, a.delay)
    else run()
  }
}

function runAction(a, phase) {
  if (a.type === 'Transition') {
    const target = splineContext.entityByUuid?.get(a.object)
    if (!target) { warn('Cible de transition introuvable:', a.object); return }

    // Tweens : [0] = état de départ (souvent null = état de base), [dernier] = état cible
    const states = toArray(a.tweens)
      .map(tw => (tw?.data ?? tw)?.state)
      .filter(s => s !== undefined)
    if (!states.length) return
    const fromState = states.length > 1 ? states[0] : null
    const toState   = states[states.length - 1]

    let stateId
    if (phase === 'in') stateId = toState
    else if (phase === 'out') stateId = fromState
    else stateId = (target.stateSelection ?? null) === toState ? fromState : toState // clic : bascule

    log('Transition →', target.name, '| état:', stateId, '| phase:', phase ?? 'clic')
    try { target.changeSelectedState(stateId, splineContext, true) }
    catch (e) { warn('changeSelectedState:', e.message) }

  } else if (a.type === 'Audio') {
    // Une sortie de survol ne relance pas un son déclenché à l'entrée
    if (phase !== 'out') runAudioAction(a)

  } else if (a.type === 'Conditional') {
    if (a.ifActions) runActions(a.ifActions, phase)

  } else if (a.type === 'SetVariable') {
    const shared = splineContext.shared
    if (shared?.updateVariable && a.variable !== undefined) {
      try { shared.updateVariable(a.variable, a.value) } catch (e) { warn('SetVariable:', e.message) }
    }
  } else if (a.type === 'OpenUrl' || a.type === 'URL') {
    const url = a.url || a.value
    if (url && phase !== 'out') window.open(url, '_blank')
  } else {
    log('Action non gérée:', a.type, a)
  }
}

function triggerEvent(entity, eventType, phase) {
  if (!entity) return
  for (const evt of getEventsArray(entity)) {
    const e = evt?.data ?? evt
    if (!e) continue
    if ((e.type ?? evt.type) !== eventType) continue
    if (e.disabled || evt.disabled) continue
    log('▶', eventType, phase ?? '', 'sur', entity.name)
    runActions(e.actions ?? evt.actions, phase)
  }
}

// ── Survol : compteur par entité pour que deux pointeurs ne se contredisent pas
function setHover(p, entity) {
  if (p.hoverEntity === entity) return
  const prev = p.hoverEntity
  if (prev) {
    const n = (hoverCount.get(prev) ?? 1) - 1
    if (n <= 0) { hoverCount.delete(prev); triggerEvent(prev, 'MouseHover', 'out') }
    else hoverCount.set(prev, n)
  }
  if (entity) {
    const n = (hoverCount.get(entity) ?? 0) + 1
    hoverCount.set(entity, n)
    if (n === 1) triggerEvent(entity, 'MouseHover', 'in')
  }
  p.hoverEntity = entity
}

// ── Clic : gâchette ou pincement ─────────────────────────────────────────────
function onSelectStart(p) {
  if (!threeScene) return
  p.selecting = true
  // Le rayon a pu ne pas encore être évalué ce frame-ci (pointeur transitoire)
  if (!p.hit) { p.hit = fireRay(p.ctrl); p.entity = entityOf(p.hit) }
  if (p.poking) return            // le doigt est déjà en contact : le poke gère
  if (p.entity) {
    p.pressEntity = p.entity
    triggerEvent(p.entity, 'MouseDown')
  } else {
    // Pincement / gâchette dans le vide : on saisit la scène
    p.selectGrab = true
    setGrab(p, true)
  }
}

function onSelectEnd(p) {
  p.selecting = false
  if (p.selectGrab) { p.selectGrab = false; if (!p.squeezing) setGrab(p, false) }
  const pressed = p.pressEntity
  p.pressEntity = null
  if (!pressed) return
  triggerEvent(pressed, 'MouseUp')
  if (p.entity === pressed) triggerEvent(pressed, 'MousePress')
}

// ── Poke : contact du bout de l'index ────────────────────────────────────────
// On lance un rayon court de la dernière phalange vers le bout du doigt,
// prolongé de quelques millimètres. Le relâchement demande un retrait plus
// grand (hystérésis) pour éviter les doubles déclenchements.
const POKE_DEPTH = 0.008, POKE_RELEASE = 0.02
const _tip = new Vector3(), _dst = new Vector3(), _pokeDir = new Vector3()

function pokeTest(p) {
  const tip = p.hand.joints['index-finger-tip']
  const dst = p.hand.joints['index-finger-phalanx-distal']
  if (!tip || !dst || !tip.visible || !dst.visible) return null
  tip.getWorldPosition(_tip); dst.getWorldPosition(_dst)
  _pokeDir.subVectors(_tip, _dst)
  const len = _pokeDir.length()
  if (len < 1e-4) return null
  _pokeDir.divideScalar(len)
  raycaster.set(_dst, _pokeDir)
  raycaster.far = len + (p.poking ? POKE_RELEASE : POKE_DEPTH)
  const hits = raycaster.intersectObjects(interactiveObjects, true)
  raycaster.far = Infinity
  return hits.length ? hits[0] : null
}

function updatePoke(p) {
  const entity = p.selecting && !p.poking ? null : entityOf(pokeTest(p))
  if (entity && !p.poking) {
    p.poking = entity
    setHover(p, entity)
    triggerEvent(entity, 'MouseDown')
    log('Poke ↓', entity.name)
  } else if (p.poking && entity !== p.poking) {
    endPoke(p)
  }
}

function endPoke(p) {
  const e = p.poking
  if (!e) return
  p.poking = null
  triggerEvent(e, 'MouseUp')
  triggerEvent(e, 'MousePress')
  log('Poke ↑', e.name)
}

// ── Saisie de la scène ───────────────────────────────────────────────────────
// Une main : la scène suit la main. Deux mains : écarter / rapprocher les
// mains agrandit / réduit la scène autour de leur point milieu.
const grab = { count: 0, prevDist: 0 }
const _ga = new Vector3(), _gb = new Vector3(), _gmid = new Vector3(), _gd = new Vector3()

function setGrab(p, on) {
  p.grabbing = on
  p.grabPrev = null
  grab.count = -1                // force la réinitialisation au prochain frame
}

function updateWorldGrab() {
  const grabbers = pointers.filter(p => p.grabbing && p.source)
  if (grabbers.length !== grab.count) {
    grabbers.forEach(p => { p.grabPrev = null })
    grab.prevDist = 0
    grab.count = grabbers.length
  }
  if (grabbers.length === 1) {
    // Position de la main dans le repère du rig : pas de boucle de rétroaction
    // quand on déplace le rig.
    const p = grabbers[0]
    const cur = p.ctrl.position
    if (p.grabPrev) {
      _gd.subVectors(cur, p.grabPrev).applyQuaternion(cameraRig.quaternion)
      cameraRig.position.sub(_gd)
    }
    p.grabPrev = (p.grabPrev ?? new Vector3()).copy(cur)
  } else if (grabbers.length >= 2) {
    grabbers[0].ctrl.getWorldPosition(_ga)
    grabbers[1].ctrl.getWorldPosition(_gb)
    const dist = _ga.distanceTo(_gb)
    if (grab.prevDist > 1e-3) {
      let k = dist / grab.prevDist
      const next = MathClamp(world.scale.x * k, MIN_SCALE, MAX_SCALE)
      k = next / world.scale.x
      _gmid.addVectors(_ga, _gb).multiplyScalar(0.5)
      world.position.sub(_gmid).multiplyScalar(k).add(_gmid)
      world.scale.setScalar(next)
      applyLightScale()
    }
    grab.prevDist = dist
  }
}
const MathClamp = (v, a, b) => Math.min(b, Math.max(a, v))

// ── Mise à jour visuelle d'un pointeur ───────────────────────────────────────
function updatePointerVisuals(p) {
  const { ray, cursor, hit } = p
  const active = !!p.source && p.source.targetRayMode !== 'screen'
  ray.visible = active
  cursor.group.visible = active && !!hit
  if (!active) return
  ray.scale.z = hit ? hit.distance : RAY_IDLE_LENGTH
  ray.material.opacity = p.entity ? 0.85 : 0.4
  if (hit) {
    // Curseur au point d'impact, tourné vers la caméra, taille apparente constante
    cursor.group.position.copy(hit.point)
    renderer.xr.getCamera().getWorldPosition(_camPos)
    cursor.group.lookAt(_camPos)
    const s = hit.distance * CURSOR_ANGULAR * (p.selecting ? 0.7 : 1) * (p.entity ? 1.3 : 1)
    cursor.group.scale.setScalar(s)
    cursor.ringMat.opacity = p.entity ? 1 : 0.5
  }
}

// ── Boucle contrôles ──────────────────────────────────────────────────────────
let debugCounter = 0
function updateControls(dt) {
  if (!renderer.xr.isPresenting) return
  const xrCam = renderer.xr.getCamera()
  xrCam.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize()
  _right.set(_fwd.z, 0, -_fwd.x)
  loco.snapCooldown = Math.max(0, loco.snapCooldown - dt)

  // Out-of-bounds : distance au point de vue initial, suivi dans le repère de
  // la scène (qui peut avoir été déplacée ou redimensionnée)
  if (loco.sceneSize > 0) {
    world.localToWorld(_oobTarget.copy(view.eyeLocal))
    _oobRig.copy(cameraRig.position); _oobRig.y += EYE_HEIGHT
    const radius = Math.max(5, loco.sceneSize * world.scale.x * 5)
    const dist = _oobRig.distanceTo(_oobTarget)
    if (dist > radius && !loco.outOfBoundsShown) { loco.outOfBoundsShown = true; showOutOfBounds() }
    else if (dist <= radius && loco.outOfBoundsShown) { loco.outOfBoundsShown = false; hideOutOfBounds() }
    if (loco.outOfBoundsShown) {
      loco.outOfBoundsTimer += dt
      if (loco.outOfBoundsTimer > 3) { resetCamera(); loco.outOfBoundsTimer = 0 }
    } else loco.outOfBoundsTimer = 0
  }

  for (const p of pointers) {
    const src = p.source
    if (!src) continue

    // 1. Main : le contact du doigt passe avant le rayon
    if (src.hand) updatePoke(p)

    // 2. Rayon système → cible (masqué pendant un contact)
    if (p.poking) {
      p.hit = null
      p.entity = p.poking
      setHover(p, p.poking)
      p.ray.visible = false
      p.cursor.group.visible = false
    } else {
      p.hit = fireRay(p.ctrl)
      p.entity = entityOf(p.hit)
      setHover(p, p.entity)
      updatePointerVisuals(p)
    }

    // 3. Main : affichage des articulations
    if (src.hand) {
      p.handModel.group.visible = true
      updateHandModel(p.handModel, p.hand, p.selecting)
      continue
    }
    p.handModel.group.visible = false

    // 4. Manette : joysticks (déplacement, rotation, téléport)
    const gp = src.gamepad
    if (!gp) continue
    const jx = gp.axes[2] ?? gp.axes[0] ?? 0
    const jy = gp.axes[3] ?? gp.axes[1] ?? 0
    const left = src.handedness === 'left'

    if (left) {
      const dx = Math.abs(jx) > loco.deadzone ? jx : 0
      const dy = Math.abs(jy) > loco.deadzone ? jy : 0
      if (dx || dy) {
        cameraRig.position.addScaledVector(_fwd, -dy * loco.speed * dt)
        cameraRig.position.addScaledVector(_right, -dx * loco.speed * dt)
      }
    } else {
      if (loco.snapCooldown <= 0) {
        if (jx > 0.6)       { cameraRig.rotateY(-loco.snapAngle); loco.snapCooldown = loco.snapDelay }
        else if (jx < -0.6) { cameraRig.rotateY( loco.snapAngle); loco.snapCooldown = loco.snapDelay }
      }
      if (jy < -0.6) {
        // Joystick poussé vers l'avant : viser le point de téléport
        if (p.hit) {
          teleportMarker.visible = true
          teleportMarker.position.copy(p.hit.point)
          teleportMarker.scale.setScalar(p.hit.distance * 0.03)
          loco.teleportPending = true
          loco.teleportTarget.copy(p.hit.point)
        }
      } else {
        if (loco.teleportPending) { cameraRig.position.copy(loco.teleportTarget); loco.teleportPending = false }
        teleportMarker.visible = false
      }
    }

    // Retour visuel de la manette
    const tv = gp.buttons[0]?.value ?? 0
    p.model.triggerLight.material.opacity = tv * 0.8
    p.model.stick.rotation.x = jy * 0.25
    p.model.stick.rotation.z = -jx * 0.25
  }

  // 5. Saisie de la scène (une ou deux mains)
  updateWorldGrab()

  if (DEBUG && (++debugCounter % 20 === 0)) {
    debugLog(pointers.map(p => {
      if (!p.source) return `[${p.i}] —`
      const kind = p.source.hand ? 'main' : 'manette'
      const target = p.poking ? 'contact' : p.hit ? (p.hit.object.name || 'mesh') : 'rien'
      const flags = [p.selecting && 'PRESS', p.poking && 'POKE', p.grabbing && 'GRAB'].filter(Boolean).join(' ')
      return `[${p.i}] ${p.source.handedness} ${kind} ${p.source.targetRayMode}\n    vise: ${target} | entité: ${p.entity?.name ?? '—'} ${flags}`
    }).join('\n') + `\nmeshes: ${interactiveObjects.length} | survols: ${hoverCount.size} | échelle: ${(world.scale.x * 1000).toFixed(2)} mm/u`)
  }
}
const _oobTarget = new Vector3(), _oobRig = new Vector3()

// ── Attach/detach ────────────────────────────────────────────────────────────
function attachXR(scene) {
  scene.add(cameraRig)
  pointers.forEach(p => {
    cameraRig.add(p.ctrl, p.grip, p.hand)
    scene.add(p.cursor.group)
  })
  scene.add(teleportMarker)
}
function detachXR(scene) {
  pointers.forEach(p => { endPoke(p); setHover(p, null); setGrab(p, false); scene.remove(p.cursor.group) })
  hoverCount.clear()
  scene.remove(cameraRig)
  scene.remove(teleportMarker)
}

// ── Out-of-bounds ────────────────────────────────────────────────────────────
const oobOverlay = document.createElement('div')
oobOverlay.style.cssText = 'position:fixed;inset:0;z-index:25;display:none;align-items:center;justify-content:center;background:rgba(6,6,15,.75);backdrop-filter:blur(8px);flex-direction:column;gap:14px;'
oobOverlay.innerHTML = `<div style="font-size:28px">🧭</div><div style="font-size:16px;font-weight:600;color:#e8e8f0">Tu t'es éloigné</div><div style="font-size:13px;color:#7a7a95">Reset automatique dans 3s…</div><button id="oob-reset-btn" style="margin-top:4px;padding:10px 22px;border-radius:100px;border:1px solid rgba(123,110,246,.5);background:rgba(123,110,246,.2);color:#7b6ef6;font-size:13px;font-weight:600;cursor:pointer;">Revenir maintenant</button>`
document.body.appendChild(oobOverlay)
document.getElementById('oob-reset-btn').onclick = () => resetCamera()
function showOutOfBounds() { oobOverlay.style.display = 'flex' }
function hideOutOfBounds() { oobOverlay.style.display = 'none' }
function resetCamera() {
  resetWorld()
  applyLightScale()
  placeRig()
  loco.outOfBoundsShown = false; loco.outOfBoundsTimer = 0; hideOutOfBounds()
}

// ── Caméra Spline ────────────────────────────────────────────────────────────
function extractSplineCamera(splineScene) {
  splineScene.updateMatrixWorld(true)
  const candidates = []
  splineScene.traverse(o => {
    if (!o.isCamera) return
    const name = (o.name || '').toLowerCase()
    let score = 0
    if (name.includes('personal')) score = 10
    else if (name.includes('play'))  score = 8
    else if (name.includes('main'))  score = 6
    else if (name.includes('scene')) score = 4
    candidates.push({ obj: o, score })
  })
  if (!candidates.length) return null
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0].obj
  const pos = new Vector3(), quat = new best.quaternion.constructor()
  best.getWorldPosition(pos); best.getWorldQuaternion(quat)
  const d = best.data ?? {}
  const fov = d.perspective?.fov ?? best.fov ?? 45
  const zoom = d.perspective?.zoom ?? best.zoom ?? 1
  log('Caméra:', best.name, '| pos:', pos.toArray().map(v => Math.round(v)), '| fov:', fov)
  return { pos, quat, fov, zoom }
}

// ══════════════════════════════════════════════════════════════════════════════
// SCÈNE + CHARGEMENT
// ══════════════════════════════════════════════════════════════════════════════
function buildScene(splineScene) {
  const scene = new Scene()
  scene.background = new Color('#06060f')
  const splineCam = extractSplineCamera(splineScene)
  const toRemove = []
  splineScene.traverse(o => { if (o.isCamera) toRemove.push(o) })
  toRemove.forEach(c => c.removeFromParent?.() || c.parent?.remove(c))

  scene.add(new AmbientLight(0xffffff, 0.6))
  const dl = new DirectionalLight(0xffffff, 0.8); dl.position.set(300, 600, 400); scene.add(dl)

  // La scène Spline est placée dans le conteneur mis à l'échelle
  world.clear()
  resetWorld()
  world.add(splineScene)
  scene.add(world)
  collectLights(splineScene)
  applyLightScale()

  // Contexte au format attendu par les entités du loader : { shared, scene }
  const shared = splineScene.sharedAssets ?? splineScene._sharedAssets ?? null
  if (!shared) warn('sharedAssets introuvable : transitions et audio limités')
  splineContext = { scene: splineScene, shared, entityByUuid: new Map() }
  collectObjects(splineScene)

  // Événements Start (dont la musique d'ambiance)
  setTimeout(() => {
    if (!splineContext) return
    for (const [, entity] of splineContext.entityByUuid) {
      if (hasEvents(entity)) triggerEvent(entity, 'Start')
    }
  }, 200)

  // Point de vue : position et orientation de la caméra Spline (unités Spline,
  // la scène n'étant pas encore mise à l'échelle au moment de l'extraction)
  const quat = new Quaternion()
  if (splineCam) {
    view.eyeLocal.copy(splineCam.pos)
    quat.copy(splineCam.quat)
    camera.fov = splineCam.fov; camera.zoom = splineCam.zoom
  } else {
    const box = new Box3().setFromObject(splineScene)
    const center = box.getCenter(new Vector3()), size = box.getSize(new Vector3())
    view.eyeLocal.set(center.x, center.y, center.z + Math.max(size.x, size.y, size.z) * 1.5)
    camera.fov = 45; camera.zoom = 1
  }
  camera.updateProjectionMatrix()

  // En VR, seul le lacet est appliqué au rig (le sol doit rester horizontal) ;
  // tangage et roulis ne servent qu'à la vue hors casque.
  const e = new Euler().setFromQuaternion(quat, 'YXZ')
  view.yaw = e.y
  view.tilt.setFromEuler(new Euler(e.x, 0, e.z, 'YXZ'))
  world.updateMatrixWorld(true)
  view.eye.copy(view.eyeLocal).applyMatrix4(world.matrixWorld)
  placeRig()

  const sz = new Box3().setFromObject(splineScene).getSize(new Vector3()).divideScalar(WORLD_SCALE)
  loco.sceneSize = Math.max(sz.x, sz.y, sz.z)
  log('Échelle:', WORLD_SCALE, 'm/u | taille scène:', Math.round(loco.sceneSize), 'u ≈', (loco.sceneSize * WORLD_SCALE).toFixed(2), 'm')

  attachXR(scene)
  return scene
}

// ── Lumières : les distances d'atténuation ne suivent pas l'échelle du parent,
// on les recalcule pour garder l'éclairage authored dans Spline.
let sceneLights = []
function collectLights(root) {
  sceneLights = []
  root.traverse(o => {
    if (!o.isLight) return
    const c = o.shadow?.camera
    sceneLights.push({
      light: o,
      distance: o.distance ?? 0,
      cam: c ? { near: c.near, far: c.far, left: c.left, right: c.right, top: c.top, bottom: c.bottom } : null,
    })
  })
  lastLightScale = 0
}
let lastLightScale = 0
function applyLightScale() {
  const s = world.scale.x
  if (s === lastLightScale) return
  lastLightScale = s
  for (const { light, distance, cam: base } of sceneLights) {
    if (distance) light.distance = distance * s
    const cam = light.shadow?.camera
    if (!cam || !base) continue
    cam.near = base.near * s; cam.far = base.far * s
    if (cam.isOrthographicCamera) {
      cam.left = base.left * s; cam.right = base.right * s
      cam.top = base.top * s; cam.bottom = base.bottom * s
    }
    cam.updateProjectionMatrix()
  }
}

function loadSpline(url) {
  return new Promise((resolve, reject) => {
    const loader = new SplineLoader()
    const orig = Vector3.prototype.copy
    Vector3.prototype.copy = function (v) { return v == null ? this : orig.call(this, v) }
    loader.load(url,
      s => { Vector3.prototype.copy = orig; resolve(s) },
      undefined,
      e => { Vector3.prototype.copy = orig; reject(e) }
    )
    setTimeout(() => { Vector3.prototype.copy = orig; reject(new Error('Timeout 30s')) }, 30000)
  })
}

// input : URL Spline, lien /s/<id> ou identifiant. fromRoute : chargé depuis
// l'adresse de la page (ne pas réécrire l'historique).
async function loadScene(input, { fromRoute = false } = {}) {
  const id = parseSceneId(input)
  if (!id) {
    urlInput.classList.add('error'); setTimeout(() => urlInput.classList.remove('error'), 500)
    if (fromRoute) showErr('Lien de scène invalide')
    return
  }
  const url = sceneUrlFromId(id)
  goBtn.disabled = true; errBar.classList.remove('visible')
  configEl.classList.add('out'); loadingEl.classList.add('visible')
  loadMsg.textContent = 'Chargement Spline…'
  try {
    const spline = await loadSpline(proxyUrl(url))
    currentSceneId = id
    if (!fromRoute && location.pathname !== `/s/${id}`) history.pushState({ id }, '', routeUrl(`/s/${id}`))
    loadMsg.textContent = 'Construction de la scène…'
    if (threeScene) { detachXR(threeScene); stopAllAudio() }
    threeScene = buildScene(spline)
    xrCanvas.classList.add('active')
    resize()
    renderer.setAnimationLoop(() => {
      updateControls(clock.getDelta())
      renderer.render(threeScene, camera)
      if (thumbRequest) takeThumbnail()
    })
    loadingEl.classList.remove('visible')
    hudEl.classList.add('visible')
    showShareBar(id)
    scheduleThumbnail(id)
    checkXR()
  } catch (err) {
    console.error('[SplineXR]', err)
    loadingEl.classList.remove('visible'); configEl.classList.remove('out')
    goBtn.disabled = false
    if (fromRoute) { urlInput.value = url; history.replaceState(null, '', routeUrl('/')) }
    showErr('Erreur : ' + (err.message || 'impossible de charger') +
      (fromRoute ? ' — la scène est-elle bien exportée en URL publique dans Spline ?' : ''))
  }
}

function closeScene() {
  renderer.setAnimationLoop(null)
  stopAllAudio()
  if (threeScene) detachXR(threeScene)
  xrCanvas.classList.remove('active'); hudEl.classList.remove('visible')
  btnVr.disabled = true; btnVr.textContent = '🥽 Entrer en VR'
  configEl.classList.remove('out'); goBtn.disabled = false; threeScene = null
  currentSceneId = null
  hideShareBar()
  debugEl.style.display = 'none'
}

btnReset.onclick = () => resetCamera()
btnBack.onclick = () => {
  if (renderer.xr.isPresenting) renderer.xr.getSession()?.end()
  closeScene()
  if (location.pathname !== '/') history.pushState(null, '', routeUrl('/'))
}

// Précédent / suivant du navigateur
window.addEventListener('popstate', () => {
  const id = sceneIdFromLocation()
  if (id && id !== currentSceneId) loadScene(id, { fromRoute: true })
  else if (!id && threeScene) closeScene()
})

// ── Aperçu du lien (image Open Graph) ────────────────────────────────────────
// À la première ouverture d'une scène sans aperçu, on photographie la vue
// initiale (1200×630) et on l'envoie à /api/thumb/<id> (Netlify Blobs).
const THUMB_W = 1200, THUMB_H = 630, THUMB_MAX = 480 * 1024
let thumbRequest = null   // { id, resolve } : capture à faire au prochain rendu

async function thumbnailExists(id) {
  const r = await fetch(`/api/thumb/${id}?exists=1`, { cache: 'no-store' })
  if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new Error('API indisponible')
  return (await r.json()).exists
}

// Capture au prochain rendu ; résout avec true si l'envoi a réussi
function requestThumbnail(id) {
  return new Promise(resolve => {
    if (renderer.xr.isPresenting || currentSceneId !== id) return resolve(false)
    thumbRequest = { id, resolve }
  })
}

function scheduleThumbnail(id) {
  thumbnailExists(id).then(exists => {
    if (exists) return
    // Laisse le temps aux textures de se charger
    setTimeout(() => { if (currentSceneId === id) requestThumbnail(id).then(ok => log('Aperçu créé:', ok)) }, 2500)
  }).catch(e => log('Aperçu ignoré:', e.message))
}

// Appelée dans la boucle, juste après renderer.render()
function takeThumbnail() {
  const { id, resolve } = thumbRequest
  thumbRequest = null
  if (renderer.xr.isPresenting || currentSceneId !== id) return resolve(false)
  const src = renderer.domElement
  const c = document.createElement('canvas'); c.width = THUMB_W; c.height = THUMB_H
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#06060f'; ctx.fillRect(0, 0, THUMB_W, THUMB_H)
  // Recadrage « cover » centré
  const k = Math.max(THUMB_W / src.width, THUMB_H / src.height)
  const w = src.width * k, h = src.height * k
  ctx.drawImage(src, (THUMB_W - w) / 2, (THUMB_H - h) / 2, w, h)
  uploadThumbnail(id, c).then(resolve, e => { warn('Aperçu non envoyé:', e.message); resolve(false) })
}

async function uploadThumbnail(id, canvas) {
  let blob = null
  for (const q of [0.85, 0.72, 0.6]) {
    blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', q))
    if (blob && blob.size <= THUMB_MAX) break
  }
  if (!blob || blob.size > THUMB_MAX) throw new Error('image trop lourde')
  const r = await fetch(`/api/thumb/${id}`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return true
}

// ── Bandeau « Lien de la scène » ─────────────────────────────────────────────
const shareBar  = document.getElementById('share-bar')
const shareLink = document.getElementById('share-url')
const shareCopy = document.getElementById('share-copy')
const shareThumb = document.getElementById('share-thumb')
shareThumb.onclick = async () => {
  if (!currentSceneId || shareThumb.disabled) return
  shareThumb.disabled = true; shareThumb.textContent = '…'
  const ok = await requestThumbnail(currentSceneId)
  shareThumb.textContent = ok ? '✓' : '✕'
  shareThumb.title = ok ? 'Aperçu mis à jour' : 'Échec : réessaie hors VR, une fois le site en ligne'
  setTimeout(() => { shareThumb.textContent = '📷'; shareThumb.title = 'Utiliser la vue actuelle comme aperçu du lien'; shareThumb.disabled = false }, 2500)
}

function showShareBar(id) {
  const link = shareUrl(id)
  shareLink.href = link
  shareLink.textContent = link.replace(/^https?:\/\//, '')
  shareCopy.textContent = 'Copier'; shareCopy.classList.remove('done')
  shareBar.classList.add('visible')
}
function hideShareBar() { shareBar.classList.remove('visible') }

shareCopy.onclick = async () => {
  if (!currentSceneId) return
  const link = shareUrl(currentSceneId)
  let ok = false
  try { await navigator.clipboard.writeText(link); ok = true } catch {}
  if (!ok) {
    // Presse-papiers indisponible : on sélectionne le lien pour un copier manuel
    const r = document.createRange(); r.selectNodeContents(shareLink)
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r)
  }
  shareCopy.textContent = ok ? '✓ Copié' : 'Ctrl+C'
  shareCopy.classList.toggle('done', ok)
  setTimeout(() => { shareCopy.textContent = 'Copier'; shareCopy.classList.remove('done') }, 2000)
}

// ── Ouverture directe d'un lien /s/<id> ──────────────────────────────────────
{
  const id = sceneIdFromLocation()
  if (id) {
    // ?scene=<id> est normalisé en /s/<id>
    if (!location.pathname.startsWith('/s/')) {
      const q = new URLSearchParams(location.search); q.delete('scene')
      const qs = q.toString()
      history.replaceState({ id }, '', `/s/${id}${qs ? '?' + qs : ''}`)
    }
    loadScene(id, { fromRoute: true })
  }
}

async function checkXR() {
  if (!navigator.xr) { btnVr.textContent = '🥽 WebXR non supporté'; return }
  const ok = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false)
  btnVr.disabled = false
  if (ok) { btnVr.textContent = '🥽 Entrer en VR'; btnVr.onclick = enterVR }
  else { btnVr.textContent = '🥽 Casque non détecté'; btnVr.title = 'Ouvre depuis le Meta Quest Browser'; btnVr.disabled = true }
}

async function enterVR() {
  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['bounded-floor', 'hand-tracking']
    })
    await renderer.xr.setSession(session)
    btnVr.textContent = '⏹ Quitter VR'
    session.addEventListener('end', () => { btnVr.textContent = '🥽 Entrer en VR'; btnVr.onclick = enterVR })
    btnVr.onclick = () => session.end()
  } catch (e) { showErr('Erreur VR : ' + (e.message || 'inconnue')) }
}
