// Spline "Drag & Drop" events for the home-made engine, played with the hands.
//
// In Spline the mouse drags an object across a plane. In VR that plane maths
// throws objects far away as soon as the ray grazes it, so objects are held
// instead, like real things:
//   - near: pinch, trigger or grip with the hand on the object → it follows
//     the hand (position and rotation, keeping the grab offset);
//   - far: trigger or pinch with the ray on the object → it flies into the
//     hand, then follows it.
// Released close to a drop destination, it snaps there (centre or surface,
// auto-orient), plays the drop actions and sets the drop variables. Released
// elsewhere, it goes back (reset on snap fail), as in Spline.
//
// Kept from the event data (@splinetool/runtime 2.0.151, same logic in
// 2.0.203): objects, dropDestinations, dropOn, drop, snapTo, snapSurfaceMode,
// snapSurfaceOffset, autoOrient, resetOnSnapFail, snapSpeed, resetSpeed,
// limits + referenceFrame, single-axis planes (x / y / z: a slider stays a
// slider), dragDropActions { drag, drop }. Free planes (xy, camera, adaptive,
// custom…) become free 3D movement.
//
// Positions are computed in the Spline scene frame (scene units), so limits
// and offsets keep their meaning whatever the world scale.
import { Vector3, Matrix4, Matrix3, Quaternion, Box3, Raycaster } from 'three'

export const NEAR_GRAB = 0.08        // metres between the hand and the object
const DROP_REACH = 0.05              // metres: overlap tolerance with a destination
const PULL_TIME = 0.25               // seconds for a far object to reach the hand

const _m = new Matrix4(), _m2 = new Matrix4(), _inv = new Matrix4(), _n3 = new Matrix3()
const _v = new Vector3(), _c = new Vector3(), _b = new Vector3(), _normal = new Vector3()
const _p = new Vector3(), _s = new Vector3(), _q = new Quaternion(), _q2 = new Quaternion()
const _box = new Box3(), _box2 = new Box3(), _ray = new Raycaster()

export function createDragDrop({ scene, entityByUuid, getEvents, toArray, runActions, resetState, log }) {
  const events = []
  for (const [, entity] of entityByUuid) {
    for (const evt of getEvents(entity)) {
      const data = evt?.data ?? evt
      if (data?.type !== 'DragDrop' || data.disabled) continue
      const items = toArray(data.objects)
        .map(id => entityByUuid.get(id)).filter(o => o && o.visible !== false)
      if (!items.length) continue
      const dropDest = new Set()
      toArray(data.dropDestinations).forEach(id => { const o = entityByUuid.get(id); if (o) dropDest.add(o) })
      const ev = {
        entity, data, dropDest,
        dragActions: toArray(data.dragDropActions?.drag),
        dropActions: toArray(data.dragDropActions?.drop),
        resetDamping: !data.resetSpeed ? 1 : 8 / data.resetSpeed + 1,
        snapDamping: !data.snapSpeed ? 1 : 8 / data.snapSpeed + 1,
        dragFired: false, dragTimer: null,
        items: [],
      }
      ev.items = items.map(obj => ({
        // Drop transitions that move the object itself (or a parent): Spline's
        // way of putting it in place ("worn" state). They place the object,
        // not the snap.
        selfDrop: toArray(data.dragDropActions?.drop).filter(a => {
          const d = a?.data ?? a
          if (d?.type !== 'Transition') return false
          const target = entityByUuid.get(d.object)
          for (let x = obj; x; x = x.parent) if (x === target) return true
          return false
        }),
        obj, ev,
        position0: obj.position.clone(), quat0: obj.quaternion.clone(),
        worldPosition0: scenePosition(obj, new Vector3()),   // scene frame
        worldQuat0: relQuat(obj),
        fromPosition: scenePosition(obj, new Vector3()), fromQuat: relQuat(obj),
        target: new Vector3(), targetQuat: null,
        damping: 1, paused: true, snapped: false, reset: false,
        holder: null, offset: new Matrix4(), pull: 0, grabPos: new Vector3(),
        relax: null,                        // easing back to its place in a moving parent
        lastDest: null, last: null,
      }))
      events.push(ev)
      log('DragDrop on', entity.name, '→', items.map(o => o.name).join(', '),
        '| plane', data.plane, '| drop', !!data.drop, data.dropOn)
    }
  }
  const allItems = () => events.flatMap(ev => ev.items)

  // ── Frames ────────────────────────────────────────────────────────────────
  function sceneInverse() { return _inv.copy(scene.matrixWorld).invert() }
  function scenePosition(obj, target) {
    target.setFromMatrixPosition(obj.matrixWorld)
    return target.applyMatrix4(_m.copy(scene.matrixWorld).invert())
  }
  function relQuat(obj, target = new Quaternion()) {
    _m.copy(scene.matrixWorld).invert().multiply(obj.matrixWorld).decompose(_p, target, _s)
    return target
  }

  function clampLimits(v, l) {
    if (!l) return
    const ok = (a, b) => Number.isFinite(a) && Number.isFinite(b) && a < b
    if (ok(l[0], l[1])) v.x = Math.min(Math.max(v.x, l[0]), l[1])
    if (ok(l[2], l[3])) v.y = Math.min(Math.max(v.y, l[2]), l[3])
    if (ok(l[4], l[5])) v.z = Math.min(Math.max(v.z, l[4]), l[5])
  }

  // Place the item at a scene-frame position (runtime S()), with an optional
  // scene-frame orientation
  function placeAt(it, pos, orient) {
    const { obj } = it, { limits, referenceFrame } = it.ev.data
    const parent = obj.parent
    const toParent = parent && parent !== scene
      ? _m2.copy(scene.matrixWorld).invert().multiply(parent.matrixWorld).invert()
      : _m2.identity()
    obj.position.copy(pos)
    if (referenceFrame === 'global' || !referenceFrame) clampLimits(obj.position, limits)
    obj.position.applyMatrix4(toParent)
    if (referenceFrame === 'parent') clampLimits(obj.position, limits)
    else if (referenceFrame === 'local') {
      _q.copy(it.quat0).invert()
      obj.position.sub(it.position0).applyQuaternion(_q)
      clampLimits(obj.position, limits)
      obj.position.applyQuaternion(_q.invert()).add(it.position0)
    }
    if (orient) {
      const qp = parent && parent !== scene ? relQuat(parent, _q2) : _q2.identity()
      obj.quaternion.copy(qp).invert().multiply(orient)
    }
    obj.updateMatrixWorld(true)
  }

  // Single-axis planes keep the object on its rail
  function axisOf(it) {
    const { plane, referenceFrame } = it.ev.data
    const a = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[plane]
    if (!a) return null
    const axis = new Vector3(...a)
    if (referenceFrame === 'parent' && it.obj.parent && it.obj.parent !== scene) axis.applyQuaternion(relQuat(it.obj.parent))
    else if (referenceFrame === 'local') axis.applyQuaternion(relQuat(it.obj))
    return axis.normalize()
  }

  // Ease towards target / targetQuat (snap, reset), runtime damping
  function step(it) {
    const cur = scenePosition(it.obj, new Vector3())
    const delta = _v.subVectors(it.target, cur).divideScalar(it.damping)
    const done = delta.length() < 0.01
    let orient = null
    if (it.targetQuat) {
      orient = relQuat(it.obj, new Quaternion()).slerp(it.targetQuat, 1 / it.damping)
      if (done) orient.copy(it.targetQuat)
    }
    placeAt(it, done ? it.target : delta.add(cur), orient)
    if (done) { it.paused = true; it.reset = false }
  }

  // ── Destinations ──────────────────────────────────────────────────────────
  const isInside = (o, root) => { for (let x = o; x; x = x.parent) if (x === root) return true; return false }
  const visibleChain = o => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true }

  // Destination the item overlaps (bounding boxes), nearest first
  function findDestination(it) {
    const { data } = it.ev
    if (!data.drop) return null
    const itemBox = new Box3().setFromObject(it.obj).expandByScalar(DROP_REACH)
    const centre = itemBox.getCenter(new Vector3())
    let best = null, bestD = Infinity
    scene.traverse(o => {
      if (!o.isMesh || isInside(o, it.obj) || !visibleChain(o)) return
      let dest = null
      if (data.dropOn === 'all' || !data.dropOn) dest = o
      else for (let x = o; x; x = x.parent) if (it.ev.dropDest.has(x)) { dest = x; break }
      if (!dest) return
      _box2.setFromObject(o)
      if (!itemBox.intersectsBox(_box2)) return
      const d = _box2.distanceToPoint(centre)
      if (d < bestD) { bestD = d; best = { dest, mesh: o } }
    })
    return best
  }

  function snapTo(it, found) {
    const { data } = it.ev
    const centre = new Box3().setFromObject(it.obj).getCenter(new Vector3())
    // Surface point and normal: ray from the item's centre towards the mesh
    const meshCentre = new Box3().setFromObject(found.mesh).getCenter(new Vector3())
    const dir = new Vector3().subVectors(meshCentre, centre)
    if (dir.lengthSq() < 1e-12) dir.set(0, -1, 0)
    _ray.set(centre, dir.normalize())
    let hit = _ray.intersectObject(found.mesh, false)[0]
    if (!hit) { _ray.set(centre, dir.negate()); hit = _ray.intersectObject(found.mesh, false)[0] }
    _normal.set(0, 1, 0)
    if (hit?.face) {
      _normal.copy(hit.face.normal).applyMatrix3(_n3.getNormalMatrix(hit.object.matrixWorld)).normalize()
      if (_normal.dot(_ray.ray.direction) > 0) _normal.negate()        // facing the item
    }
    _normal.transformDirection(sceneInverse())

    if (data.snapTo === 'surface' && hit) {
      it.target.copy(hit.point).applyMatrix4(sceneInverse())
      if (data.snapSurfaceMode === 'bbox') {
        // Rest the item's bounding box on the surface
        _box.setFromObject(it.obj).applyMatrix4(sceneInverse())
        const origin = scenePosition(it.obj, new Vector3())
        let depth = 0
        for (let k = 0; k < 8; k++) {
          _c.set(k & 1 ? _box.max.x : _box.min.x, k & 2 ? _box.max.y : _box.min.y, k & 4 ? _box.max.z : _box.min.z)
          depth = Math.max(depth, _v.subVectors(origin, _c).dot(_normal))
        }
        it.target.addScaledVector(_normal, depth)
      } else it.target.addScaledVector(_normal, data.snapSurfaceOffset ?? 0)
    } else scenePosition(found.dest, it.target)

    it.targetQuat = null
    if (data.autoOrient) {
      // Basis: X = up × n, Y = n × X, Z = n (runtime makeBasis)
      _b.set(0, 1, 0).cross(_normal)
      if (_b.length() < 1e-4) _b.set(-1, 0, 0).cross(_normal)
      _b.normalize()
      _c.crossVectors(_normal, _b)
      it.targetQuat = new Quaternion().setFromRotationMatrix(_m.makeBasis(_b, _c, _normal))
    }
    it.damping = it.ev.snapDamping
    it.snapped = true
    it.paused = false
    it.lastDest = found.dest
    // A later failed drop comes back here
    it.fromPosition.copy(it.target)
    it.fromQuat.copy(it.targetQuat ?? relQuat(it.obj))
  }

  // ── Actions (the runtime treats drag/drop transitions as toggles) ────────
  const byType = (list, types) => list.filter(a => types.includes((a?.data ?? a)?.type))
  const PLAY = ['Transition', 'Animation', 'Audio', 'TimelineAnimation', 'Particles']
  const DISPATCH = ['SetVariable', 'Conditional']
  const play = list => runActions(byType(list, PLAY), 'in')
  const revert = list => runActions(byType(list, ['Transition']), 'out')

  function onMoved(it) {
    const ev = it.ev
    runActions(byType(ev.dragActions, DISPATCH), undefined)
    if (!ev.dragFired) { ev.dragFired = true; play(ev.dragActions) }
    clearTimeout(ev.dragTimer)
    ev.dragTimer = setTimeout(() => { if (ev.dragFired) { ev.dragFired = false; revert(ev.dragActions) } }, 500)
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    get count() { return events.length },

    itemOf(object) {
      for (const it of allItems()) if (isInside(object, it.obj)) return it
      return null
    },

    // Free item within reach of a world-space point: nearest bounding box,
    // then nearest centre (the hand is often inside several boxes on a shelf)
    nearItem(point) {
      let best = null, bestScore = Infinity
      for (const it of allItems()) {
        if (it.holder || !visibleChain(it.obj)) continue
        _box.setFromObject(it.obj)
        const d = _box.distanceToPoint(point)
        if (d > NEAR_GRAB) continue
        const score = d + 0.25 * _box.getCenter(_c).distanceTo(point)
        if (score < bestScore) { bestScore = score; best = it }
      }
      return best
    },

    heldBy(p) { return allItems().find(it => it.holder === p) ?? null },

    // handMatrix: world matrix of the hand (pinch point or grip)
    grab(p, it, handMatrix, far = false) {
      if (!it || it.holder) return false
      const { data } = it.ev
      it.holder = p
      it.relax = null
      it.reset = false; it.paused = true; it.snapped = false; it.targetQuat = null
      it.last = null
      if (!data.drop || !data.resetOnSnapFail) {
        scenePosition(it.obj, it.fromPosition); relQuat(it.obj, it.fromQuat)
      }
      if (it.lastDest) {
        it.lastDest = null
        // Taken off its destination: its "worn" state is dropped at once (not
        // animated, the hand holds it), keeping it where it is; the other drop
        // transitions are reverted as usual
        if (it.selfDrop.length) {
          const pos = scenePosition(it.obj, new Vector3()), quat = relQuat(it.obj)
          for (const a of it.selfDrop) { const t = entityByUuid.get((a.data ?? a).object); if (t) resetState(t) }
          scene.updateMatrixWorld(true)
          placeAt(it, pos, quat)
        }
        revert(it.ev.dropActions.filter(a => !it.selfDrop.includes(a)))
      }
      scenePosition(it.obj, it.grabPos)
      // The object's transform in the hand
      it.offset.copy(handMatrix).invert().multiply(it.obj.matrixWorld)
      if (far) {
        // Far grab: the object's centre comes into the palm
        const centre = new Box3().setFromObject(it.obj).getCenter(new Vector3())
        centre.applyMatrix4(_m.copy(handMatrix).invert())
        it.offset.premultiply(_m.makeTranslation(-centre.x, -centre.y, -centre.z))
        it.pull = PULL_TIME
      } else it.pull = 0
      log(far ? 'Grab (far)' : 'Grab', it.obj.name)
      return true
    },

    // dt in seconds; handMatrixOf(p, target) → world matrix of p's hand, or null
    update(dt, handMatrixOf) {
      for (const it of allItems()) {
        const p = it.holder
        if (!p && it.relax) {
          const r = it.relax
          r.t = Math.min(1, r.t + dt / r.dur)
          const k = r.t < 0.5 ? 2 * r.t * r.t : 1 - (-2 * r.t + 2) ** 2 / 2     // ease in-out
          it.obj.position.lerpVectors(r.p, it.position0, k)
          it.obj.quaternion.slerpQuaternions(r.q, it.quat0, k)
          it.obj.updateMatrixWorld(true)
          if (r.t >= 1) it.relax = null
        }
        if (!p) { if (!it.paused) step(it); continue }
        const hand = handMatrixOf(p, new Matrix4())
        if (!hand) continue
        // Wanted transform of the object, scene frame
        const want = new Matrix4().copy(scene.matrixWorld).invert().multiply(hand).multiply(it.offset)
        const pos = new Vector3(), quat = new Quaternion()
        want.decompose(pos, quat, new Vector3())
        const axis = axisOf(it)
        if (axis) {
          // On a rail: position along the axis only, rotation unchanged
          const t = _v.subVectors(pos, it.grabPos).dot(axis)
          pos.copy(it.grabPos).addScaledVector(axis, t)
        }
        if (it.pull > 0) {
          // Far grab: ease into the hand
          const k = Math.min(1, dt / it.pull)
          it.pull = Math.max(0, it.pull - dt)
          pos.lerpVectors(scenePosition(it.obj, new Vector3()), pos, k)
          if (!axis) quat.copy(relQuat(it.obj).slerp(quat, k))
        }
        placeAt(it, pos, axis ? null : quat)
        if (!it.last || it.last.distanceToSquared(pos) > 1) {   // > 1 scene unit (≈ 1 mm)
          ;(it.last ??= new Vector3()).copy(pos)
          onMoved(it)
        }
      }
    },

    release(p) {
      const it = allItems().find(x => x.holder === p)
      if (!it) return null
      it.holder = null
      const ev = it.ev, { data } = ev
      const found = findDestination(it)
      if (found && it.selfDrop.length) {
        // The drop transition puts the object in place: no snap on top of it
        // (the snap would pull it back once the transition is over)
        it.snapped = true; it.paused = true; it.targetQuat = null
        it.lastDest = found.dest
        // When it is a parent that moves (a group with a "worn" state), the
        // object goes back to its place in that group meanwhile, so it ends
        // up where the state puts it
        if (it.selfDrop.some(a => entityByUuid.get((a.data ?? a).object) !== it.obj)) {
          const dur = Math.max(0, ...it.selfDrop.flatMap(a => toArray((a.data ?? a).tweens).map(t => (t?.data ?? t)?.duration ?? 0)))
          it.relax = { p: it.obj.position.clone(), q: it.obj.quaternion.clone(), t: 0, dur: (dur || 1000) / 1000 }
        }
        play(ev.dropActions)
      } else if (found) {
        snapTo(it, found)
        play(ev.dropActions)
      } else if (data.drop && data.resetOnSnapFail) {
        const original = data.resetOnSnapFail === 'original'
        it.target.copy(original ? it.worldPosition0 : it.fromPosition)
        it.targetQuat = (original ? it.worldQuat0 : it.fromQuat).clone()
        it.damping = ev.resetDamping
        it.reset = data.resetOnSnapFail
        it.paused = false
      }
      if (ev.dragFired) {
        ev.dragFired = false
        clearTimeout(ev.dragTimer)
        revert(ev.dragActions)
        runActions(byType(ev.dropActions, DISPATCH), undefined)
      }
      log('Release', it.obj.name, found ? `on ${found.dest.name}` : it.reset ? '(back)' : '')
      return it
    },

    dispose() {
      for (const ev of events) {
        clearTimeout(ev.dragTimer)
        for (const it of ev.items) it.holder = null
      }
      events.length = 0
    },
  }
}
