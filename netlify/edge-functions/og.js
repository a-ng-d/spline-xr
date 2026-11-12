// Preview tags (Open Graph / Twitter) for each /s/<id> link, in English or French
// depending on Accept-Language. Social networks do not run the page's JavaScript,
// so the HTML tags are rewritten before it is sent.
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/

const STRINGS = {
  en: {
    title: 'Spline scene in VR — SplineXR',
    titled: t => `${t} — SplineXR`,
    description: 'Explore this 3D scene in the browser or in VR on a Meta Quest headset.',
  },
  fr: {
    title: 'Scène Spline en VR — SplineXR',
    titled: t => `${t} — SplineXR`,
    description: 'Explore cette scène 3D dans le navigateur ou en VR sur un casque Meta Quest.',
  },
}

export function pickLanguage(header) {
  const langs = (header || '').toLowerCase().split(',').map(s => s.trim().slice(0, 2))
  return langs.find(l => STRINGS[l]) || 'en'
}

const escapeAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

// Title: the link's t parameter, as in the app (80 characters max)
const cleanTitle = t => (t || '').replace(/\s+/g, ' ').trim().slice(0, 80)

export function rewriteMeta(html, { origin, id, search = '', lang = 'en' }) {
  const s = STRINGS[lang] ?? STRINGS.en
  const params = new URLSearchParams(search)
  const title = cleanTitle(params.get('t'))
  const keep = new URLSearchParams()
  for (const k of ['t', 'f']) if (params.get(k)) keep.set(k, k === 't' ? title : params.get(k))
  const qs = keep.toString()
  const image = `${origin}/api/thumb/${id}${lang === 'en' ? '' : '?lang=' + lang}`
  const values = {
    'og:url': `${origin}/s/${id}${qs ? '?' + qs : ''}`,
    'og:image': image,
    'og:title': title ? s.titled(title) : s.title,
    'og:description': s.description,
    'twitter:image': image,
  }
  let out = html
  for (const [key, value] of Object.entries(values)) {
    const attr = key.startsWith('twitter:') ? 'name' : 'property'
    const re = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`)
    out = out.replace(re, `$1${escapeAttr(value)}$2`)
  }
  if (title) out = out.replace(/(<title[^>]*>)[^<]*(<\/title>)/, `$1${escapeAttr(s.titled(title))}$2`)
  return out
}

export default async (request, context) => {
  const url = new URL(request.url)
  const id = url.pathname.match(/^\/s\/([^/]+)\/?$/)?.[1]
  const response = await context.next()
  if (!id || !ID_RE.test(id)) return response
  if (!(response.headers.get('content-type') ?? '').includes('text/html')) return response

  const lang = pickLanguage(request.headers.get('accept-language'))
  const html = rewriteMeta(await response.text(), { origin: url.origin, id, search: url.search, lang })
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.append('vary', 'Accept-Language')
  return new Response(html, { status: response.status, headers })
}

export const config = { path: '/s/*' }
