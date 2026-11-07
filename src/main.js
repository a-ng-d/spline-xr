import SplineLoader from '@splinetool/loader'
import {
  WebGLRenderer, PerspectiveCamera, Scene, AmbientLight, DirectionalLight,
  Color, Clock, Vector3, Group, Raycaster, Box3,
  BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial,
  SphereGeometry, MeshBasicMaterial, Mesh, RingGeometry, Matrix4, CircleGeometry
} from 'three'

// ── Debug : ajouter ?debug à l'URL pour activer le HUD et les logs ──────────────
const DEBUG = new URLSearchParams(location.search).has('debug')
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
  if (!url.startsWith('http')) { urlInput.classList.add('error'); setTimeout(() => urlInput.classList.remove('error'), 500); return }
  const saved = getSaved(); if (!saved.includes(url)) { saved.push(url); setSaved(saved) }; renderMyScenes()
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
const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100000)
cameraRig.add(camera)
cameraRig.position.set(0, 160, 800)
const clock = new Clock()
let threeScene = null

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)

// ══════════════════════════════════════════════════════════════════════════════
// VISUELS DE POINTAGE
// Les scènes Spline sont en « pixels » (une carte fait ~300 unités) alors que
// les manettes sont en mètres : rayon, curseur et marqueur de téléport sont
// donc mis à l'échelle de la distance pour garder une taille apparente fixe.
// ══════════════════════════════════════════════════════════════════════════════
const RAY_IDLE_LENGTH = 300   // longueur du rayon sans cible (unités scène)
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
  speed: 300, snapAngle: Math.PI / 4, snapCooldown: 0, snapDelay: 0.35,
  deadzone: 0.25, teleportPending: false, teleportTarget: new Vector3(),
  origin: null, outOfBoundsRadius: 0, outOfBoundsShown: false, outOfBoundsTimer: 0,
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
  }
  ctrl.addEventListener('connected', e => {
    p.source = e.data
    model.group.visible = !e.data.hand
    log('Source connectée', i, e.data.handedness, e.data.hand ? 'main' : 'manette', e.data.targetRayMode)
  })
  ctrl.addEventListener('disconnected', () => {
    setHover(p, null)
    p.source = null; p.hit = null; p.entity = null; p.selecting = false; p.pressEntity = null
    ray.visible = false; cursor.group.visible = false
  })
  ctrl.addEventListener('selectstart', () => onSelectStart(p))
  ctrl.addEventListener('selectend',   () => onSelectEnd(p))
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
  p.selecting = true
  // Le rayon a pu ne pas encore être évalué ce frame-ci (pointeur transitoire)
  if (!p.hit && threeScene) { p.hit = fireRay(p.ctrl); p.entity = entityOf(p.hit) }
  p.pressEntity = p.entity
  if (p.entity) triggerEvent(p.entity, 'MouseDown')
}

function onSelectEnd(p) {
  p.selecting = false
  const pressed = p.pressEntity
  p.pressEntity = null
  if (!pressed) return
  triggerEvent(pressed, 'MouseUp')
  if (p.entity === pressed) triggerEvent(pressed, 'MousePress')
}

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

  // Out-of-bounds
  if (loco.origin && loco.outOfBoundsRadius > 0) {
    const dist = cameraRig.position.distanceTo(loco.origin)
    if (dist > loco.outOfBoundsRadius && !loco.outOfBoundsShown) { loco.outOfBoundsShown = true; showOutOfBounds() }
    else if (dist <= loco.outOfBoundsRadius) { loco.outOfBoundsShown = false; hideOutOfBounds() }
    if (loco.outOfBoundsShown) {
      loco.outOfBoundsTimer += dt
      if (loco.outOfBoundsTimer > 3) { resetCamera(); loco.outOfBoundsTimer = 0 }
    } else loco.outOfBoundsTimer = 0
  }

  for (const p of pointers) {
    const src = p.source
    if (!src) continue

    // 1. Rayon système → cible
    p.hit = fireRay(p.ctrl)
    p.entity = entityOf(p.hit)
    setHover(p, p.entity)
    updatePointerVisuals(p)

    // 2. Main : affichage des articulations
    if (src.hand) {
      p.handModel.group.visible = true
      updateHandModel(p.handModel, p.hand, p.selecting)
      continue
    }
    p.handModel.group.visible = false

    // 3. Manette : joysticks (déplacement, rotation, téléport)
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

  if (DEBUG && (++debugCounter % 20 === 0)) {
    debugLog(pointers.map(p => {
      if (!p.source) return `[${p.i}] —`
      const kind = p.source.hand ? 'main' : 'manette'
      const target = p.hit ? (p.hit.object.name || 'mesh') : 'rien'
      return `[${p.i}] ${p.source.handedness} ${kind} ${p.source.targetRayMode}\n    vise: ${target} | entité: ${p.entity?.name ?? '—'}${p.selecting ? ' | PRESS' : ''}`
    }).join('\n') + `\nmeshes: ${interactiveObjects.length} | survols: ${hoverCount.size}`)
  }
}

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
  pointers.forEach(p => { setHover(p, null); scene.remove(p.cursor.group) })
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
  if (!loco.origin) return
  cameraRig.position.copy(loco.origin); cameraRig.quaternion.copy(loco.originQuat)
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
  scene.add(splineScene)

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

  if (splineCam) {
    cameraRig.position.copy(splineCam.pos); cameraRig.quaternion.copy(splineCam.quat)
    camera.fov = splineCam.fov; camera.zoom = splineCam.zoom; camera.updateProjectionMatrix()
  } else {
    const box = new Box3().setFromObject(splineScene)
    const center = box.getCenter(new Vector3()), size = box.getSize(new Vector3())
    cameraRig.position.set(center.x, center.y, center.z + Math.max(size.x, size.y, size.z) * 1.5)
    cameraRig.quaternion.identity(); camera.fov = 45; camera.zoom = 1; camera.updateProjectionMatrix()
  }

  loco.origin = cameraRig.position.clone(); loco.originQuat = cameraRig.quaternion.clone()
  const sz = new Box3().setFromObject(splineScene).getSize(new Vector3())
  loco.outOfBoundsRadius = Math.max(sz.x, sz.y, sz.z) * 5

  attachXR(scene)
  return scene
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

async function loadScene(url) {
  if (!url.startsWith('http')) {
    urlInput.classList.add('error'); setTimeout(() => urlInput.classList.remove('error'), 500); return
  }
  goBtn.disabled = true; errBar.classList.remove('visible')
  configEl.classList.add('out'); loadingEl.classList.add('visible')
  loadMsg.textContent = 'Chargement Spline…'
  try {
    const spline = await loadSpline(proxyUrl(url))
    loadMsg.textContent = 'Construction de la scène…'
    if (threeScene) { detachXR(threeScene); stopAllAudio() }
    threeScene = buildScene(spline)
    xrCanvas.classList.add('active')
    resize()
    renderer.setAnimationLoop(() => {
      updateControls(clock.getDelta())
      renderer.render(threeScene, camera)
    })
    loadingEl.classList.remove('visible')
    hudEl.classList.add('visible')
    checkXR()
  } catch (err) {
    console.error('[SplineXR]', err)
    loadingEl.classList.remove('visible'); configEl.classList.remove('out')
    goBtn.disabled = false
    showErr('Erreur : ' + (err.message || 'impossible de charger'))
  }
}

btnReset.onclick = () => resetCamera()
btnBack.onclick = () => {
  renderer.setAnimationLoop(null)
  stopAllAudio()
  if (threeScene) detachXR(threeScene)
  xrCanvas.classList.remove('active'); hudEl.classList.remove('visible')
  btnVr.disabled = true; btnVr.textContent = '🥽 Entrer en VR'
  configEl.classList.remove('out'); goBtn.disabled = false; threeScene = null
  debugEl.style.display = 'none'
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
