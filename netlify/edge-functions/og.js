// Balises d'aperçu (Open Graph / Twitter) propres à chaque lien /s/<id>.
// Les réseaux sociaux ne lancent pas le JavaScript de la page : on réécrit
// donc les balises du HTML avant de l'envoyer.
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/

const escapeAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

export function rewriteMeta(html, { origin, id }) {
  const values = {
    'og:url': `${origin}/s/${id}`,
    'og:image': `${origin}/api/thumb/${id}`,
    'og:title': 'Scène Spline en VR — SplineXR',
    'og:description': 'Explore cette scène 3D dans le navigateur ou en VR sur casque Meta Quest.',
    'twitter:image': `${origin}/api/thumb/${id}`,
  }
  let out = html
  for (const [key, value] of Object.entries(values)) {
    const attr = key.startsWith('twitter:') ? 'name' : 'property'
    const re = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`)
    out = out.replace(re, `$1${escapeAttr(value)}$2`)
  }
  return out
}

export default async (request, context) => {
  const url = new URL(request.url)
  const id = url.pathname.match(/^\/s\/([^/]+)\/?$/)?.[1]
  const response = await context.next()
  if (!id || !ID_RE.test(id)) return response
  if (!(response.headers.get('content-type') ?? '').includes('text/html')) return response

  const html = rewriteMeta(await response.text(), { origin: url.origin, id })
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new Response(html, { status: response.status, headers })
}

export const config = { path: '/s/*' }
