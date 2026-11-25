import { describe, expect, it } from 'vitest'
import { frameFromPreset } from '../frameSpec'
import { appendHeroConstraints, buildHeroGenerationRules, heroUserChangedStyle } from './heroRules'
import { buildCompetitorImagePrompt } from './promptBuild'

describe('主图生成保真规则', () => {
  it('默认规则包含模仿风格、重新构图、适合类目、外形与赠品不变、不虚构功能', () => {
    const rules = buildHeroGenerationRules()
    expect(rules).toMatch(/模仿竞品的整体风格/)
    expect(rules).toMatch(/必须重新构图/)
    expect(rules).toMatch(/适合该产品类目/)
    expect(rules).toMatch(/产品和赠品/)
    expect(rules).toMatch(/不要凭空捏造或虚构产品功能/)
    expect(rules).not.toMatch(/本张须原样显示的卖点词原文/)
    expect(rules).not.toMatch(/先生成一张连续的详情长条图/)
  })

  it('用户改风格时不再强制默认模仿句，但外形和不虚构仍在', () => {
    expect(heroUserChangedStyle({ styleMode: 'custom' })).toBe(true)
    expect(heroUserChangedStyle({ styleMode: 'strict' })).toBe(false)
    const rules = buildHeroGenerationRules({ userChangedStyle: true })
    expect(rules).toMatch(/用户已明确指定主图风格/)
    expect(rules).toMatch(/产品和赠品/)
    expect(rules).toMatch(/不要凭空捏造或虚构产品功能/)
    expect(rules).not.toMatch(/默认主图风格规则：/)
  })

  it('手改 prompt 追加规则时不会混入详情逐字卖点或长图规则，也不会覆盖用户风格', () => {
    const prompt = appendHeroConstraints('请做成更明亮的棚拍风格主图', { userChangedStyle: true })
    expect(prompt).toMatch(/请做成更明亮的棚拍风格主图/)
    expect(prompt).toMatch(/用户已明确指定主图风格/)
    expect(prompt).toMatch(/产品和赠品/)
    expect(prompt).not.toMatch(/本张须原样显示的卖点词原文/)
    expect(prompt).not.toMatch(/按卖点分张生成的详情页/)
    expect(prompt).not.toMatch(/先生成一张连续的详情长条图/)
  })

  it('构建出的主图最终 prompt 与详情规则隔离', () => {
    const prompt = buildCompetitorImagePrompt({
      category: 'hero',
      styleMode: 'strict',
      sellingPoint: '结实耐玩',
      frameSpec: frameFromPreset('1:1'),
    })
    expect(prompt).toMatch(/模仿竞品风格并重新构图/)
    expect(prompt).toMatch(/适合该产品类目/)
    expect(prompt).toMatch(/产品和赠品/)
    expect(prompt).toMatch(/不要凭空捏造或虚构产品功能/)
    expect(prompt).not.toMatch(/本张须原样显示的卖点词原文/)
    expect(prompt).not.toMatch(/不要生成一整张超长图再裁切/)
    expect(prompt).not.toMatch(/按卖点分张/)
  })
})
