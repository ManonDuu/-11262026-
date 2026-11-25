import { isAllowedWorkbenchOrigin, isLoopbackAddress } from '../collector/accessGuard'

const EXTENSION_ORIGIN = /^chrome-extension:\/\/([a-p]{32})$/i

export function parseChromeExtensionOrigin(origin: string | undefined): string | null {
  if (!origin) return null
  const match = origin.trim().match(EXTENSION_ORIGIN)
  return match ? match[1].toLowerCase() : null
}

export function isChromeExtensionOrigin(origin: string | undefined): boolean {
  return Boolean(parseChromeExtensionOrigin(origin))
}

/** @deprecated Prefer isExactWorkbenchOrigin against the actual Host. */
export function isWorkbenchPairingOrigin(origin: string | undefined): boolean {
  return isAllowedWorkbenchOrigin(origin)
}

export function isLoopbackPeer(address: string | null | undefined): boolean {
  return isLoopbackAddress(address)
}

export function isExactWorkbenchHost(host: string | undefined, port = '5173'): boolean {
  return host === `127.0.0.1:${port}`
}

export function exactWorkbenchOrigin(expectedHost: string): string {
  return `http://${expectedHost}`
}

export function isExactWorkbenchOrigin(origin: string | undefined, expectedHost: string): boolean {
  return Boolean(origin) && origin === exactWorkbenchOrigin(expectedHost)
}

function isRefererFromExactOrigin(referer: string | undefined, expectedOrigin: string): boolean {
  if (!referer) return false
  try {
    const url = new URL(referer)
    if (url.username || url.password) return false
    return `${url.protocol}//${url.host}` === expectedOrigin
  } catch {
    return false
  }
}

export type WorkbenchGetTrust =
  | { ok: true; via: 'origin' | 'sec-fetch-site' | 'referer' }
  | { ok: false }

/**
 * Trust a workbench pairing GET. Browsers often omit Origin on same-origin GET.
 * Do not use this for POST: mutations still require an exact Origin plus CSRF.
 *
 * Acceptance, after loopback + exact Host have already been checked:
 * - Origin is exactly http://127.0.0.1:<port>
 * - or no Origin, and Sec-Fetch-Site is same-origin (cannot be set by page script).
 *   If Referer is also present, it must be the same exact origin.
 * - or no Origin and no Sec-Fetch-Site, but Referer is the exact workbench origin
 *   (older clients). Missing all three is rejected, as is cross-site.
 */
export function canReadWorkbenchPairingGet(input: {
  expectedHost: string
  host?: string
  origin?: string
  referer?: string
  secFetchSite?: string
}): WorkbenchGetTrust {
  if (!input.host || input.host !== input.expectedHost) return { ok: false }
  const expected = exactWorkbenchOrigin(input.expectedHost)
  if (input.origin) {
    return input.origin === expected ? { ok: true, via: 'origin' } : { ok: false }
  }
  const site = (input.secFetchSite || '').trim().toLowerCase()
  if (site === 'same-origin') {
    if (input.referer && !isRefererFromExactOrigin(input.referer, expected)) return { ok: false }
    return { ok: true, via: 'sec-fetch-site' }
  }
  if (site && site !== 'same-origin') return { ok: false }
  if (isRefererFromExactOrigin(input.referer, expected)) return { ok: true, via: 'referer' }
  return { ok: false }
}
