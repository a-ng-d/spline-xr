// Preview without a headset: the scene runs in the official Spline runtime, with
// its whole engine (animations, states, audio, mouse interactions).
//
// The runtime cannot do VR: Spline removed the WebXR module from its bundled
// three.js (setSession throws "WebXR is not supported by the Spline
// runtime"). With a headset, the home-made engine takes over.
import { Application } from '@splinetool/runtime'

// The runtime does not expose preserveDrawingBuffer: it is forced on this canvas
// so that the link preview image can be taken at any time.
function preserveDrawingBuffer(canvas) {
  const orig = canvas.getContext.bind(canvas)
  canvas.getContext = (type, attrs = {}) =>
    orig(type, /webgl/.test(type) ? { ...attrs, preserveDrawingBuffer: true } : attrs)
}

/**
 * @param {string} url  .splinecode URL (already through the proxy)
 * @param {HTMLElement} parent  container in which to create the canvas
 */
export async function createSplinePreview(url, parent) {
  // A fresh canvas per scene: the WebGL context of a disposed runtime cannot be reused
  const canvas = document.createElement('canvas')
  canvas.className = 'spline-canvas'
  preserveDrawingBuffer(canvas)
  parent.append(canvas)
  const app = new Application(canvas, { renderer: 'webgl' })
  try {
    await app.load(url)
  } catch (e) {
    try { app.dispose() } catch {}
    canvas.remove()
    throw e
  }
  return {
    app,
    canvas,
    dispose() {
      try { app.stop?.() } catch {}
      try { app.dispose() } catch {}
      canvas.remove()
    },
  }
}
