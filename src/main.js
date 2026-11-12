import SplineLoader from '@splinetool/loader'
import {
  WebGLRenderer, PerspectiveCamera, Scene, AmbientLight, DirectionalLight,
  Color, Clock, Vector3, Group, Raycaster, Box3,
  BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial,
  SphereGeometry, MeshBasicMaterial, Mesh, RingGeometry, Matrix4, CircleGeometry,
  Euler, Quaternion
} from 'three'
import { readScenePath, scenePath, saveWork, sceneUrlFromId, fileUrlFromId } from './works.js'
import { initHome } from './home.js'
import { initI18n, t, setText, translateDom, mountLanguageSwitch } from './i18n.js'
import {
  playTransition, playTimeline, evaluateExpression, coerceForVariable,
  updateAnimations, stopAllAnimations,
} from './animate.js'

// ── URL parameters ─────────────────────────────────────────────────────────────
//   ?debug        HUD + logs
//   ?scale=0.002  scene scale (metres per Spline unit, default 0.001)
//   ?mode=spline  force the Spline runtime preview; ?mode=vr force the home-made engine
const PARAMS = new URLSearchParams(location.search)
const DEBUG = PARAMS.has('debug')
// Spline scenes are expressed in "pixels": at 1 unit = 1 mm, a 300-unit card
// is 30 cm wide and the Spline camera (≈ 800 units away) ends up within arm's
// reach. This is what makes poking and grabbing possible.
const WORLD_SCALE = parseFloat(PARAMS.get('scale')) || 0.001
const EYE_HEIGHT = 1.6        // assumed eye height in local-floor (m)
const MIN_SCALE = WORLD_SCALE / 20, MAX_SCALE = WORLD_SCALE * 20
const log  = (...a) => { if (DEBUG) console.log('[SplineXR]', ...a) }
const warn = (...a) => console.warn('[SplineXR]', ...a)


// ── DOM ────────────────────────────────────────────────────────────────────────
const configEl  = document.getElementById('config')
const loadingEl = document.getElementById('loading')
const loadMsg   = document.getElementById('load-msg')
const hudEl     = document.getElementById('hud')
const btnVr     = document.getElementById('btn-vr')
const btnBack   = document.getElementById('btn-back')
const goBtn     = document.getElementById('go-btn')
const errBar    = document.getElementById('err-bar')
const btnReset  = document.getElementById('btn-reset')
const xrCanvas  = document.getElementById('xr-canvas')
const bgCanvas  = document.getElementById('bg-canvas')

// Translations (EN / FR) are loaded before anything is rendered
await initI18n()
mountLanguageSwitch(document.getElementById('lang-slot'))
mountLanguageSwitch(hudEl)
// title attribute from a translation key (re-translated on language switch)
function setTitleKey(el, key) {
  if (!key) { delete el.dataset.i18nTitle; el.title = ''; return }
  el.dataset.i18nTitle = key
  el.title = t(key)
}

// ── Debug HUD ──────────────────────────────────────────────────────────────────
const debugEl = document.createElement('div')
debugEl.style.cssText = 'position:fixed;top:8px;left:8px;z-index:30;color:#0f0;font:11px monospace;background:rgba(0,0,0,.85);padding:8px 12px;border-radius:6px;pointer-events:none;display:none;max-width:400px;white-space:pre-wrap;line-height:1.4;'
document.body.appendChild(debugEl)
function debugLog(msg) { if (!DEBUG) return; debugEl.style.display = 'block'; debugEl.textContent = msg }

// ── Animated background ────────────────────────────────────────────────────────
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
// A scene = its link /s/<id>?t=<title>&f=<Spline file>: no database, the URL
// is the record (see works.js).
const KEEP_PARAMS = ['debug', 'scale', 'mode']   // kept from one page to the next
function routeUrl(path) {
  const qs = KEEP_PARAMS.filter(k => PARAMS.has(k))
    .map(k => PARAMS.get(k) ? `${k}=${encodeURIComponent(PARAMS.get(k))}` : k).join('&')
  return qs ? path + (path.includes('?') ? '&' : '?') + qs : path
}
const shareUrl = scene => location.origin + scenePath(scene)
const sceneFromLocation = () => readScenePath(location.href)
let currentScene = null   // { id, t, f }

// ── Engine selection ────────────────────────────────────────────────────────────
// No headset: official Spline runtime (exact rendering and interactions, with
// the mouse). Headset detected: home-made engine (loader + WebXR).
let xrSupport = null
async function hasHeadset() {
  const forced = PARAMS.get('mode')
  if (forced === 'vr') return true
  if (forced === 'spline') return false
  if (xrSupport === null) {
    xrSupport = !!(await navigator.xr?.isSessionSupported('immersive-vr').catch(() => false))
  }
  return xrSupport
}
let preview = null        // current Spline runtime preview
const sceneOpen = () => !!(threeScene || preview)

// Home: form, "Get started", "My creations"
const home = initHome({ onPlay: (scene, opts) => loadScene(scene, opts) })

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

// Container of the Spline scene: this is what gets scaled, moved and resized.
// The rig (the player) stays in metres.
const world = new Group()

// Initial viewpoint taken from the Spline camera: eye position (world), rig
// yaw, and the remaining tilt, used outside VR only.
const UP = new Vector3(0, 1, 0)
const view = {
  eye: new Vector3(0, EYE_HEIGHT, 1),   // world, scene at its default position
  eyeLocal: new Vector3(),              // same point in the scene frame
  yaw: 0, tilt: new Quaternion(),
}

// Places the rig so that the eyes land on view.eye. In VR, the headset already
// adds the head height (local-floor): it is removed from the rig.
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
// As the scene can be scaled up or down, the ray, cursor and teleport marker
// are scaled with distance to keep a constant apparent size.
// apparente fixe.
// ══════════════════════════════════════════════════════════════════════════════
const RAY_IDLE_LENGTH = 4     // ray length without a target (m)
const CURSOR_ANGULAR  = 0.012 // cursor size ≈ 0.7° of field of view

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
  sceneSize: 0,          // largest dimension of the scene, in Spline units
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

// ── Hand model (joints) ───────────────────────────────────────────────────────
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
// Joints are children of the hand object (same frame as the rig): their local
// position is simply copied.
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
// One pointer per input source (controller OR hand). The ray is the
// targetRaySpace provided by the system: on Quest, this is Meta's official
// hand ray (shoulder → pinch), stable and precise. Clicks go through the native
// WebXR selectstart/selectend events, fired by the trigger as well as by the
// thumb-index pinch.
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
    poking: null,                          // entity touched with the finger
    grabbing: false, grabPrev: null,       // scene grab
    squeezing: false, selectGrab: false,   // what started the grab (grip / pinch)
  }
  ctrl.addEventListener('connected', e => {
    p.source = e.data
    model.group.visible = !e.data.hand
    log('Source connected', i, e.data.handedness, e.data.hand ? 'hand' : 'controller', e.data.targetRayMode)
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
  // Controller grip button: grabs the scene, whatever the target
  ctrl.addEventListener('squeezestart', () => { p.squeezing = true; setGrab(p, true) })
  ctrl.addEventListener('squeezeend',   () => { p.squeezing = false; if (!p.selectGrab) setGrab(p, false) })
  return p
})

// ══════════════════════════════════════════════════════════════════════════════
// EVENT SYSTEM — running Spline events
// The loader stores events in entity.data.events (Map-like collection:
// .forEach() but neither .length nor Symbol.iterator). Same for actions and tweens.
// ══════════════════════════════════════════════════════════════════════════════
let splineContext = null          // { scene, shared }: context expected by the loader
let meshToEntity = new Map()      // mesh uuid → Spline entity carrying the events
let interactiveObjects = []
const hoverCount = new Map()      // entity → number of pointers hovering it

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
  log('Meshes:', interactiveObjects.length, '| Interactive entities:', withEvents.length)
  withEvents.forEach(e => log('  →', e.name, getEventsArray(e).map(ev => (ev?.data ?? ev)?.type)))
}

// Interactive entity hit (null if the first object hit has no event: occlusion
// is respected)
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
// The loader ships Howler: shared.getAudio(id) returns a player
// (play / pause / stop, volume, loop, delay).
function getSound(id) {
  const shared = splineContext?.shared
  if (!id || !shared?.getAudio || !shared.audios?.[id]) return null
  try { return shared.getAudio(id) } catch (e) { warn('Audio not found:', id, e.message); return null }
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
    // Without an explicit target, every sound of the scene is stopped
    const list = targets.length ? targets : Object.keys(splineContext?.shared?.audios ?? {}).map(getSound).filter(Boolean)
    list.forEach(s => a.interaction === 'pause' ? s.pause() : s.stop())
    log('Audio', a.interaction, ids.join(',') || 'all')
  }
}

function stopAllAudio() {
  const audios = splineContext?.shared?.audios
  if (!audios) return
  Object.values(audios).forEach(s => { try { s?.stop?.() } catch {} })
}

// ── Running actions ──────────────────────────────────────────────────────────
// phase: 'in' (hover start), 'out' (hover end) or undefined (click)
// Actions that handle their own delay
const SELF_DELAYED = new Set(['Audio', 'Transition', 'TimelineAnimation'])

function runActions(actions, phase) {
  if (!actions || !splineContext) return
  for (const action of toArray(actions)) {
    const a = action?.data ?? action
    if (!a || a.disabled) continue
    const run = () => { try { runAction(a, phase) } catch (e) { warn('Action', a.type, ':', e.message) } }
    if (!SELF_DELAYED.has(a.type) && a.delay > 0 && phase !== 'out') setTimeout(run, a.delay)
    else run()
  }
}

function runAction(a, phase) {
  if (a.type === 'Transition') {
    const target = splineContext.entityByUuid?.get(a.object)
    if (!target) { warn('Transition target not found:', a.object); return }
    log('Transition →', target.name, '| phase:', phase ?? 'click')
    // Animated: duration, delay, easing, repeat (animate.js)
    playTransition(a, target, phase, splineContext, toArray)

  } else if (a.type === 'Audio') {
    // Ending a hover does not restart a sound started on hover start
    if (phase !== 'out') runAudioAction(a)

  } else if (a.type === 'Conditional') {
    // Like the runtime: empty or unreadable expression → no branch
    let ok
    try { ok = evaluateExpression(a.condition, splineContext.shared) } catch (e) { warn('Unreadable condition:', e.message) }
    if (ok === undefined) return
    log('Condition →', !!ok)
    runActions(ok ? a.ifActions : a.elseActions, phase)

  } else if (a.type === 'SetVariable') {
    if (phase === 'out') return
    setVariable(a.variableId, a.expression)

  } else if (a.type === 'TimelineAnimation') {
    if (phase === 'out') return
    playTimeline(a, {
      root: splineContext.scene, entityByUuid: splineContext.entityByUuid, toArray, log, warn,
    })

  } else if (a.type === 'OpenUrl' || a.type === 'URL' || a.type === 'Link') {
    const url = a.url || a.value || a.link
    if (url && phase !== 'out') window.open(url, '_blank', 'noopener')
  } else {
    log('Unsupported action:', a.type, a)
  }
}

// ── Variables ────────────────────────────────────────────────────────────────
let variableDepth = 0
function setVariable(id, expression) {
  const shared = splineContext?.shared
  if (!id || !shared?.updateVariable) return
  let value
  try { value = evaluateExpression(expression, shared) } catch (e) { warn('Unreadable expression:', e.message); return }
  if (value === undefined) return
  let current
  try { current = shared.getVariable(id) } catch { current = undefined }
  try { shared.updateVariable(id, coerceForVariable(current, value)) } catch (e) { warn('Variable', id, ':', e.message); return }
  log('Variable', id, '=', value)
  // "Variable Change" events (guard against loops)
  if (variableDepth > 8) return
  variableDepth++
  try {
    for (const [, entity] of splineContext.entityByUuid) {
      for (const evt of getEventsArray(entity)) {
        const e = evt?.data ?? evt
        if (e?.type === 'VariableChange' && e.variableId === id && !e.disabled) runActions(e.actions, undefined)
      }
    }
  } finally { variableDepth-- }
}

function triggerEvent(entity, eventType, phase) {
  if (!entity) return
  for (const evt of getEventsArray(entity)) {
    const e = evt?.data ?? evt
    if (!e) continue
    if ((e.type ?? evt.type) !== eventType) continue
    if (e.disabled || evt.disabled) continue
    log('▶', eventType, phase ?? '', 'on', entity.name)
    runActions(e.actions ?? evt.actions, phase)
  }
}

// ── Hover: counted per entity so that two pointers do not contradict each other
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

// ── Click: trigger or pinch ──────────────────────────────────────────────────
function onSelectStart(p) {
  if (!threeScene) return
  p.selecting = true
  // The ray may not have been evaluated yet this frame (transient pointer)
  if (!p.hit) { p.hit = fireRay(p.ctrl); p.entity = entityOf(p.hit) }
  if (p.poking) return            // the finger is already touching: the poke handles it
  if (p.entity) {
    p.pressEntity = p.entity
    triggerEvent(p.entity, 'MouseDown')
  } else {
    // Pinch / trigger in empty space: grab the scene
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

// ── Poke: index fingertip contact ────────────────────────────────────────────
// A short ray is cast from the last phalanx towards the fingertip, extended
// by a few millimetres. Releasing needs a larger withdrawal (hysteresis) to
// avoid double triggers.
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

// ── Scene grab ───────────────────────────────────────────────────────────────
// One hand: the scene follows the hand. Two hands: moving the hands apart /
// together scales the scene up / down around their midpoint.
const grab = { count: 0, prevDist: 0 }
const _ga = new Vector3(), _gb = new Vector3(), _gmid = new Vector3(), _gd = new Vector3()

function setGrab(p, on) {
  p.grabbing = on
  p.grabPrev = null
  grab.count = -1                // forces a reset on the next frame
}

function updateWorldGrab() {
  const grabbers = pointers.filter(p => p.grabbing && p.source)
  if (grabbers.length !== grab.count) {
    grabbers.forEach(p => { p.grabPrev = null })
    grab.prevDist = 0
    grab.count = grabbers.length
  }
  if (grabbers.length === 1) {
    // Hand position in the rig frame: no feedback loop when the rig moves.
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

// ── Pointer visuals ──────────────────────────────────────────────────────────
function updatePointerVisuals(p) {
  const { ray, cursor, hit } = p
  const active = !!p.source && p.source.targetRayMode !== 'screen'
  ray.visible = active
  cursor.group.visible = active && !!hit
  if (!active) return
  ray.scale.z = hit ? hit.distance : RAY_IDLE_LENGTH
  ray.material.opacity = p.entity ? 0.85 : 0.4
  if (hit) {
    // Cursor at the hit point, facing the camera, constant apparent size
    cursor.group.position.copy(hit.point)
    renderer.xr.getCamera().getWorldPosition(_camPos)
    cursor.group.lookAt(_camPos)
    const s = hit.distance * CURSOR_ANGULAR * (p.selecting ? 0.7 : 1) * (p.entity ? 1.3 : 1)
    cursor.group.scale.setScalar(s)
    cursor.ringMat.opacity = p.entity ? 1 : 0.5
  }
}

// ── Controls loop ─────────────────────────────────────────────────────────────
let debugCounter = 0
function updateControls(dt) {
  if (!renderer.xr.isPresenting) return
  const xrCam = renderer.xr.getCamera()
  xrCam.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize()
  _right.set(_fwd.z, 0, -_fwd.x)
  loco.snapCooldown = Math.max(0, loco.snapCooldown - dt)

  // Out-of-bounds: distance to the initial viewpoint, tracked in the scene frame
  // (the scene may have been moved or resized)
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

    // 1. Hand: finger contact comes before the ray
    if (src.hand) updatePoke(p)

    // 2. System ray → target (hidden while touching)
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

    // 3. Hand: draw the joints
    if (src.hand) {
      p.handModel.group.visible = true
      updateHandModel(p.handModel, p.hand, p.selecting)
      continue
    }
    p.handModel.group.visible = false

    // 4. Controller: thumbsticks (move, turn, teleport)
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
        // Thumbstick pushed forward: aim at the teleport point
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

    // Controller visual feedback
    const tv = gp.buttons[0]?.value ?? 0
    p.model.triggerLight.material.opacity = tv * 0.8
    p.model.stick.rotation.x = jy * 0.25
    p.model.stick.rotation.z = -jx * 0.25
  }

  // 5. Scene grab (one or two hands)
  updateWorldGrab()

  if (DEBUG && (++debugCounter % 20 === 0)) {
    debugLog(pointers.map(p => {
      if (!p.source) return `[${p.i}] —`
      const kind = p.source.hand ? 'hand' : 'controller'
      const target = p.poking ? 'contact' : p.hit ? (p.hit.object.name || 'mesh') : 'nothing'
      const flags = [p.selecting && 'PRESS', p.poking && 'POKE', p.grabbing && 'GRAB'].filter(Boolean).join(' ')
      return `[${p.i}] ${p.source.handedness} ${kind} ${p.source.targetRayMode}\n    aim: ${target} | entity: ${p.entity?.name ?? '—'} ${flags}`
    }).join('\n') + `\nmeshes: ${interactiveObjects.length} | hovers: ${hoverCount.size} | scale: ${(world.scale.x * 1000).toFixed(2)} mm/u`)
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
oobOverlay.innerHTML = `<div style="font-size:28px">🧭</div><div style="font-size:16px;font-weight:600;color:#e8e8f0" data-i18n="oob.title"></div><div style="font-size:13px;color:#7a7a95" data-i18n="oob.auto"></div><button id="oob-reset-btn" style="margin-top:4px;padding:10px 22px;border-radius:100px;border:1px solid rgba(123,110,246,.5);background:rgba(123,110,246,.2);color:#7b6ef6;font-size:13px;font-weight:600;cursor:pointer;" data-i18n="oob.back"></button>`
translateDom(oobOverlay)
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

// ── Spline camera ────────────────────────────────────────────────────────────
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
  log('Camera:', best.name, '| pos:', pos.toArray().map(v => Math.round(v)), '| fov:', fov)
  return { pos, quat, fov, zoom }
}

// ══════════════════════════════════════════════════════════════════════════════
// SCENE + LOADING
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

  // The Spline scene goes into the scaled container
  world.clear()
  resetWorld()
  world.add(splineScene)
  scene.add(world)
  collectLights(splineScene)
  applyLightScale()

  // Context in the shape expected by loader entities: { shared, scene }
  const shared = splineScene.sharedAssets ?? splineScene._sharedAssets ?? null
  if (!shared) warn('sharedAssets not found: transitions and audio limited')
  splineContext = { scene: splineScene, shared, entityByUuid: new Map() }
  collectObjects(splineScene)
  // Variables bound to object properties: the loader needs a context
  // { scene.find(uuid), shared } that it never creates itself
  if (typeof splineScene.find !== 'function') splineScene.find = id => splineContext.entityByUuid.get(id)
  try { shared?.setEntityOpContext?.(splineContext) } catch (e) { warn('Variable context:', e.message) }

  // Start events (including background music)
  setTimeout(() => {
    if (!splineContext) return
    for (const [, entity] of splineContext.entityByUuid) {
      if (hasEvents(entity)) triggerEvent(entity, 'Start')
    }
  }, 200)

  // Viewpoint: position and orientation of the Spline camera (Spline units, the
  // scene is not scaled yet when they are read)
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

  // In VR, only the yaw is applied to the rig (the floor must stay level);
  // pitch and roll are only used for the non-VR view.
  const e = new Euler().setFromQuaternion(quat, 'YXZ')
  view.yaw = e.y
  view.tilt.setFromEuler(new Euler(e.x, 0, e.z, 'YXZ'))
  world.updateMatrixWorld(true)
  view.eye.copy(view.eyeLocal).applyMatrix4(world.matrixWorld)
  placeRig()

  const sz = new Box3().setFromObject(splineScene).getSize(new Vector3()).divideScalar(WORLD_SCALE)
  loco.sceneSize = Math.max(sz.x, sz.y, sz.z)
  log('Scale:', WORLD_SCALE, 'm/u | scene size:', Math.round(loco.sceneSize), 'u ≈', (loco.sceneSize * WORLD_SCALE).toFixed(2), 'm')

  attachXR(scene)
  return scene
}

// ── Lights: attenuation distances do not follow the parent's scale, so they
// are recomputed to keep the lighting authored in Spline.
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

// scene: { id, t, f }. fromRoute: opened from the page address (do not rewrite
// history). save: store in My creations (editKey = the creation being edited).
async function loadScene(scene, { fromRoute = false, save = false, editKey = null } = {}) {
  scene = scene?.id ? readScenePath(scenePath(scene)) : null   // normalises title and file
  if (!scene) { showErr(t('errors.invalidLink')); return }
  goBtn.disabled = true; errBar.classList.remove('visible')
  configEl.classList.add('out'); loadingEl.classList.add('visible')
  setText(loadMsg, 'loading.spline')
  try {
    const headset = await hasHeadset()
    const src = proxyUrl(sceneUrlFromId(scene.id))
    let spline = null, nextPreview = null
    if (headset) spline = await loadSpline(src)
    else {
      // Loaded on demand: the headset never needs the Spline runtime
      const { createSplinePreview } = await import('./spline-preview.js')
      nextPreview = await createSplinePreview(src, document.body)
    }
    currentScene = scene
    if (save) { saveWork({ key: editKey, scene }); home.resetForm() }
    const url = routeUrl(scenePath(scene))
    if (!fromRoute && location.pathname + location.search !== url) history.pushState(null, '', url)
    // Scene title in the tab (removed from automatic translation while the scene is open)
    const titleEl = document.querySelector('title')
    if (scene.t) { setText(titleEl, ''); document.title = `${scene.t} — SplineXR` }
    else setText(titleEl, 'home.pageTitle')
    setText(loadMsg, 'loading.build')
    teardownEngines()
    if (headset) {
      threeScene = buildScene(spline)
      xrCanvas.classList.add('active')
      resize()
      renderer.setAnimationLoop(() => {
        updateControls(clock.getDelta())
        updateAnimations(performance.now())
        renderer.render(threeScene, camera)
        if (thumbRequest) takeThumbnail()
      })
      btnReset.hidden = false
      checkXR()
    } else {
      preview = nextPreview
      btnReset.hidden = true   // the camera is the Spline scene's
      btnVr.disabled = true
      setText(btnVr, 'hud.preview')
      setTitleKey(btnVr, 'hud.previewTitle')
    }
    loadingEl.classList.remove('visible')
    hudEl.classList.add('visible')
    showShareBar(scene)
    scheduleThumbnail(scene.id)
  } catch (err) {
    console.error('[SplineXR]', err)
    loadingEl.classList.remove('visible'); configEl.classList.remove('out')
    goBtn.disabled = false
    if (fromRoute) { history.replaceState(null, '', routeUrl('/')); home.editScene(scene) }
    showErr(t(fromRoute ? 'errors.notPublic' : 'errors.load', { message: err.message || t('errors.loadDefault') }))
  }
}

// Stops the current engine, whichever it is
function teardownEngines() {
  renderer.setAnimationLoop(null)
  if (threeScene) { detachXR(threeScene); stopAllAudio(); stopAllAnimations(); threeScene = null }
  xrCanvas.classList.remove('active')
  if (preview) { preview.dispose(); preview = null }
  thumbRequest?.resolve(false); thumbRequest = null
}

function closeScene() {
  teardownEngines()
  hudEl.classList.remove('visible')
  btnVr.disabled = true; setText(btnVr, 'hud.enterVr'); setTitleKey(btnVr, '')
  configEl.classList.remove('out'); goBtn.disabled = false; threeScene = null
  currentScene = null
  setText(document.querySelector('title'), 'home.pageTitle')
  hideShareBar()
  debugEl.style.display = 'none'
}

btnReset.onclick = () => resetCamera()
function goHome() {
  if (renderer.xr.isPresenting) renderer.xr.getSession()?.end()
  closeScene()
  if (location.pathname !== '/') history.pushState(null, '', routeUrl('/'))
}
btnBack.onclick = goHome

// "Edit": back to the home page with the scene in the form; when it was opened
// from a link, saving it adds it to My creations.
const btnEdit = document.createElement('button')
btnEdit.className = 'hud-btn'; btnEdit.id = 'btn-edit'; setText(btnEdit, 'hud.edit')
btnBack.after(btnEdit)
btnEdit.onclick = () => { const s = currentScene; goHome(); if (s) home.editScene(s) }

// Browser back / forward
window.addEventListener('popstate', () => {
  const s = sceneFromLocation()
  if (s && s.id !== currentScene?.id) loadScene(s, { fromRoute: true })
  else if (s && sceneOpen()) { currentScene = s; showShareBar(s) }
  else if (!s && sceneOpen()) closeScene()
})

// ── Link preview (Open Graph image) ──────────────────────────────────────────
// The first time a scene without a preview is opened, the initial view is
// captured (1200×630) and sent to /api/thumb/<id> (Netlify Blobs).
const THUMB_W = 1200, THUMB_H = 630, THUMB_MAX = 480 * 1024
let thumbRequest = null   // { id, resolve }: capture to take on the next render

async function thumbnailExists(id) {
  const r = await fetch(`/api/thumb/${id}?exists=1`, { cache: 'no-store' })
  if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new Error('API indisponible')
  return (await r.json()).exists
}

// Captures on the next render; resolves with true if the upload succeeded
function requestThumbnail(id) {
  return new Promise(resolve => {
    if (renderer.xr.isPresenting || currentScene?.id !== id) return resolve(false)
    // Spline runtime: preserved buffer, immediate capture
    if (preview) return captureCanvas(id, preview.canvas, resolve)
    // Home-made engine: on the next render (WebGL buffer not preserved)
    thumbRequest = { id, resolve }
  })
}

function scheduleThumbnail(id) {
  thumbnailExists(id).then(exists => {
    if (exists) return
    // Gives textures time to load
    setTimeout(() => { if (currentScene?.id === id) requestThumbnail(id).then(ok => log('Preview created:', ok)) }, 2500)
  }).catch(e => log('Preview skipped:', e.message))
}

// Called in the loop, right after renderer.render()
function takeThumbnail() {
  const { id, resolve } = thumbRequest
  thumbRequest = null
  if (renderer.xr.isPresenting || currentScene?.id !== id) return resolve(false)
  captureCanvas(id, renderer.domElement, resolve)
}

function captureCanvas(id, src, resolve) {
  if (!src.width || !src.height) return resolve(false)
  const c = document.createElement('canvas'); c.width = THUMB_W; c.height = THUMB_H
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#06060f'; ctx.fillRect(0, 0, THUMB_W, THUMB_H)
  // Centred "cover" crop
  const k = Math.max(THUMB_W / src.width, THUMB_H / src.height)
  const w = src.width * k, h = src.height * k
  ctx.drawImage(src, (THUMB_W - w) / 2, (THUMB_H - h) / 2, w, h)
  uploadThumbnail(id, c).then(resolve, e => { warn('Preview not uploaded:', e.message); resolve(false) })
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

// ── "Scene link" bar ─────────────────────────────────────────────────────────
const shareBar  = document.getElementById('share-bar')
const shareLink = document.getElementById('share-url')
const shareCopy = document.getElementById('share-copy')
const shareThumb = document.getElementById('share-thumb')
shareThumb.onclick = async () => {
  if (!currentScene || shareThumb.disabled) return
  shareThumb.disabled = true; shareThumb.textContent = '…'
  const ok = await requestThumbnail(currentScene.id)
  shareThumb.textContent = ok ? '✓' : '✕'
  setTitleKey(shareThumb, ok ? 'share.thumbDone' : 'share.thumbFailed')
  setTimeout(() => { shareThumb.textContent = '📷'; setTitleKey(shareThumb, 'share.thumbTitle'); shareThumb.disabled = false }, 2500)
}

const shareLabel  = document.getElementById('share-label')
const shareSource = document.getElementById('share-source')
function showShareBar(scene) {
  const link = shareUrl(scene)
  if (scene.t) { setText(shareLabel, ''); shareLabel.textContent = scene.t }
  else setText(shareLabel, 'share.label')
  shareLabel.title = scene.t || ''
  shareSource.hidden = !scene.f
  if (scene.f) shareSource.href = fileUrlFromId(scene.f)
  shareLink.href = link
  shareLink.textContent = link.replace(/^https?:\/\//, '')
  setText(shareCopy, 'share.copy'); shareCopy.classList.remove('done')
  shareBar.classList.add('visible')
}
function hideShareBar() { shareBar.classList.remove('visible') }

shareCopy.onclick = async () => {
  if (!currentScene) return
  const link = shareUrl(currentScene)
  let ok = false
  try { await navigator.clipboard.writeText(link); ok = true } catch {}
  if (!ok) {
    // Clipboard unavailable: select the link for a manual copy
    const r = document.createRange(); r.selectNodeContents(shareLink)
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r)
  }
  setText(shareCopy, ok ? 'share.copied' : 'share.copyManual')
  shareCopy.classList.toggle('done', ok)
  setTimeout(() => { setText(shareCopy, 'share.copy'); shareCopy.classList.remove('done') }, 2000)
}

// ── Opening a /s/<id> link directly ──────────────────────────────────────────
{
  const s = sceneFromLocation()
  if (s) {
    // ?scene=<URL or id> is normalised to /s/<id>
    if (!location.pathname.startsWith('/s/')) history.replaceState(null, '', routeUrl(scenePath(s)))
    loadScene(s, { fromRoute: true })
  }
}

async function checkXR() {
  setTitleKey(btnVr, '')
  if (!navigator.xr) { setText(btnVr, 'hud.noWebxr'); return }
  const ok = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false)
  btnVr.disabled = false
  if (ok) { setText(btnVr, 'hud.enterVr'); btnVr.onclick = enterVR }
  else { setText(btnVr, 'hud.noHeadset'); setTitleKey(btnVr, 'hud.noHeadsetTitle'); btnVr.disabled = true }
}

async function enterVR() {
  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['bounded-floor', 'hand-tracking']
    })
    await renderer.xr.setSession(session)
    setText(btnVr, 'hud.exitVr')
    session.addEventListener('end', () => { setText(btnVr, 'hud.enterVr'); btnVr.onclick = enterVR })
    btnVr.onclick = () => session.end()
  } catch (e) { showErr(t('errors.vr', { message: e.message || t('errors.unknown') })) }
}
