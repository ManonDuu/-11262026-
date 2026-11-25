import { describe, expect, it } from 'vitest'
import { planDetailSellingPointPages, splitSellingPointItems } from './detailPages'
import type { CompetitorRefImage } from './types'

function ref(partial: Partial<CompetitorRefImage> & Pick<CompetitorRefImage, 'id'>): CompetitorRefImage {
  return {
    category: 'detail',
    asset: { id: partial.id, imageId: partial.id, name: `${partial.id}.png`, width: 800, height: 1000 },
    optionName: '',
    contentsNote: '',
    sellingPoint: '',
    sceneHint: '',
    layoutSummary: '信息密集，上图下文',
    analysisStatus: 'model_suggested',
    source: 'manual_import',
    ...partial,
  }
}

describe('按卖点分张规划详情页', () => {
  it('把卖点词按换行或分号拆开，并去掉序号', () => {
    expect(splitSellingPointItems('1. 加厚合金臂\n2、360度旋转；3) 一键破碎')).toEqual([
      '加厚合金臂',
      '360度旋转',
      '一键破碎',
    ])
  })

  it('默认按已确认卖点词原文分张，不按竞品图片张数硬凑', () => {
    const { pages, directives } = planDetailSellingPointPages({
      refs: [
        ref({
          id: 'd1',
          sellingPoint: '加厚合金臂',
          sellingPointCore: '加厚合金臂',
          sellingPointClaims: [
            { id: 'sp-d1-1', core: '加厚合金臂', origin: 'competitor_reference', status: 'confirmed' },
            { id: 'sp-d1-2', core: '360度旋转', origin: 'competitor_reference', status: 'confirmed' },
          ],
        }),
        ref({
          id: 'd2',
          sellingPoint: '一键破碎',
          sellingPointCore: '一键破碎',
          sellingPointClaims: [
            { id: 'sp-d2-1', core: '一键破碎', origin: 'competitor_reference', status: 'confirmed' },
          ],
        }),
      ],
    })
    expect(pages.map((page) => page.sellingPointText)).toEqual(['加厚合金臂', '360度旋转', '一键破碎'])
    expect(pages).toHaveLength(3)
    expect(directives.userChangedSellingPoints).toBe(false)
    expect(pages[0].refImageId).toBe('d1')
    expect(pages[2].refImageId).toBe('d2')
  })

  it('待确认卖点不进入生成页，旧数据可从卖点原文回退', () => {
    const planned = planDetailSellingPointPages({
      refs: [
        ref({
          id: 'd1',
          sellingPoint: '加厚合金臂',
          sellingPointClaims: [
            { id: 'sp-d1-1', core: '加厚合金臂', origin: 'competitor_reference', status: 'confirmed' },
            { id: 'sp-d1-2', core: '疑似进口液压', origin: 'competitor_reference', status: 'unconfirmed' },
          ],
        }),
      ],
    })
    expect(planned.pages.map((page) => page.sellingPointText)).toEqual(['加厚合金臂'])
    expect(planned.pages[0].unconfirmedFacts).toContain('疑似进口液压')

    const legacy = planDetailSellingPointPages({
      refs: [ref({ id: 'old', sellingPoint: '加厚合金臂；360度旋转', analysisStatus: undefined })],
    })
    expect(legacy.pages.map((page) => page.sellingPointText)).toEqual(['加厚合金臂', '360度旋转'])
    expect(legacy.directives.userChangedSellingPoints).toBe(false)
  })

  it('用户只改风格时保留默认卖点词；只改卖点时按用户原文分张', () => {
    const refs = [
      ref({ id: 'd1', sellingPoint: '加厚合金臂', sellingPointCore: '加厚合金臂' }),
    ]
    const styleOnly = planDetailSellingPointPages({
      refs,
      detailStyleNote: '留白多、大标题在上',
    })
    expect(styleOnly.pages.map((page) => page.sellingPointText)).toEqual(['加厚合金臂'])
    expect(styleOnly.directives.userChangedStyle).toBe(true)
    expect(styleOnly.directives.userChangedSellingPoints).toBe(false)
    expect(styleOnly.pages[0].layoutSummary).toMatch(/留白多、大标题在上/)

    const sellingOnly = planDetailSellingPointPages({
      refs,
      detailSellingPointNote: '强化钢臂\n夜间警示灯',
    })
    expect(sellingOnly.pages.map((page) => page.sellingPointText)).toEqual(['强化钢臂', '夜间警示灯'])
    expect(sellingOnly.directives.userChangedSellingPoints).toBe(true)
    expect(sellingOnly.directives.userChangedStyle).toBe(false)
  })

  it('没有卖点时不按竞品张数生成空卡', () => {
    const { pages } = planDetailSellingPointPages({
      refs: [ref({ id: 'd1' }), ref({ id: 'd2' })],
    })
    expect(pages).toEqual([])
  })
})
