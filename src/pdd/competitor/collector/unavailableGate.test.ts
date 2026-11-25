import { describe, expect, it } from 'vitest'
import {
  UNAVAILABLE_HOLD_WINDOW_MS,
  UNAVAILABLE_RECONFIRM_INITIAL_MS,
  UNAVAILABLE_RECONFIRM_MAX_MS,
  UNAVAILABLE_UNCONFIRMED_DEADLINE_MS,
  buildJobPageSignals,
  decideUnavailableRecheck,
  holdWindowBeforeClose,
  matchItemId,
  UNCONFIRMED_UNAVAILABLE_MESSAGE,
} from './unavailableGate'
import { sanitizeUrlPath } from '../captureDom'

describe('decideUnavailableRecheck', () => {
  it('首次命中后未满 1.5 秒不终态，即使文案已确认', () => {
    expect(decideUnavailableRecheck({
      firstHitAt: 1000,
      now: 1000 + UNAVAILABLE_RECONFIRM_INITIAL_MS - 1,
      decision: 'unavailable',
      confirmed: true,
    })).toBe('wait_more')
  })

  it('复核确认仍不可访问后才终态', () => {
    expect(decideUnavailableRecheck({
      firstHitAt: 1000,
      now: 1000 + UNAVAILABLE_RECONFIRM_INITIAL_MS,
      decision: 'unavailable',
      confirmed: true,
    })).toBe('finalize')
  })

  it('首屏闪现后恢复为可采集则交给其他分支', () => {
    expect(decideUnavailableRecheck({
      firstHitAt: 1000,
      now: 1000 + UNAVAILABLE_RECONFIRM_INITIAL_MS,
      decision: 'proceed',
      confirmed: false,
    })).toBe('abort_to_other')
  })

  it('整页待确认在截止前继续复核，不取图也不重置为新的首次命中', () => {
    expect(UNAVAILABLE_UNCONFIRMED_DEADLINE_MS).toBeGreaterThan(UNAVAILABLE_RECONFIRM_MAX_MS)
    expect(decideUnavailableRecheck({
      firstHitAt: 1000,
      now: 1000 + UNAVAILABLE_RECONFIRM_MAX_MS,
      decision: 'unavailable',
      confirmed: false,
    })).toBe('wait_more')
    expect(decideUnavailableRecheck({
      firstHitAt: 1000,
      now: 1000 + UNAVAILABLE_UNCONFIRMED_DEADLINE_MS - 1,
      decision: 'unavailable',
      confirmed: false,
    })).toBe('wait_more')
  })

  it('覆盖真实 175 秒循环机制：计时不得重置，到期必须终态且不宣称已下架', () => {
    const firstHitAt = 1000
    const loopMs = 175_000
    // 旧逻辑在每次 keep_waiting 后把 firstHitAt 清零，175 秒后仍会继续等。
    let oldFirst = firstHitAt
    let oldStillWaiting = false
    for (let now = firstHitAt; now <= firstHitAt + loopMs; now += 10_000) {
      const elapsed = now - oldFirst
      if (elapsed >= UNAVAILABLE_RECONFIRM_MAX_MS) {
        oldStillWaiting = true
        oldFirst = now
      }
    }
    expect(oldStillWaiting).toBe(true)
    expect(decideUnavailableRecheck({
      firstHitAt,
      now: firstHitAt + loopMs,
      decision: 'unavailable',
      confirmed: false,
    })).toBe('finalize_unconfirmed')
    expect(decideUnavailableRecheck({
      firstHitAt,
      now: firstHitAt + UNAVAILABLE_UNCONFIRMED_DEADLINE_MS,
      decision: 'unavailable',
      confirmed: false,
    })).toBe('finalize_unconfirmed')
    expect(UNCONFIRMED_UNAVAILABLE_MESSAGE).toMatch(/未能确认/)
    expect(UNCONFIRMED_UNAVAILABLE_MESSAGE).toMatch(/不能说明商品已经下架/)
    expect(UNCONFIRMED_UNAVAILABLE_MESSAGE).toMatch(/不会采集推荐/)
  })
})

describe('page signals', () => {
  it('路径去掉查询参数，商品编号一致，耗时按启动时间计算', () => {
    expect(sanitizeUrlPath('https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001&pxq_secret_key=TEST_SECRET_DO_NOT_STORE')).toBe('/goods2.html')
    expect(matchItemId('100000000001', '100000000001')).toBe(true)
    expect(matchItemId('1', '2')).toBe(false)
    expect(matchItemId(null, '100000000001')).toBe(null)
    const signals = buildJobPageSignals({
      startedAt: 10_000,
      now: 26_267,
      expectedGoodsId: '100000000001',
      snap: {
        goodsId: '100000000001',
        pageSignals: { rule: 'sold_out_similar', urlPath: '/goods2.html', itemIdMatch: true, confirmed: true },
      },
    })
    expect(signals).toEqual({
      rule: 'sold_out_similar',
      urlPath: '/goods2.html',
      itemIdMatch: true,
      itemIdSource: null,
      elapsedMs: 16_267,
    })
    expect(JSON.stringify(signals)).not.toMatch(/pxq_secret|cookie|TEST_SECRET|https?:/i)
  })
})

describe('holdWindowBeforeClose', () => {
  it('取消后立即结束等待', async () => {
    const job = { cancelRequested: false }
    const calls: number[] = []
    const pending = holdWindowBeforeClose(job, UNAVAILABLE_HOLD_WINDOW_MS, async (ms) => {
      calls.push(ms)
      job.cancelRequested = true
    })
    await pending
    expect(calls.length).toBe(1)
  })
})
