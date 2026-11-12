// Scene previews: /api/thumb/<Spline ID>
//   GET            → the scene's JPEG image, or the default image if none (?lang=fr: French one)
//   GET ?exists=1  → { exists: boolean } (used by the app before capturing)
//   PUT            → stores the uploaded image (JPEG ≤ 500 KB)
// Storage: Netlify Blobs (key → file store, no database).
import { getStore } from '@netlify/blobs'
import { purgeCache } from '@netlify/functions'

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/
const MAX_BYTES = 500 * 1024
const tag = id => `thumb-${id}`

export default async (req, context) => {
  const id = context.params.id
  if (!ID_RE.test(id ?? '')) return new Response('Invalid ID', { status: 400 })

  const store = getStore('thumbnails')
  const url = new URL(req.url)

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (url.searchParams.has('exists')) {
      const meta = await store.getMetadata(id)
      return Response.json({ exists: !!meta }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const data = await store.get(id, { type: 'arrayBuffer' })
    if (!data) {
      // No preview yet: default image, not cached so that the capture shows up as
      // soon as it exists
      const fallback = url.searchParams.get('lang') === 'fr' ? '/og-default-fr.jpg' : '/og-default.jpg'
      return new Response(null, {
        status: 302,
        headers: { Location: fallback, 'Cache-Control': 'no-store' },
      })
    }
    return new Response(req.method === 'HEAD' ? null : data, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=300',
        'Netlify-CDN-Cache-Control': 'public, s-maxage=31536000, durable',
        'Netlify-Cache-Tag': tag(id),
      },
    })
  }

  if (req.method === 'PUT') {
    const len = Number(req.headers.get('content-length') ?? 0)
    if (len > MAX_BYTES) return new Response('Image too large', { status: 413 })
    const buf = new Uint8Array(await req.arrayBuffer())
    if (buf.length === 0 || buf.length > MAX_BYTES) return new Response('Invalid size', { status: 413 })
    // JPEG signature: FF D8 FF
    if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
      return new Response('JPEG expected', { status: 415 })
    }
    await store.set(id, buf, { metadata: { updated: new Date().toISOString() } })
    try { await purgeCache({ tags: [tag(id)] }) } catch (e) { console.warn('purgeCache', e.message) }
    return Response.json({ ok: true })
  }

  return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD, PUT' } })
}

export const config = { path: '/api/thumb/:id' }
