import { captureDomRuntimeSource, extractCompetitorDom, isLikelyLongImage } from './captureDom'
import {
  ALLOWED_IMAGE_TYPES,
  CAPTURE_ACK,
  CAPTURE_BLOCKED,
  CAPTURE_HELLO,
  CAPTURE_PROTOCOL_VERSION,
  CAPTURE_RESULT,
  MAX_IMAGE_BYTES,
  classifyLongImage,
  isAllowedWorkbenchOrigin,
} from './captureProtocol'

export function bookmarkletRunnerSource(): string {
  return [
    'var CAPTURE_PROTOCOL_VERSION = ' + JSON.stringify(CAPTURE_PROTOCOL_VERSION) + ';',
    'var CAPTURE_HELLO = ' + JSON.stringify(CAPTURE_HELLO) + ';',
    'var CAPTURE_ACK = ' + JSON.stringify(CAPTURE_ACK) + ';',
    'var CAPTURE_RESULT = ' + JSON.stringify(CAPTURE_RESULT) + ';',
    'var CAPTURE_BLOCKED = ' + JSON.stringify(CAPTURE_BLOCKED) + ';',
    'var MAX_IMAGE_BYTES = ' + JSON.stringify(MAX_IMAGE_BYTES) + ';',
    'var ALLOWED_IMAGE_TYPES = ' + JSON.stringify(ALLOWED_IMAGE_TYPES) + ';',
    isAllowedWorkbenchOrigin.toString(),
    collectImageBytes.toString(),
    classifyLongImage.toString(),
    runCompetitorCapture.toString(),
  ].join('\n')
}

export function buildBookmarkletHref(workbenchOrigin: string): string {
  if (!isAllowedWorkbenchOrigin(workbenchOrigin)) {
    throw new Error('采集书签只能指向本机工作台地址。')
  }
  const source = `(function(){${captureDomRuntimeSource()};${bookmarkletRunnerSource()};runCompetitorCapture(${JSON.stringify(workbenchOrigin)});})();`
  return `javascript:${encodeURIComponent(source)}`
}

export async function collectImageBytes(url: string): Promise<{ blob: Blob | null; mimeType: string; byteLength: number; status: 'ok' | 'unavailable' | 'over_limit' | 'invalid_type' }> {
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit' })
    if (!response.ok) return { blob: null, mimeType: '', byteLength: 0, status: 'unavailable' }
    const blob = await response.blob()
    if (blob.size > MAX_IMAGE_BYTES) return { blob: null, mimeType: blob.type, byteLength: blob.size, status: 'over_limit' }
    let mimeType = blob.type || 'image/jpeg'
    if ((ALLOWED_IMAGE_TYPES as readonly string[]).indexOf(mimeType) < 0 && !/^image\//.test(mimeType)) {
      return { blob: null, mimeType, byteLength: blob.size, status: 'invalid_type' }
    }
    if ((ALLOWED_IMAGE_TYPES as readonly string[]).indexOf(mimeType) < 0) mimeType = 'image/jpeg'
    return { blob, mimeType, byteLength: blob.size, status: 'ok' }
  } catch {
    return { blob: null, mimeType: '', byteLength: 0, status: 'unavailable' }
  }
}

export function runCompetitorCapture(workbenchOrigin: string): void {
  var opener = window.opener
  if (!opener) {
    window.alert('请先回到工作台，点击「打开商品页并登录」，在新打开的这个页面里再点采集书签。这样图片才能传回工作台。')
    return
  }
  if (!isAllowedWorkbenchOrigin(workbenchOrigin)) {
    window.alert('工作台地址不是本机地址，已停止采集。')
    return
  }
  var extracted = extractCompetitorDom(document)
  var goodsId = extracted.goodsId
  if (!goodsId) {
    try { goodsId = new URL(location.href).searchParams.get('goods_id') } catch (_err) { goodsId = null }
  }
  if (extracted.blocked) {
    opener.postMessage({
      version: CAPTURE_PROTOCOL_VERSION,
      type: CAPTURE_BLOCKED,
      goodsId: goodsId || '',
      reason: extracted.blockReason,
      message: extracted.blockMessage,
    }, workbenchOrigin)
    return
  }
  if (!goodsId) {
    window.alert('没有识别到商品编号，已停止采集。')
    return
  }
  opener.postMessage({ version: CAPTURE_PROTOCOL_VERSION, type: CAPTURE_HELLO, goodsId: goodsId }, workbenchOrigin)

  var timeout = window.setTimeout(function () {
    window.removeEventListener('message', onAck)
    window.alert('工作台没有应答。请确认是从工作台打开的这个商品页，然后再试一次。')
  }, 8000)

  function onAck(event: MessageEvent) {
    if (event.origin !== workbenchOrigin) return
    if (event.source !== opener) return
    var data = event.data || {}
    if (data.version !== CAPTURE_PROTOCOL_VERSION || data.type !== CAPTURE_ACK) return
    if (data.goodsId !== goodsId) return
    window.clearTimeout(timeout)
    window.removeEventListener('message', onAck)
    var sessionId = data.sessionId
    var all = extracted.hero.concat(extracted.detail, extracted.optionImages)
    Promise.all(all.map(function (item) {
      return collectImageBytes(item.sourceUrl).then(function (bytes) {
        var longImage = classifyLongImage({
          width: item.width || undefined,
          height: item.height || undefined,
          bytesStatus: bytes.status,
          likelyLong: item.likelyLongImage,
        })
        return {
          id: item.id,
          category: item.category,
          order: item.order,
          fileName: (item.category + '-' + item.order + '.jpg'),
          mimeType: bytes.mimeType,
          byteLength: bytes.byteLength,
          width: item.width || undefined,
          height: item.height || undefined,
          sourceKey: item.sourceUrl,
          bytesStatus: bytes.status,
          longImage: longImage,
          blob: bytes.blob,
        }
      })
    })).then(function (images) {
      opener.postMessage({
        version: CAPTURE_PROTOCOL_VERSION,
        type: CAPTURE_RESULT,
        sessionId: sessionId,
        goodsId: goodsId,
        images: images,
        options: extracted.options.map(function (option) {
          return { optionName: option.optionName, contentsNote: option.contentsNote, imageId: option.imageLocalId }
        }),
        message: extracted.notes.join(' '),
      }, workbenchOrigin)
    })
  }
  window.addEventListener('message', onAck)
}

