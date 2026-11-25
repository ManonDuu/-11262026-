/* 扩展本地诊断，不读写 cookie，不把密钥写入状态。 */
(function (root) {
  var STAGES = {
    url_rejected: { title: 'URL 已拒绝', badge: 'URL' },
    pairing_missing: { title: '尚未配对', badge: '配对' },
    pairing_expired: { title: '配对已过期', badge: '过期' },
    injection_error: { title: '页面注入失败', badge: '注入' },
    parse_blocked: { title: '页面解析被拦', badge: '被拦' },
    parse_empty: { title: '页面没有可采集图片', badge: '空图' },
    goods_mismatch: { title: '商品身份不符', badge: '不符' },
    send_network_error: { title: '发送到工作台失败', badge: '发送' },
    http_rejected: { title: '工作台拒绝接收', badge: '拒绝' },
    download_failed: { title: '图片下载失败', badge: '下载' },
    partial: { title: '导入未完成验收', badge: '部分' },
    success: { title: '已保存三类图片', badge: '完成' },
  }

  var DIAGNOSTIC_ONLY = {
    url_rejected: true,
    pairing_missing: true,
    pairing_expired: true,
    injection_error: true,
    parse_blocked: true,
    parse_empty: true,
    goods_mismatch: true,
    send_network_error: true,
    http_rejected: true,
  }

  function isCaptureStage(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STAGES, value)
  }

  function isDiagnosticOnlyStage(stage) {
    return isCaptureStage(stage) && DIAGNOSTIC_ONLY[stage] === true
  }

  function normalizeGoodsId(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null
    var text = String(value).trim()
    return /^\d{6,20}$/.test(text) ? text : null
  }

  function isPageEvidenceSource(source) {
    return source === 'og_url' || source === 'dom'
  }

  function evaluateGoodsIdentity(input) {
    var expected = normalizeGoodsId(input && input.expectedGoodsId)
    var observed = normalizeGoodsId(input && input.observedGoodsId)
    var source = input && (input.itemIdSource === 'location_query' || input.itemIdSource === 'og_url' || input.itemIdSource === 'dom')
      ? input.itemIdSource
      : null
    if (!expected) return { status: 'unverified', reason: '工作台未设置目标商品编号，不能认定商品身份通过。' }
    if (!observed) return { status: 'unverified', reason: '页面没有可核验的商品编号证据，不能仅凭地址栏或缺失值认定通过。' }
    if (observed !== expected) return { status: 'mismatch', reason: '页面商品编号与目标不一致，已停止采集。' }
    if (!isPageEvidenceSource(source)) return { status: 'unverified', reason: '仅有地址栏商品编号，还不能代替商品详情证据。' }
    return { status: 'verified', reason: '页面详情证据与目标商品编号一致。' }
  }

  function sanitizeCaptureId(value) {
    if (typeof value !== 'string') return ''
    var text = value.trim()
    if (text.length < 8 || text.length > 64) return ''
    return /^[a-z0-9-]+$/i.test(text) ? text : ''
  }

  function createCaptureId() {
    var bytes = new Uint8Array(8)
    if (root.crypto && typeof root.crypto.getRandomValues === 'function') root.crypto.getRandomValues(bytes)
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
    var hex = Array.prototype.map.call(bytes, function (item) { return item.toString(16).padStart(2, '0') }).join('')
    return 'cap-' + hex
  }

  function redactUrl(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return ''
    try {
      var url = new URL(raw, 'https://mobile.yangkeduo.com/')
      return (url.hostname || '') + (url.pathname || '').slice(0, 80)
    } catch (err) {
      return '(invalid-url)'
    }
  }

  function clipMessage(value, max) {
    if (typeof value !== 'string') return ''
    var text = value
      .replace(/https?:\/\/[^\s]+/gi, function (match) { return redactUrl(match) || '(redacted)' })
      .replace(/[a-f0-9]{32,}/gi, '[redacted]')
      .trim()
    return text.slice(0, max || 300)
  }

  function stageTitle(stage) {
    return isCaptureStage(stage) ? STAGES[stage].title : '采集状态'
  }

  function stageBadge(stage) {
    return isCaptureStage(stage) ? STAGES[stage].badge : '!'
  }

  function formatLocalStatus(event) {
    return stageTitle(event.stage) + '（' + event.stage + '）\n采集编号：' + event.captureId + '\n' + (event.message || '')
  }

  function safeExtensionPath(url) {
    try {
      var path = new URL(url).pathname || ''
      path = path.split('?')[0]
      if (/^\/goods(?:2)?\.html$/i.test(path)) return { path: path, pathKind: 'goods' }
      if (/^\/login(?:\.html)?$/i.test(path)) return { path: '/login.html', pathKind: 'sensitive' }
      if (path === '/' || /^\/(?:index|home)\.html?$/i.test(path) || /^\/(?:personal|person|orders?|user(?:info)?|wallet|chat|favorite|collect|address(?:es)?|coupon|bill|settings?|account|member|profile)(?:\.html)?$/i.test(path)) {
        return { path: null, pathKind: 'sensitive' }
      }
      return { path: null, pathKind: 'other' }
    } catch (err) {
      return { path: null, pathKind: 'unknown' }
    }
  }

  root.__pddCaptureDiagnostics = {
    STAGES: STAGES,
    isCaptureStage: isCaptureStage,
    isDiagnosticOnlyStage: isDiagnosticOnlyStage,
    normalizeGoodsId: normalizeGoodsId,
    evaluateGoodsIdentity: evaluateGoodsIdentity,
    sanitizeCaptureId: sanitizeCaptureId,
    createCaptureId: createCaptureId,
    redactUrl: redactUrl,
    clipMessage: clipMessage,
    stageTitle: stageTitle,
    stageBadge: stageBadge,
    formatLocalStatus: formatLocalStatus,
    safeExtensionPath: safeExtensionPath,
  }
})(typeof self !== 'undefined' ? self : globalThis)
