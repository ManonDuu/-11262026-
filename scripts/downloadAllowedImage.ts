import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isDisallowedIp, parseImageUrl, IMAGE_GUARD_LIMITS } from '../src/pdd/competitor/collector/imageGuard'

const REFERER = 'https://mobile.yangkeduo.com/'

export async function assertSafeImageUrl(raw: string): Promise<URL> {
  const parsed = parseImageUrl(raw)
  if (!parsed.ok) throw new Error(parsed.reason)
  const host = parsed.url.hostname
  if (isIP(host)) {
    if (isDisallowedIp(host)) throw new Error('图片地址指向了不允许的网络位置。')
    return parsed.url
  }
  const records = await lookup(host, { all: true })
  if (!records.length || records.some((item) => isDisallowedIp(item.address))) {
    throw new Error('图片域名解析到了不允许的地址。')
  }
  return parsed.url
}

export async function downloadAllowedImage(raw: string): Promise<{ bytes: Uint8Array; mimeType: string; status: 'ok' | 'unavailable' | 'over_limit' | 'invalid_type' }> {
  let current = raw
  for (let i = 0; i <= IMAGE_GUARD_LIMITS.MAX_REDIRECTS; i += 1) {
    const url = await assertSafeImageUrl(current)
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { Referer: REFERER, Accept: 'image/*' },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return { bytes: new Uint8Array(), mimeType: '', status: 'unavailable' }
      current = new URL(location, url).toString()
      continue
    }
    if (!response.ok) return { bytes: new Uint8Array(), mimeType: '', status: 'unavailable' }
    const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim() || 'image/jpeg'
    if (!IMAGE_GUARD_LIMITS.ALLOWED_TYPES.includes(mimeType) && !mimeType.startsWith('image/')) {
      return { bytes: new Uint8Array(), mimeType, status: 'invalid_type' }
    }
    const lengthHeader = Number(response.headers.get('content-length') || 0)
    if (lengthHeader > IMAGE_GUARD_LIMITS.MAX_IMAGE_BYTES) return { bytes: new Uint8Array(), mimeType, status: 'over_limit' }
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength > IMAGE_GUARD_LIMITS.MAX_IMAGE_BYTES) return { bytes: new Uint8Array(), mimeType, status: 'over_limit' }
    const allowed = IMAGE_GUARD_LIMITS.ALLOWED_TYPES.includes(mimeType) ? mimeType : 'image/jpeg'
    return { bytes: buffer, mimeType: allowed, status: 'ok' }
  }
  return { bytes: new Uint8Array(), mimeType: '', status: 'unavailable' }
}
