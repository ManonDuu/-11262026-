/** 采集图片下载的地址检查：只允许常见商品图 CDN，拒绝内网和任意代理。 */

const ALLOWED_IMAGE_HOSTS = new Set(['yangkeduo.com', 'pddpic.com', 'pinduoduo.com'])
const ALLOWED_IMAGE_SUFFIXES = ['.yangkeduo.com', '.pddpic.com', '.pinduoduo.com']
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_REDIRECTS = 3
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export const IMAGE_GUARD_LIMITS = { MAX_IMAGE_BYTES, MAX_REDIRECTS, ALLOWED_TYPES }

export function isDisallowedIp(address: string): boolean {
  const value = address.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (value === '::1' || value === '::' || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) return true
  if (value.includes(':')) {
    if (value.startsWith('::ffff:')) return isDisallowedIp(value.slice('::ffff:'.length))
    return true
  }
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

export function isAllowedImageHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && isDisallowedIp(host)) return false
  if (ALLOWED_IMAGE_HOSTS.has(host)) return true
  return ALLOWED_IMAGE_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

export function parseImageUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  const text = String(raw || '').trim()
  if (!text) return { ok: false, reason: '图片地址为空。' }
  if (/^\s*(javascript|data|file|vbscript|blob):/i.test(text)) return { ok: false, reason: '不支持的图片地址协议。' }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { ok: false, reason: '图片地址无法解析。' }
  }
  if (url.protocol !== 'https:') return { ok: false, reason: '只允许 https 商品图地址。' }
  if (url.username || url.password) return { ok: false, reason: '图片地址不能带账号信息。' }
  if (!isAllowedImageHost(url.hostname)) return { ok: false, reason: '图片地址不在允许的商品 CDN 域名内。' }
  return { ok: true, url }
}

export function sanitizeImageLogUrl(raw: string): string {
  const parsed = parseImageUrl(raw)
  if (!parsed.ok) return '[rejected-image-url]'
  return `${parsed.url.protocol}//${parsed.url.hostname}${parsed.url.pathname}`
}
