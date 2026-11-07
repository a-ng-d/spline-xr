import SplineLoader from '@splinetool/loader'
import {
  WebGLRenderer, PerspectiveCamera, Scene, AmbientLight, DirectionalLight,
  Color, Clock, Vector3, Group, Raycaster, Box3,
  BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial,
  SphereGeometry, MeshBasicMaterial, Mesh, RingGeometry, Matrix4
} from 'three'

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
function debugLog(msg) { debugEl.style.display = 'block'; debugEl.textContent = msg }

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
// CONTRÔLES VR
// ══════════════════════════════════════════════════════════════════════════════
function makeRayLine(color = 0x7b6ef6) {
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute([0,0,0, 0,0,-50], 3))
  return new Line(geo, new LineBasicMaterial({ color, transparent: true, opacity: 0.6 }))
}
function makeTeleportMarker() {
  const g = new Group()
  g.add(new Mesh(new RingGeometry(0.15, 0.22, 32), new MeshBasicMaterial({ color: 0x3ecfcf, transparent: true, opacity: 0.85, side: 2 })))
  g.children[0].rotation.x = -Math.PI / 2
  g.add(new Mesh(new SphereGeometry(0.05, 16, 16), new MeshBasicMaterial({ color: 0xffffff })))
  g.visible = false; return g
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
  return { group: g, stick, triggerLight, accentMat }
}

const controllers = [0, 1].map(i => {
  const ctrl = renderer.xr.getController(i)
  const grip = renderer.xr.getControllerGrip(i)
  const model = createControllerModel(i); grip.add(model.group)
  const ray = makeRayLine(i === 0 ? 0x7b6ef6 : 0x3ecfcf); ctrl.add(ray)
  // Dot cursor — sphère au point d'impact
  const dot = new Mesh(new SphereGeometry(0.012, 8, 8), new MeshBasicMaterial({ color: 0xffffff }))
  dot.visible = false; ctrl.add(dot)
  return { ctrl, grip, ray, dot, side: i, triggerPrev: false, model }
})

// ── Hand tracking ────────────────────────────────────────────────────────────
const FINGER_JOINTS = [
  ['thumb-metacarpal','thumb-phalanx-proximal','thumb-phalanx-distal','thumb-tip'],
  ['index-finger-metacarpal','index-finger-phalanx-proximal','index-finger-phalanx-intermediate','index-finger-phalanx-distal','index-finger-tip'],
  ['middle-finger-metacarpal','middle-finger-phalanx-proximal','middle-finger-phalanx-intermediate','middle-finger-phalanx-distal','middle-finger-tip'],
  ['ring-finger-metacarpal','ring-finger-phalanx-proximal','ring-finger-phalanx-intermediate','ring-finger-phalanx-distal','ring-finger-tip'],
  ['pinky-finger-metacarpal','pinky-finger-phalanx-proximal','pinky-finger-phalanx-intermediate','pinky-finger-phalanx-distal','pinky-finger-tip'],
]
function createHandModel(side) {
  const group = new Group()
  const matBone = new MeshBasicMaterial({ color: side === 0 ? 0x7b6ef6 : 0x3ecfcf, transparent: true, opacity: 0.75 })
  const matTip = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
  const jointMeshes = {}
  ;[...new Set(FINGER_JOINTS.flat().concat(['wrist']))].forEach(name => {
    const isTip = name.endsWith('-tip'), r = isTip ? 0.007 : name === 'wrist' ? 0.012 : 0.006
    const mesh = new Mesh(new SphereGeometry(r, 8, 6), isTip ? matTip : matBone)
    mesh.visible = false; group.add(mesh); jointMeshes[name] = mesh
  })
  const boneMeshes = []
  FINGER_JOINTS.forEach(finger => {
    finger.forEach((jName, idx) => {
      if (idx === 0) return
      const bone = new Mesh(new SphereGeometry(0.003, 6, 4), matBone.clone())
      bone.visible = false; group.add(bone)
      boneMeshes.push({ mesh: bone, from: finger[idx-1], to: jName })
    })
  })
  return { group, jointMeshes, boneMeshes, matBone, matTip }
}
const _bF = new Vector3(), _bT = new Vector3(), _bM = new Vector3()
function updateHandModel(model, joints, isPinching) {
  if (!joints) return
  for (const [name, mesh] of Object.entries(model.jointMeshes)) {
    const j = joints[name]
    if (j) { mesh.position.setFromMatrixPosition(j.matrixWorld); mesh.position.sub(model.group.getWorldPosition(new Vector3())); mesh.visible = true }
    else mesh.visible = false
  }
  model.boneMeshes.forEach(({ mesh, from, to }) => {
    const jF = joints[from], jT = joints[to]
    if (!jF || !jT) { mesh.visible = false; return }
    _bF.setFromMatrixPosition(jF.matrixWorld); _bT.setFromMatrixPosition(jT.matrixWorld)
    const off = model.group.getWorldPosition(new Vector3()); _bF.sub(off); _bT.sub(off)
    _bM.addVectors(_bF, _bT).multiplyScalar(0.5); mesh.position.copy(_bM)
    mesh.scale.set(1, _bF.distanceTo(_bT) * 60, 1); mesh.visible = true
  })
  const iT = model.jointMeshes['index-finger-tip'], tT = model.jointMeshes['thumb-tip']
  if (iT) iT.material.color.setHex(isPinching ? 0x3ecfcf : 0xffffff)
  if (tT) tT.material.color.setHex(isPinching ? 0x3ecfcf : 0xffffff)
}
const hands = [0, 1].map(i => {
  const hand = renderer.xr.getHand(i)
  const model = createHandModel(i); hand.add(model.group)
  const ray = makeRayLine(i === 0 ? 0x7b6ef6 : 0x3ecfcf); ray.visible = false; hand.add(ray)
  const dot = new Mesh(new SphereGeometry(0.008, 8, 8), new MeshBasicMaterial({ color: 0x3ecfcf }))
  dot.visible = false; hand.add(dot)
  return { hand, model, ray, dot, side: i, pinchPrev: false }
})

// ══════════════════════════════════════════════════════════════════════════════
// EVENT SYSTEM — Spline Loader Event Runner
// Le loader Spline stocke les events dans entity.data.events (collection
// Map-like : .forEach() mais ni .length ni Symbol.iterator). Idem pour
// actions et tweens. On exécute les Transitions via changeSelectedState.
// ══════════════════════════════════════════════════════════════════════════════
const raycaster = new Raycaster()
const _mat = new Matrix4(), _origin = new Vector3(), _dir = new Vector3()
const _fwd = new Vector3(), _right = new Vector3()

let splineContext = null // { scene, shared, _entityByUuid }
let meshToEntity = new Map() // mesh uuid → Spline entity with events
let interactiveObjects = []
let currentHoveredUuid = null

// Convertit les collections Spline (Map-like), arrays ou iterables en Array
function toArray(thing) {
  if (!thing) return []
  if (Array.isArray(thing)) return thing
  if (typeof thing.forEach === 'function') {
    const arr = []; thing.forEach(item => arr.push(item)); return arr
  }
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
    meshToEntity.set(obj.uuid, obj)
  })

  if (splineContext) splineContext._entityByUuid = entityByUuid

  const withEvents = [...new Set(meshToEntity.values())].filter(hasEvents)
  console.log('[SplineXR] Meshes:', interactiveObjects.length, '| Entités avec events:', withEvents.length)
  withEvents.forEach(e => {
    const types = getEventsArray(e).map(ev => (ev?.data ?? ev)?.type)
    console.log('  →', e.name, types)
  })
}

function fireRay(source) {
  _mat.extractRotation(source.matrixWorld)
  _origin.setFromMatrixPosition(source.matrixWorld)
  _dir.set(0, 0, -1).applyMatrix4(_mat).normalize()
  raycaster.set(_origin, _dir)
  const hits = raycaster.intersectObjects(interactiveObjects, true)
  return hits.length ? hits[0] : null
}

// ── Action runner ────────────────────────────────────────────────────────────
function runActions(actions) {
  if (!actions || !splineContext) return
  for (const action of toArray(actions)) {
    const a = action?.data ?? action
    if (!a) continue

    if (a.type === 'Transition') {
      const target = splineContext._entityByUuid?.get(a.object)
      if (!target) { console.warn('[SplineXR] Transition target not found:', a.object); continue }

      // Tweens : [0] = état de départ (souvent null = base), [1] = état cible
      const states = toArray(a.tweens).map(tw => {
        const d = tw?.data ?? tw
        return d?.state !== undefined ? d.state : undefined
      }).filter(s => s !== undefined)

      let stateId = null
      if (states.length >= 2) {
        const currentState = target._currentXRState ?? null
        const fromState = states[0]
        const toState = states[states.length - 1]
        stateId = currentState === toState ? fromState : toState
        target._currentXRState = stateId
      } else if (states.length === 1) {
        stateId = states[0]
      }

      console.log('[SplineXR] Transition →', target.name, '| state:', stateId, '| states:', JSON.stringify(states))
      try { target.changeSelectedState(stateId, splineContext, true) }
      catch(e) { console.warn('[SplineXR] changeSelectedState:', e.message) }

    } else if (a.type === 'Conditional') {
      if (a.ifActions) runActions(a.ifActions)

    } else if (a.type === 'SetVariable') {
      if (splineContext.shared && a.variable !== undefined) {
        try { splineContext.shared.updateVariable(a.variable, a.value) }
        catch(e) { console.warn('[SplineXR] SetVariable:', e.message) }
      }
    } else if (a.type === 'OpenUrl' || a.type === 'URL') {
      const url = a.url || a.value
      if (url) window.open(url, '_blank')
    } else {
      console.log('[SplineXR] Action non gérée:', a.type, a)
    }
  }
}

function triggerEvent(entity, eventType) {
  if (!entity) return
  for (const evt of getEventsArray(entity)) {
    // Deux formats possibles : { type, actions } ou { data: { type, actions } }
    const e = evt?.data ?? evt
    if (!e) continue
    const type = e.type ?? evt.type
    if (type !== eventType) continue
    if (e.disabled || evt.disabled) continue
    console.log('[SplineXR] ▶', eventType, 'on', entity.name)
    runActions(e.actions ?? evt.actions)
  }
}

// ── Hover / Click dispatch ───────────────────────────────────────────────────
function updateHover(hit) {
  const entity = hit ? meshToEntity.get(hit.object.uuid) : null
  const newUuid = entity?.uuid ?? null
  if (newUuid === currentHoveredUuid) return

  // Sortie de l'objet précédent (toggle retour)
  if (currentHoveredUuid) {
    const prev = splineContext?._entityByUuid?.get(currentHoveredUuid)
    if (prev) triggerEvent(prev, 'MouseHover')
  }
  // Entrée sur le nouvel objet
  if (newUuid && entity) triggerEvent(entity, 'MouseHover')
  currentHoveredUuid = newUuid
}

let pressedEntity = null

function onTriggerDown(hit) {
  if (!hit) return
  const entity = meshToEntity.get(hit.object.uuid)
  if (!entity) return
  pressedEntity = entity
  triggerEvent(entity, 'MouseDown')
}

function onTriggerUp(hit) {
  if (pressedEntity) {
    triggerEvent(pressedEntity, 'MouseUp')
    // MousePress = cycle complet sur le même objet
    const curEntity = hit ? meshToEntity.get(hit.object.uuid) : null
    if (curEntity === pressedEntity) triggerEvent(pressedEntity, 'MousePress')
    pressedEntity = null
  }
}

// ── Boucle contrôles ──────────────────────────────────────────────────────────
let debugCounter = 0
function updateControls(dt) {
  if (!renderer.xr.isPresenting) return
  const session = renderer.xr.getSession()
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
      loco.outOfBoundsTimer = (loco.outOfBoundsTimer ?? 0) + dt
      if (loco.outOfBoundsTimer > 3) { resetCamera(); loco.outOfBoundsTimer = 0 }
    } else loco.outOfBoundsTimer = 0
  }

  // Manettes
  if (session?.inputSources) {
    for (const src of session.inputSources) {
      if (!src.gamepad) continue
      const side = src.handedness === 'left' ? 0 : 1
      const { axes, buttons } = src.gamepad
      const jx = axes[2] ?? axes[0] ?? 0, jy = axes[3] ?? axes[1] ?? 0
      const trigger = (buttons[0]?.value ?? 0) > 0.5
      const c = controllers[side]
      const hit = fireRay(c.ctrl)

      // Dot au point d'impact (monde → espace local du contrôleur)
      c.ray.visible = true
      if (hit) {
        c.dot.visible = true
        const invCtrl = new Matrix4().copy(c.ctrl.matrixWorld).invert()
        c.dot.position.copy(hit.point).applyMatrix4(invCtrl)
      } else {
        c.dot.visible = false
      }

      // Debug HUD (toutes les 30 frames, main droite)
      if (side === 1 && (++debugCounter % 30 === 0)) {
        if (hit) {
          let info = `mesh: ${hit.object.name || 'unnamed'}\n`
          let cur = hit.object, depth = 0
          while (cur && !cur.isScene && depth < 6) {
            const d = cur.data
            const n = getEventsArray(cur).length
            const keys = d ? Object.keys(d).slice(0, 8).join(',') : 'no data'
            info += `[${depth}] ${cur.name || '?'} data:${!!d} events:${n} keys:[${keys}]\n`
            cur = cur.parent; depth++
          }
          info += `total meshes:${interactiveObjects.length}`
          debugLog(info)
        } else {
          debugLog(`Ray→ none | meshes:${interactiveObjects.length}`)
        }
      }

      if (side === 1) updateHover(hit)

      if (side === 0) {
        // GAUCHE : smooth locomotion
        const dx = Math.abs(jx) > loco.deadzone ? jx : 0, dy = Math.abs(jy) > loco.deadzone ? jy : 0
        if (dx || dy) {
          cameraRig.position.addScaledVector(_fwd, -dy * loco.speed * dt)
          cameraRig.position.addScaledVector(_right, -dx * loco.speed * dt)
        }
        if (trigger && !c.triggerPrev) onTriggerDown(hit)
        if (!trigger && c.triggerPrev) onTriggerUp(hit)
      } else {
        // DROITE : snap turn + téléport + clic
        if (loco.snapCooldown <= 0) {
          if (jx > 0.6) { cameraRig.rotateY(-loco.snapAngle); loco.snapCooldown = loco.snapDelay }
          else if (jx < -0.6) { cameraRig.rotateY(loco.snapAngle); loco.snapCooldown = loco.snapDelay }
        }
        const jyAbs = Math.abs(jy) > loco.deadzone ? jy : 0
        if (jyAbs > 0.6) {
          if (hit) { teleportMarker.visible = true; teleportMarker.position.copy(hit.point); loco.teleportPending = true; loco.teleportTarget.copy(hit.point) }
        } else {
          if (loco.teleportPending) { cameraRig.position.copy(loco.teleportTarget); loco.teleportPending = false }
          teleportMarker.visible = false
        }
        if (trigger && !c.triggerPrev) onTriggerDown(hit)
        if (!trigger && c.triggerPrev) onTriggerUp(hit)
      }

      // Feedback visuel manette
      if (c.model) {
        const tv = buttons[0]?.value ?? 0
        c.model.triggerLight.material.opacity = tv * 0.8
        if (c.model.stick) { c.model.stick.rotation.x = jy * 0.25; c.model.stick.rotation.z = -jx * 0.25 }
        const ringMesh = c.model.group.children.find(ch => ch.geometry?.type === 'RingGeometry')
        if (ringMesh) ringMesh.material.opacity = 0.9 + tv * 0.1
      }
      c.triggerPrev = trigger
    }
  }

  // Hand tracking
  for (const h of hands) {
    const joints = h.hand.joints
    if (!joints) { h.model.group.visible = false; h.ray.visible = false; h.dot.visible = false; continue }
    h.model.group.visible = true
    const iTip = joints['index-finger-tip'], tTip = joints['thumb-tip']
    let isPinching = false
    if (iTip && tTip) {
      _origin.setFromMatrixPosition(iTip.matrixWorld)
      _dir.setFromMatrixPosition(tTip.matrixWorld)
      isPinching = _origin.distanceTo(_dir) < 0.03
    }
    updateHandModel(h.model, joints, isPinching)
    const hit = iTip ? fireRay(iTip) : null
    h.ray.visible = !!hit; h.dot.visible = !!hit
    if (h.side === 1) updateHover(hit)
    if (isPinching && !h.pinchPrev && h.side === 1) onTriggerDown(hit)
    if (!isPinching && h.pinchPrev && h.side === 1) onTriggerUp(hit)
    h.pinchPrev = isPinching
  }
}

// ── Attach/detach ────────────────────────────────────────────────────────────
function attachXR(scene) {
  scene.add(cameraRig)
  controllers.forEach(c => { cameraRig.add(c.ctrl); cameraRig.add(c.grip) })
  hands.forEach(h => cameraRig.add(h.hand))
  scene.add(teleportMarker)
}
function detachXR(scene) { scene.remove(cameraRig); scene.remove(teleportMarker) }

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
  console.log('[SplineXR] Caméra:', best.name, '| pos:', pos.toArray().map(v=>Math.round(v)), '| fov:', fov)
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

  const shared = splineScene.sharedAssets ?? splineScene._sharedAssets ?? null
  splineContext = { scene: splineScene, shared, _entityByUuid: new Map() }
  collectObjects(splineScene)

  // Événements Start
  setTimeout(() => {
    if (!splineContext) return
    for (const [, entity] of splineContext._entityByUuid) {
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
    Vector3.prototype.copy = function(v) { return v == null ? this : orig.call(this, v) }
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
    if (threeScene) detachXR(threeScene)
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
