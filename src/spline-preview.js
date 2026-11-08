// Aperçu sans casque : la scène tourne dans le runtime officiel de Spline, avec
// tout son moteur (animations, états, audio, interactions à la souris).
//
// Le runtime ne sait pas faire de VR : Spline a retiré le module WebXR de son
// three.js embarqué (setSession lève « WebXR is not supported by the Spline
// runtime »). Avec un casque, c'est donc le moteur maison qui prend le relais.
import { Application } from '@splinetool/runtime'

// Le runtime n'expose pas preserveDrawingBuffer : on le force sur ce canvas pour
// pouvoir en tirer l'image d'aperçu du lien à tout moment.
function preserveDrawingBuffer(canvas) {
  const orig = canvas.getContext.bind(canvas)
  canvas.getContext = (type, attrs = {}) =>
    orig(type, /webgl/.test(type) ? { ...attrs, preserveDrawingBuffer: true } : attrs)
}

/**
 * @param {string} url  URL .splinecode (déjà passée par le proxy)
 * @param {HTMLCanvasElement} parent  conteneur où créer le canvas
 */
export async function createSplinePreview(url, parent) {
  // Un canvas neuf par scène : le contexte WebGL d'un runtime libéré n'est pas réutilisable
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
