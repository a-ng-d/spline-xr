// Home-made animation engine: reproduces, for the Spline loader (which only reads
// data), what the official runtime does for
//   - animated transitions between states (duration, delay, easing, repeat);
//   - evaluating conditions and variables;
//   - playing timeline animations.
// Values (easings, units, order of application) are taken from the code of the
// runtime @splinetool/runtime 2.0.151.

// ══════════════════════════════════════════════════════════════════════════════
// COURBES
// ══════════════════════════════════════════════════════════════════════════════
// Spline IDs: 0 linear, 1 ease, 2 ease-in, 3 ease-out, 4 ease-in-out,
// 5 custom bezier, 6 spring, 7 "arc", 8 none (step).
const PRESETS = {
  0: [0, 0, 1, 1], 1: [0.25, 0.1, 0.25, 1], 2: [0.42, 0, 1, 1],
  3: [0, 0, 0.58, 1], 4: [0.42, 0, 0.58, 1], 7: [0.25, 1, 0.5, 1],
}

// Cubic bezier (0,0)-(x1,y1)-(x2,y2)-(1,1), solved for x with Newton + bisection
function cubicBezier(x1, y1, x2, y2) {
  if (x1 === y1 && x2 === y2) return t => t
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const sx = t => ((ax * t + bx) * t + cx) * t
  const sy = t => ((ay * t + by) * t + cy) * t
  const dx = t => (3 * ax * t + 2 * bx) * t + cx
  const solve = x => {
    let t = x
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x
      if (Math.abs(e) < 1e-6) return t
      const d = dx(t)
      if (Math.abs(d) < 1e-6) break
      t -= e / d
    }
    let lo = 0, hi = 1; t = x
    for (let i = 0; i < 30; i++) {
      const v = sx(t)
      if (Math.abs(v - x) < 1e-6) break
      if (x > v) lo = t; else hi = t
      t = (lo + hi) / 2
    }
    return t
  }
  return x => (x <= 0 ? 0 : x >= 1 ? 1 : sy(solve(x)))
}

// Damped spring (mass, stiffness, damping, velocity), normalised to end at 1
function spring({ mass = 1, stiffness = 80, damping = 10, velocity = 0 } = {}) {
  const w0 = Math.sqrt(stiffness / mass)
  const zeta = damping / (2 * Math.sqrt(stiffness * mass))
  const v0 = -velocity
  const x = t => {
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta)
      return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0 + v0) / wd) * Math.sin(wd * t))
    }
    if (zeta === 1) return 1 - Math.exp(-w0 * t) * (1 + (w0 + v0) * t)
    const r = w0 * Math.sqrt(zeta * zeta - 1)
    const a = -zeta * w0 + r, b = -zeta * w0 - r
    const c2 = (a - v0) / (a - b), c1 = 1 - c2
    return 1 - (c1 * Math.exp(a * t) + c2 * Math.exp(b * t))
  }
  const end = x(1) || 1
  return t => (t <= 0 ? 0 : t >= 1 ? 1 : x(t) / end)
}

// d : { easing, control1, control2, mass, stiffness, damping, velocity }
export function makeEase(d = {}) {
  const id = d.easing ?? 0
  if (id === 8) return t => (t >= 1 ? 1 : 0)
  if (id === 6) return spring(d)
  if (id === 5) {
    const [x1, y1] = d.control1 ?? [0.5, 0]
    const [x2, y2] = d.control2 ?? [0.5, 1]
    return cubicBezier(x1, y1, x2, y2)
  }
  const p = PRESETS[id] ?? PRESETS[0]
  return cubicBezier(...p)
}

// ══════════════════════════════════════════════════════════════════════════════
// CLOCK: running animations, advanced every frame by update()
// ══════════════════════════════════════════════════════════════════════════════
const active = new Set()

export function updateAnimations(now = performance.now()) {
  for (const a of [...active]) {
    if (a.cancelled) { active.delete(a); continue }
    a.tick(now)
  }
}

export function stopAllAnimations() {
  for (const a of active) a.cancelled = true
  active.clear()
  timelines.clear()
}

// Plays a 0 → 1 interpolation: apply(p) every frame, then onEnd()
function tween({ delay = 0, duration, ease, apply, onEnd, key }) {
  const anim = {
    key, cancelled: false, start: null,
    tick(now) {
      if (this.start === null) this.start = now + delay
      if (now < this.start) return
      const t = duration > 0 ? Math.min(1, (now - this.start) / duration) : 1
      apply(ease(t))
      if (t >= 1) { active.delete(this); onEnd?.() }
    },
  }
  active.add(anim)
  return anim
}

// ══════════════════════════════════════════════════════════════════════════════
// TRANSITIONS BETWEEN STATES
// The loader applies a state at once (changeSelectedState). The look before
// and after is captured, then interpolated.
// ══════════════════════════════════════════════════════════════════════════════
const isVec = v => v && (v.isColor || v.isVector2 || v.isVector3 || v.isVector4)

function snapMaterial(m) {
  const vals = {}
  if (typeof m.opacity === 'number') vals.opacity = m.opacity
  if (m.color?.isColor) vals.color = m.color.clone()
  if (m.emissive?.isColor) vals.emissive = m.emissive.clone()
  if (m.uniforms) {
    for (const [k, u] of Object.entries(m.uniforms)) {
      const v = u?.value
      if (typeof v === 'number') vals['u:' + k] = v
      else if (isVec(v)) vals['u:' + k] = v.clone()
    }
  }
  return vals
}

function snapshot(root) {
  const objects = new Map(), materials = new Map()
  root.traverse(o => {
    objects.set(o, { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone(), v: o.visible })
    if (o.material) for (const m of [].concat(o.material)) if (!materials.has(m)) materials.set(m, snapMaterial(m))
  })
  return { objects, materials }
}

const readMat = (m, k) => (k.startsWith('u:') ? m.uniforms?.[k.slice(2)]?.value : m[k])
function writeMat(m, k, v) {
  if (k.startsWith('u:')) { const u = m.uniforms?.[k.slice(2)]; if (u) u.value = v }
  else m[k] = v
}

// (before, after) pairs for everything that exists on both sides
function pairUp(from, to) {
  const objs = [], mats = []
  for (const [o, b] of to.objects) { const a = from.objects.get(o); if (a) objs.push({ o, a, b }) }
  for (const [m, b] of to.materials) {
    const a = from.materials.get(m)
    if (!a) continue
    for (const k of Object.keys(b)) {
      if (!(k in a)) continue
      const va = a[k], vb = b[k]
      if (typeof vb === 'number' && va !== vb) mats.push({ m, k, a: va, b: vb })
      else if (isVec(vb) && !vb.equals(va)) mats.push({ m, k, a: va, b: vb, live: readMat(m, k) })
    }
  }
  return { objs, mats }
}

function applyPairs({ objs, mats }, p) {
  for (const { o, a, b } of objs) {
    o.position.lerpVectors(a.p, b.p, p)
    o.quaternion.slerpQuaternions(a.q, b.q, p)
    o.scale.lerpVectors(a.s, b.s, p)
    o.visible = p >= 1 ? b.v : (a.v || b.v)
    if (!o.matrixAutoUpdate) o.updateMatrix()
  }
  for (const it of mats) {
    if (typeof it.b === 'number') writeMat(it.m, it.k, it.a + (it.b - it.a) * p)
    else {
      const live = readMat(it.m, it.k)
      if (!live?.copy) continue
      live.copy(it.a)
      if (live.isColor) live.lerp(it.b, p)
      else live.lerp(it.b, p)
    }
    if (it.k === 'opacity' && p > 0 && p < 1) it.m.transparent = true
  }
}

const running = new WeakMap()   // entity → running transition animation

// Changes state smoothly. timing: { duration (ms), delay (ms), ease }
function animateState(entity, stateId, ctx, timing) {
  return new Promise(resolve => {
    running.get(entity)?.anim && (running.get(entity).anim.cancelled = true)
    const from = snapshot(entity)
    entity.changeSelectedState(stateId, ctx, true)
    if (!timing.duration || timing.duration <= 0) { running.delete(entity); return resolve() }
    const to = snapshot(entity)
    const pairs = pairUp(from, to)
    if (!pairs.objs.length && !pairs.mats.length) return resolve()
    applyPairs(pairs, 0)
    const anim = tween({
      key: entity, delay: timing.delay || 0, duration: timing.duration, ease: timing.ease,
      apply: p => applyPairs(pairs, p),
      onEnd: () => { applyPairs(pairs, 1); resolve() },
    })
    running.set(entity, { anim })
  })
}

/**
 * Spline Transition action.
 * a.tweens: [0] start state + settings (delay, repeat, direction), [1..] steps
 * (target state, duration, easing). phase: 'in' (enter), 'out' (leave), else click.
 */
export function playTransition(a, target, phase, ctx, toArray) {
  const tweens = toArray(a.tweens).map(tw => tw?.data ?? tw).filter(Boolean)
  if (tweens.length < 2) {
    if (tweens.length === 1 && tweens[0].state !== undefined) target.changeSelectedState(tweens[0].state ?? null, ctx, true)
    return
  }
  const cfg = tweens[0]
  const states = tweens.map(t => t.state ?? null)
  const last = states[states.length - 1]
  const step = (i, dir) => {
    // Step to state i; duration and easing of the segment travelled
    const seg = dir > 0 ? tweens[i] : tweens[i + 1]
    return { state: states[i], duration: seg.duration ?? 0, ease: makeEase(seg) }
  }
  const forward = () => states.slice(1).map((_, k) => step(k + 1, 1))
  const backward = () => states.slice(0, -1).map((_, k) => step(states.length - 2 - k, -1))

  let dir
  if (phase === 'in') dir = 1
  else if (phase === 'out') dir = -1
  else dir = (target.stateSelection ?? null) === last ? -1 : 1

  const token = {}
  target._xrSequence = token
  const pingpong = /pingpong/.test(cfg.direction ?? '')
  let repeatsLeft = phase === 'out' ? 0 : (cfg.repeat ?? 0)   // -1 : infini

  const run = async (d, firstDelay) => {
    const steps = d > 0 ? forward() : backward()
    for (let k = 0; k < steps.length; k++) {
      if (target._xrSequence !== token) return
      const s = steps[k]
      await animateState(target, s.state, ctx, { ...s, delay: k === 0 ? firstDelay : 0 })
    }
    if (target._xrSequence !== token || repeatsLeft === 0) return
    if (repeatsLeft > 0) repeatsLeft--
    if (pingpong) return run(-d, 0)
    // Plain repeat: jump back to the start, then play again
    target.changeSelectedState(d > 0 ? states[0] : last, ctx, true)
    return run(d, 0)
  }
  run(dir, dir > 0 ? (cfg.delay ?? 0) : 0)
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPRESSIONS (conditions and variables)
// A Spline expression is a list of tokens: { id } for a variable or an object
// property, { name } for a number, an operator, and / or, True / False, or a
// text. Evaluated without eval().
// ══════════════════════════════════════════════════════════════════════════════
const BINARY = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3, '===': 3, '!==': 3,
  '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5, '*': 6, '/': 6, '%': 6,
}
const WORDS = { and: '&&', or: '||', not: '!', AND: '&&', OR: '||', NOT: '!' }

function variableValue(v) {
  if (v && typeof v === 'object' && 'textValue' in v) {
    const t = v.textValue
    return Array.isArray(t) ? t.join('') : String(t ?? '')
  }
  return v
}

function lexSplineTokens(tokens, shared) {
  const out = []
  for (const tok of tokens ?? []) {
    const t = tok?.data ?? tok
    if (!t) continue
    if ('objType' in t) { out.push({ v: 0 }); continue }            // API, webhook, AI: not supported
    if ('id' in t) {
      let v
      try { v = variableValue(shared.getVariable(t.id)) } catch { v = 0 }
      out.push({ v })
      continue
    }
    let n = String(t.name ?? '').trim()
    if (n === '') continue
    if (n in WORDS) n = WORDS[n]
    if (n === 'True' || n === 'true') out.push({ v: true })
    else if (n === 'False' || n === 'false') out.push({ v: false })
    else if (n in BINARY || n === '!' || n === '(' || n === ')') out.push({ op: n })
    else if (/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(n)) out.push({ v: parseFloat(n) })
    else out.push({ v: n.replace(/^["'](.*)["']$/, '$1') })
  }
  return out
}

function parse(toks) {
  let i = 0
  const peek = () => toks[i]
  const unary = () => {
    const t = toks[i++]
    if (!t) throw new Error('incomplete expression')
    if (t.op === '!') return !unary()
    if (t.op === '-') return -unary()
    if (t.op === '+') return +unary()
    if (t.op === '(') { const v = expr(0); if (toks[i]?.op === ')') i++; return v }
    if ('v' in t) return t.v
    throw new Error('unexpected token ' + t.op)
  }
  const expr = minPrec => {
    let left = unary()
    for (;;) {
      const t = peek()
      const prec = t?.op && BINARY[t.op]
      if (!prec || prec <= minPrec) return left
      i++
      const right = expr(prec)
      switch (t.op) {
        case '||': left = left || right; break
        case '&&': left = left && right; break
        // eslint-disable-next-line eqeqeq
        case '==': left = left == right; break
        // eslint-disable-next-line eqeqeq
        case '!=': left = left != right; break
        case '===': left = left === right; break
        case '!==': left = left !== right; break
        case '<': left = left < right; break
        case '<=': left = left <= right; break
        case '>': left = left > right; break
        case '>=': left = left >= right; break
        case '+': left = left + right; break
        case '-': left = left - right; break
        case '*': left = left * right; break
        case '/': left = left / right; break
        case '%': left = left % right; break
      }
    }
  }
  const v = expr(0)
  return v
}

export function evaluateExpression(tokens, shared) {
  const toks = lexSplineTokens(tokens, shared)
  if (!toks.length) return undefined
  return parse(toks)
}

// Value in the shape expected by shared.updateVariable for the current type
export function coerceForVariable(current, value) {
  if (typeof current === 'number') { const n = Number(value); return Number.isFinite(n) ? n : 0 }
  if (typeof current === 'boolean') return Boolean(value)
  if (current && typeof current === 'object' && 'textValue' in current) return { textValue: String(value ?? '') }
  return value
}

// ══════════════════════════════════════════════════════════════════════════════
// TIMELINES
// A timeline (on the scene page): duration in seconds and, for each object,
// keyframes { path: [property, axis], time, value, easing }.
// ══════════════════════════════════════════════════════════════════════════════
const timelines = new Map()   // id → lecteur
const DEG2RAD = Math.PI / 180

export function findTimeline(root, id) {
  let found = null
  root.traverse(o => { if (!found && o.data?.timelines?.[id]) found = o.data.timelines[id] })
  return found
}

export function listTimelineIds(root) {
  const ids = []
  root.traverse(o => { if (o.data?.timelines) ids.push(...Object.keys(o.data.timelines)) })
  return ids
}

const easeOfKeyframe = e => ({
  easing: e?.type ?? 0,
  control1: e?.cubicControls?.control1 ?? [0, 0],
  control2: e?.cubicControls?.control2 ?? [1, 1],
  ...(e?.springParameters ?? {}),
})

// Supported tracks: position / rotation / scale (x, y, z) and opacity
function buildTracks(timeline, entityByUuid, toArray, unsupported) {
  const tracks = []
  for (const [uuid, ot] of Object.entries(timeline.objectTimelines ?? {})) {
    const obj = entityByUuid.get(uuid)
    if (!obj) continue
    const groups = new Map()
    for (const k of toArray(ot?.keyframes)) {
      const d = k?.data ?? k
      if (!d?.path || d.isPlaceholder) continue
      const key = d.path.join('.') + '|' + (d.layerId ?? '')
      if (!groups.has(key)) groups.set(key, { path: d.path, kfs: [] })
      groups.get(key).kfs.push({ time: d.time, value: d.value, ease: easeOfKeyframe(d.easing) })
    }
    for (const { path, kfs } of groups.values()) {
      kfs.sort((x, y) => x.time - y.time)
      const [prop, axis] = path
      if ((prop === 'position' || prop === 'rotation' || prop === 'scale') && /^[xyz]$/.test(axis)) {
        tracks.push({ obj, prop, axis, kfs })
      } else if (prop === 'opacity') {
        tracks.push({ obj, prop, kfs })
      } else {
        unsupported.add(prop)
      }
    }
  }
  return tracks
}

// Track value at time t (s): easing of the start keyframe, with the second
// control point of the end keyframe, like the runtime
function sample(kfs, t) {
  if (!kfs.length) return undefined
  if (t <= kfs[0].time) return kfs[0].value
  const lastK = kfs[kfs.length - 1]
  if (t >= lastK.time) return lastK.value
  let i = 1
  while (i < kfs.length && kfs[i].time < t) i++
  const k0 = kfs[i - 1], k1 = kfs[i]
  const span = k1.time - k0.time
  if (span <= 0) return k1.value
  const p = makeEase({ ...k0.ease, control2: k1.ease.control2 })((t - k0.time) / span)
  if (typeof k0.value !== 'number' || typeof k1.value !== 'number') return p < 1 ? k0.value : k1.value
  return k0.value + (k1.value - k0.value) * p
}

function applyTrack(tr, t) {
  const v = sample(tr.kfs, t)
  if (typeof v !== 'number') return
  const o = tr.obj
  if (tr.prop === 'rotation') o.rotation[tr.axis] = v * DEG2RAD
  else if (tr.prop === 'opacity') {
    o.traverse(c => {
      if (!c.material) return
      for (const m of [].concat(c.material)) { m.opacity = v; m.transparent = v < 1 || m.transparent }
    })
    return
  } else o[tr.prop][tr.axis] = v
  if (!o.matrixAutoUpdate) o.updateMatrix()
}

// Schedule taken from the runtime: delay (start once, start, end, both),
// repeats (-1: forever), normal or ping-pong direction
function schedule({ duration, delay, delayDirection, direction, repeat }) {
  const pingpong = /pingpong/.test(direction ?? '')
  const layout = c => {
    if (pingpong && c % 2 === 1) return { start: 0, end: 0 }
    switch (delayDirection) {
      case 'start-once': return c === 0 ? { start: delay, end: 0 } : { start: 0, end: 0 }
      case 'start': return { start: delay, end: 0 }
      case 'end': return { start: 0, end: delay }
      default: return { start: delay, end: delay }
    }
  }
  const cycle = c => { const l = layout(c); return duration + l.start + l.end }
  return elapsed => {
    let c, local
    if (delayDirection === 'start-once') {
      const first = delay + duration
      if (elapsed < first) { c = 0; local = elapsed }
      else { const r = elapsed - first; c = 1 + Math.floor(r / duration); local = r % duration }
    } else if (pingpong) {
      const a = cycle(0), pair = a + duration
      const k = Math.floor(elapsed / pair), r = elapsed % pair
      if (r < a) { c = 2 * k; local = r } else { c = 2 * k + 1; local = r - a }
    } else {
      const a = cycle(0); c = Math.floor(elapsed / a); local = elapsed % a
    }
    if (repeat !== -1 && c >= repeat + 1) return null
    const { start } = layout(c)
    const reverse = pingpong && c % 2 === 1
    let t
    if (local < start) t = reverse ? duration : 0
    else if (local >= start + duration) t = reverse ? 0 : duration
    else t = reverse ? duration - (local - start) : local - start
    return t
  }
}

/**
 * Spline Timeline action: play / pause / stop interaction.
 * env : { root, entityByUuid, toArray, log, warn }
 */
const timelineData = new Map()   // id → { tracks, duration } (tracks built once)

export function playTimeline(a, env) {
  const id = a.timeline
  const interaction = a.interaction ?? 'play'
  let player = timelines.get(id)

  if (interaction === 'pause') { if (player) player.paused = true; return }
  if (interaction === 'stop') {
    if (player) { player.paused = true; player.finished = true; player.apply(0); active.delete(player) }
    return
  }

  // Playing: keep playing; paused: resume
  if (player && !player.finished) {
    if (player.paused) { player.paused = false; player.last = null; active.add(player) }
    return
  }

  let data = timelineData.get(id)
  if (!data) {
    const timeline = findTimeline(env.root, id)
    if (!timeline) {
      env.warn('Timeline not found:', id, '| timelines in the scene:', listTimelineIds(env.root))
      return
    }
    const unsupported = new Set()
    const tracks = buildTracks(timeline, env.entityByUuid, env.toArray, unsupported)
    if (unsupported.size) env.log('Timeline', id, ': unsupported tracks', [...unsupported])
    const duration = Number(timeline.duration) || Math.max(0, ...tracks.flatMap(t => t.kfs.map(k => k.time)))
    data = { tracks, duration }
    timelineData.set(id, data)
    env.log('Timeline', id, '→', tracks.length, 'tracks,', duration, 's')
  }

  // New playback with the settings of THIS action
  const { tracks, duration } = data
  const repeat = a.repeat ?? 0
  const pingpong = /pingpong/.test(a.direction ?? '')
  const at = schedule({
    duration,
    delay: (a.delay ?? 0) / 1000,
    delayDirection: a.delayDirection ?? 'start-end',
    direction: a.direction ?? 'normal',
    repeat,
  })
  // End: last frame of the last cycle (the start if the last cycle runs backwards)
  const endT = pingpong && repeat % 2 === 1 ? 0 : duration
  player = {
    elapsed: 0, paused: false, finished: false, last: null,
    apply(t) { for (const tr of tracks) applyTrack(tr, t) },
    tick(now) {
      if (this.paused) { this.last = null; return }
      if (this.last !== null) this.elapsed += (now - this.last) / 1000
      this.last = now
      const t = at(this.elapsed)
      if (t === null) { this.apply(endT); this.finished = true; active.delete(this); return }
      this.apply(t)
    },
  }
  timelines.set(id, player)
  active.add(player)
}
