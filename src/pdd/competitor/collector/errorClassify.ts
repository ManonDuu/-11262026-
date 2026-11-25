export type CollectorErrorCode =
  | 'nav_timeout'
  | 'nav_aborted'
  | 'target_closed'
  | 'browser_closed'
  | 'profile_in_use'
  | 'invalid_url'
  | 'net_error'
  | 'evaluate_failed'
  | 'context_destroyed'
  | 'unknown'

export interface CollectorLastError {
  code: CollectorErrorCode
  stage: string
  safeMessage: string
  action: string
  errorName: string
  occurredAt: number
}

const URL_LIKE = /https?:\/\/|(?:pxq_secret_key|share_ticket|share_uin|refer_share|oak_share|cookie|authorization)\s*=/i

function errorText(error: unknown): { name: string; message: string } {
  if (error && typeof error === 'object') {
    const name = 'name' in error && typeof error.name === 'string' ? error.name : ''
    const message = 'message' in error && typeof error.message === 'string' ? error.message : ''
    return { name, message }
  }
  return { name: '', message: String(error || '') }
}

export function classifyCollectorError(error: unknown, stage = 'unknown'): CollectorLastError {
  const { name, message } = errorText(error)
  const text = `${name} ${message}`
  let code: CollectorErrorCode = 'unknown'
  if (/TimeoutError|Timeout|exceeded .*timeout|Timeout \d+ms exceeded/i.test(text)) code = 'nav_timeout'
  else if (/profile.+in use|ProcessSingleton|already in use|user data dir.+in use|SingletonLock/i.test(text)) code = 'profile_in_use'
  else if (/Execution context was destroyed|most likely because of a navigation/i.test(text)) code = 'context_destroyed'
  else if (/Target closed|Target page, context or browser has been closed/i.test(text)) code = 'target_closed'
  else if (/browser has been closed|Browser closed|browserType\.launch/i.test(text) && /closed/i.test(text)) code = 'browser_closed'
  else if (/Invalid URL|ERR_INVALID_URL|Cannot navigate to invalid URL/i.test(text)) code = 'invalid_url'
  else if (/net::ERR_|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION/i.test(text)) code = 'net_error'
  else if (/Navigation failed because page was closed|frame was detached|NS_BINDING_ABORTED|ERR_ABORTED/i.test(text)) code = 'nav_aborted'
  else if (/evaluate|Protocol error|Execution context is not available/i.test(text)) code = 'evaluate_failed'

  const occurredAt = Date.now()
  const safeName = name && !URL_LIKE.test(name) ? name : 'Error'
  return {
    code,
    stage,
    errorName: safeName,
    occurredAt,
    safeMessage: safeMessageFor(code, stage),
    action: actionFor(code),
  }
}

export function safeMessageFor(code: CollectorErrorCode, stage: string): string {
  const stageHint = stage && stage !== 'unknown' ? `（阶段：${stage}）` : ''
  switch (code) {
    case 'nav_timeout':
      return `打开商品页超时${stageHint}。这还不能说明是平台限制。`
    case 'nav_aborted':
      return `打开商品页时导航被中断${stageHint}。`
    case 'target_closed':
      return `采集窗口或页面在打开过程中被关闭${stageHint}。`
    case 'browser_closed':
      return `采集浏览器已关闭${stageHint}。`
    case 'profile_in_use':
      return `采集专用窗口可能已经打开，无法重复启动${stageHint}。`
    case 'invalid_url':
      return `本次打开的商品地址不被接受${stageHint}。`
    case 'net_error':
      return `打开商品页时网络连接失败${stageHint}。这还不能说明是平台限制。`
    case 'evaluate_failed':
      return `页面已打开，但读取页面内容时失败${stageHint}。`
    case 'context_destroyed':
      return `打开页面时发生跳转，读取被中断${stageHint}。`
    default:
      return `打开或读取商品页时出错${stageHint}。这还不能说明是平台限制。`
  }
}

export function actionFor(code: CollectorErrorCode): string {
  switch (code) {
    case 'nav_timeout':
      return '请先确认本机网络。如需继续排查，点「复制诊断信息」发给我，并说明普通浏览器打开同一商品的结果。'
    case 'nav_aborted':
    case 'context_destroyed':
      return '请不要在打开过程中关闭或手动乱点采集窗口。可再试一次；若仍失败，复制诊断信息发给我。'
    case 'target_closed':
    case 'browser_closed':
      return '请保持采集窗口打开，不要手动关掉。可再试一次；若仍失败，复制诊断信息。'
    case 'profile_in_use':
      return '请先回到已打开的采集窗口，或先取消当前采集再试，不要同时开多个采集窗口。'
    case 'invalid_url':
      return '请重新粘贴并解析商品链接后再试。不要发送带完整跟踪参数的链接，只需告知商品编号。'
    case 'net_error':
      return '请检查网络后重试。若普通浏览器能打开而采集窗口不能，复制诊断信息发给我。'
    case 'evaluate_failed':
      return '请复制诊断信息发给我，不必反复无差别重试。'
    default:
      return '请复制诊断信息发给我。在看到具体错误类别前，不必反复无差别重试。'
  }
}

export function isRetryablePageError(code: CollectorErrorCode): boolean {
  return code === 'context_destroyed' || code === 'nav_aborted'
}

export function assertSanitizedError(info: CollectorLastError): void {
  const blob = JSON.stringify(info)
  if (URL_LIKE.test(blob)) throw new Error('诊断信息含有不能输出的内容')
}
