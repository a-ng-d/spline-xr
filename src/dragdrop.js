// Spline "Drag & Drop" events for the home-made engine, ported from the
// runtime's dragdrop module (@splinetool/runtime 2.0.151, same logic in 2.0.203:
// the 'custom' plane falls back to a camera-facing plane and the event's
// top-level `actions` are dropped by the runtime's migration) and driven by XR
// pointers instead of the mouse.
//
// Event data: { objects[], dropDestinations[], plane, planeMode, referenceFrame,
//   limits[6], dampingFactor, drop, dropOn, snapTo, snapSurfaceMode,
//   snapSurfaceOffset, resetOnSnapFail, snapSpeed, resetSpeed,
//   dragDropActions: { drag, drop } }
//
// All the maths happens in the Spline scene frame (scene units), like the
// runtime, so limits, damping thresholds and offsets keep their meaning
// whatever the world scale or the player's position.
import { Vector3, Matrix4, Matrix3, Plane, Ray, Box3, Quaternion } from 'three'

const SNAP_AXIS = 0.2
const _m = new Matrix4(), _inv = new Matrix4(), _n3 = new Matrix3()
const _v = new Vector3(), _d = new Vector3(), _f = new Vector3()
const _b = new Vector3(), _c = new Vector3(), _normal = new Vector3()
const _plane = new Plane(), _ray = new Ray(), _q = new Quaternion(), _box = new Box3()

export function createDragDrop({ scene, entityByUuid, getEvents, toArray, runActions, log }) {
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
      ev.items = items.map(obj => {
        const p0 = scenePosition(obj, new Vector3())
        return {
          obj, ev,
          position0: obj.position.clone(), quat0: obj.quaternion.clone(),
          worldPosition0: p0.clone(),      // scene frame
          fromPosition: p0.clone(), pointStart: new Vector3(), pointEnd: new Vector3(),
          damping: data.dampingFactor ?? 1, paused: true, snapped: false, reset: false,
          orientation: new Quaternion(),   // scene frame, used when snapped + autoOrient
          pointer: null, lastDest: null,
        }
      })
      events.push(ev)
      log('DragDrop on', entity.name, '→', items.map(o => o.name).join(', '),
        '| plane', data.plane, data.planeMode, '| drop', !!data.drop, data.dropOn)
    }
  }

  // ── Frames ────────────────────────────────────────────────────────────────
  function sceneInverse() { return _inv.copy(scene.matrixWorld).invert() }
  function scenePosition(obj, target) {
    target.setFromMatrixPosition(obj.matrixWorld)
    return target.applyMatrix4(_m.copy(scene.matrixWorld).invert())
  }
  // XR pointer ray → scene frame
  function pointerRay(p, target) {
    const mw = p.ctrl.matrixWorld
    target.origin.setFromMatrixPosition(mw)
    target.direction.set(0, 0, -1).transformDirection(mw)
    return target.applyMatrix4(sceneInverse())
  }

  function itemOf(object) {
    for (const ev of events) for (const it of ev.items) {
      for (let o = object; o; o = o.parent) if (o === it.obj) return it
    }
    return null
  }

  // Intersection of the pointer ray with the drag plane (runtime calcPlaneIntersectPos)
  function planePoint(it, ray, camDir, target) {
    const { plane, referenceFrame } = it.ev.data
    _f.copy(camDir).negate()             // towards the viewer
    _q.identity()
    if (referenceFrame === 'parent' && it.obj.parent) _q.copy(relQuat(it.obj.parent))
    else if (referenceFrame === 'local') _q.copy(relQuat(it.obj))
    let axis = null
    switch (plane) {
      case 'x': axis = _b.set(1, 0, 0).applyQuaternion(_q); break
      case 'y': axis = _b.set(0, 1, 0).applyQuaternion(_q); break
      case 'z': axis = _b.set(0, 0, 1).applyQuaternion(_q); break
      case 'xy': _normal.set(0, 0, 1).applyQuaternion(_q); break
      case 'yz': _normal.set(1, 0, 0).applyQuaternion(_q); break
      case 'xz': _normal.set(0, 1, 0).applyQuaternion(_q); break
      case 'adaptive':
        if (_f.angleTo(_c.set(0, 1, 0)) > Math.PI / 6) { _v.crossVectors(_c, _f); _normal.crossVectors(_v, _c) }
        else _normal.set(0, 1, 0)
        break
      default: _normal.copy(_f)
    }
    if (axis) { _v.copy(_f).cross(axis); _normal.copy(axis).cross(_v) }
    if (_normal.lengthSq() < 1e-8) _normal.copy(_f)
    _normal.normalize()
    const origin = it.ev.data.planeMode === 'locked' ? it.worldPosition0 : scenePosition(it.obj, _d)
    _plane.setFromNormalAndCoplanarPoint(_normal, origin)
    if (!ray.intersectPlane(_plane, target)) return false
    if (axis) {
      const t = _v.subVectors(target, origin).dot(axis)
      target.copy(origin).addScaledVector(axis, t)
    }
    return true
  }

  // Rotation of an object relative to the scene frame
  function relQuat(obj) {
    _m.multiplyMatrices(sceneInverse(), obj.matrixWorld)
    const q = new Quaternion(), s = new Vector3(), p = new Vector3()
    _m.decompose(p, q, s)
    return q
  }

  function clampLimits(v, l) {
    if (!l) return
    if (l[0] < l[1]) v.x = Math.min(Math.max(v.x, l[0]), l[1])
    if (l[2] < l[3]) v.y = Math.min(Math.max(v.y, l[2]), l[3])
    if (l[4] < l[5]) v.z = Math.min(Math.max(v.z, l[4]), l[5])
  }

  // Place the item at a scene-frame position (runtime S()); optional
  // scene-frame orientation (auto-orient on a drop surface)
  function placeAt(it, pos, orient) {
    const { obj } = it, { limits, referenceFrame } = it.ev.data
    const parent = obj.parent
    const toParent = parent && parent !== scene
      ? _m.multiplyMatrices(sceneInverse(), parent.matrixWorld).invert()
      : _m.identity()
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
      // local = parent⁻¹ · orientation (rotation part only, like the runtime)
      const qp = parent && parent !== scene ? relQuat(parent) : _q.identity()
      obj.quaternion.copy(qp).invert().multiply(orient)
    }
    obj.updateMatrixWorld(true)
  }

  function step(it) {
    const cur = scenePosition(it.obj, _d)
    let target
    if (it.reset === 'original') {
      it.fromPosition.copy(it.worldPosition0); it.pointStart.copy(it.fromPosition); it.pointEnd.copy(it.pointStart)
      target = _c.copy(it.worldPosition0)
    } else if (it.reset) target = _c.copy(it.fromPosition)
    else target = _c.subVectors(it.pointEnd, it.pointStart).add(it.fromPosition)
    const delta = _v.subVectors(target, cur).divideScalar(it.damping)
    it.paused = !(it.damping > 1) || delta.length() < 0.01
    const { drop, autoOrient } = it.ev.data
    placeAt(it, delta.add(cur), drop && autoOrient && it.snapped ? it.orientation : null)
  }

  // ── Actions (the runtime treats drag/drop transitions as toggles) ────────
  const byType = (list, types) => list.filter(a => types.includes((a?.data ?? a)?.type))
  const PLAY = ['Transition', 'Animation', 'Audio', 'TimelineAnimation', 'Particles']
  const DISPATCH = ['SetVariable', 'Conditional']
  function play(list) { runActions(byType(list, PLAY), 'in') }
  function revert(list) { runActions(byType(list, ['Transition']), 'out') }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    get count() { return events.length },
    itemOf,
    isDragging(p) { return events.some(ev => ev.items.some(it => it.pointer === p)) },

    begin(p, hitObject, camDir) {
      const it = itemOf(hitObject)
      if (!it || it.pointer) return false
      const { data } = it.ev
      it.pointer = p
      it.reset = false; it.snapped = false; it.lastDest = null
      it.damping = data.dampingFactor ?? 1
      pointerRay(p, _ray)
      planePoint(it, _ray, camDir, it.pointStart)
      it.pointEnd.copy(it.pointStart)
      if (!data.drop || !data.resetOnSnapFail) scenePosition(it.obj, it.fromPosition)
      log('Drag start', it.obj.name)
      return true
    },

    // pick(ray in world frame, exclude) → first hit, for drop destinations
    update(camDir, pickDrop) {
      for (const ev of events) for (const it of ev.items) {
        const p = it.pointer
        if (!p) { if (!it.paused) step(it); continue }
        pointerRay(p, _ray)
        const { data } = ev
        it.snapped = false
        let dest = null, entered = false
        if (data.drop) {
          dest = pickDrop(p, h => {
            for (let o = h.object; o; o = o.parent) if (o === it.obj) return false
            if (data.dropOn === 'all' || !data.dropOn) return true
            for (let o = h.object; o; o = o.parent) if (ev.dropDest.has(o)) return true
            return false
          })
        }
        if (dest) {
          // Snap: centre of the destination, or its surface
          _normal.copy(dest.face?.normal ?? _v.set(0, 1, 0))
            .applyMatrix3(_n3.getNormalMatrix(dest.object.matrixWorld))
            .transformDirection(sceneInverse())
          if (data.snapTo === 'surface') {
            it.fromPosition.copy(dest.point).applyMatrix4(sceneInverse())
            if (data.snapSurfaceMode === 'bbox') {
              // Rest the item's bounding box on the surface
              _box.setFromObject(it.obj).applyMatrix4(sceneInverse())
              const origin = scenePosition(it.obj, _d)
              let depth = 0
              for (let k = 0; k < 8; k++) {
                _c.set(k & 1 ? _box.max.x : _box.min.x, k & 2 ? _box.max.y : _box.min.y, k & 4 ? _box.max.z : _box.min.z)
                depth = Math.max(depth, _v.subVectors(origin, _c).dot(_normal))
              }
              it.fromPosition.addScaledVector(_normal, depth)
            } else it.fromPosition.addScaledVector(_normal, data.snapSurfaceOffset ?? 0)
          } else scenePosition(dest.object, it.fromPosition)
          if (data.autoOrient) {
            // Basis: X = up × n, Y = n × X, Z = n (runtime makeBasis)
            _b.set(0, 1, 0).cross(_normal)
            if (_b.length() < 1e-4) _b.set(-1, 0, 0).cross(_normal)
            _b.normalize()
            _c.crossVectors(_normal, _b)
            it.orientation.setFromRotationMatrix(_m.makeBasis(_b, _c, _normal))
          }
          it.pointStart.copy(it.fromPosition); it.pointEnd.copy(it.pointStart)
          it.damping = ev.snapDamping
          it.snapped = true
          if (it.lastDest !== dest.object) { it.lastDest = dest.object; entered = true; play(ev.dropActions) }
        } else {
          const wasSnapped = !!it.lastDest
          it.lastDest = null
          it.damping = data.dampingFactor ?? 1
          planePoint(it, _ray, camDir, it.pointEnd)
          if (wasSnapped) { it.pointStart.copy(it.pointEnd); revert(ev.dropActions) }
        }
        // Drag actions: once per gesture, reset after 500 ms without motion
        const moved = !it._last || it._last.distanceToSquared(it.pointEnd) > 1e-4
        if (moved) {
          ;(it._last ??= new Vector3()).copy(it.pointEnd)
          runActions(byType(ev.dragActions, DISPATCH), undefined)
          if (!ev.dragFired) { ev.dragFired = true; play(ev.dragActions) }
          clearTimeout(ev.dragTimer)
          ev.dragTimer = setTimeout(() => { if (ev.dragFired) { ev.dragFired = false; revert(ev.dragActions) } }, 500)
        }
        // Once settled on a destination, leave the item alone: the drop
        // transition (often "put the hat on the head") animates it from there.
        // With a mouse, Spline gets this for free when the pointer stops; an
        // XR pointer never stops completely.
        if (it.snapped && it.paused && !entered) continue
        step(it)
      }
    },

    end(p) {
      for (const ev of events) for (const it of ev.items) {
        if (it.pointer !== p) continue
        it.pointer = null
        it._last = null
        const { data } = ev
        if (!it.snapped && data.drop && data.resetOnSnapFail) {
          it.reset = data.resetOnSnapFail
          it.paused = false
          it.damping = ev.resetDamping
        }
        if (ev.dragFired) {
          ev.dragFired = false
          clearTimeout(ev.dragTimer)
          revert(ev.dragActions)
          runActions(byType(ev.dropActions, DISPATCH), undefined)
        }
        log('Drag end', it.obj.name, it.snapped ? '(snapped)' : '')
      }
    },

    dispose() {
      for (const ev of events) {
        clearTimeout(ev.dragTimer)
        for (const it of ev.items) { it.pointer = null }
      }
      events.length = 0
    },
  }
}
