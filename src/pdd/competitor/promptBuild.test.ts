import { describe, expect, it } from 'vitest'
import { frameFromPreset } from '../frameSpec'
import { buildCompetitorImagePrompt } from './promptBuild'

describe('竞品参谋提示词', () => {
  it('主图默认模仿竞品风格并重新构图，适合类目，且不改变产品赠品外形、不虚构功能', () => {
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
    expect(prompt).toMatch(/比参考图更好看/)
    expect(prompt).toMatch(/文案须保持竞品核心卖点的语义/)
    expect(prompt).toMatch(/不要照抄原句/)
    expect(prompt).not.toMatch(/本张须原样显示的卖点词原文/)
    expect(prompt).not.toMatch(/先生成一张连续的详情长条图/)
    expect(prompt).not.toMatch(/按卖点分张生成的详情页/)
    expect(prompt).not.toMatch(/必须改成场景图/)
  })

  it('主图用户自定义风格优先，但仍锁定外形且不虚构功能', () => {
    const prompt = buildCompetitorImagePrompt({
      category: 'hero',
      styleMode: 'custom',
      sellingPoint: '结实耐玩',
      layoutSummary: '左产品右留白',
      textPrimaryColor: { name: '中国红', hex: '#DC2626' },
      frameSpec: frameFromPreset('1:1'),
    })
    expect(prompt).toMatch(/用户已明确指定主图风格/)
    expect(prompt).toMatch(/左产品右留白/)
    expect(prompt).toMatch(/#DC2626/)
    expect(prompt).toMatch(/产品和赠品/)
    expect(prompt).toMatch(/不要凭空捏造或虚构产品功能/)
    expect(prompt).not.toMatch(/默认主图风格规则：/)
    expect(prompt).not.toMatch(/本张须原样显示的卖点词原文/)
  })

  it('选项图按套餐对应锁定配件数量，并排除价格送达等购买信息', () => {
    const prompt = buildCompetitorImagePrompt({
      category: 'option',
      styleMode: 'strict',
      sellingPoint: '套餐配件一次配齐',
      optionName: '加10个仿真塑料石头+2人仔',
      contentsNote: '挖掘机 1 只，仿真塑料石头 10 个，人仔 2 个',
    })
    expect(prompt).toMatch(/加10个仿真塑料石头\+2人仔/)
    expect(prompt).toMatch(/仿真塑料石头 10 个/)
    expect(prompt).toMatch(/不得增减或编造/)
    expect(prompt).toMatch(/不限定必须是白底或必须有场景/)
    expect(prompt).toMatch(/不要把价格、预计送达/)
    expect(prompt).toMatch(/不允许改变产品外观/)
  })

  it('自定义模式才加入用户配色，且仍禁止改产品差异', () => {
    const prompt = buildCompetitorImagePrompt({
      category: 'detail',
      styleMode: 'custom',
      sellingPoint: '细节特写',
      layoutSummary: '左侧大图右侧卖点',
      textPrimaryColor: { name: '中国红', hex: '#DC2626' },
      frameSpec: frameFromPreset('3:4'),
    })
    expect(prompt).toMatch(/自定义排版颜色/)
    expect(prompt).toMatch(/左侧大图右侧卖点/)
    expect(prompt).toMatch(/#DC2626/)
    expect(prompt).toMatch(/产品、配件、数量和卖点不变/)
  })
})

  it('文案优化须保持卖点语义，禁止照抄和凭空增补能力', () => {
    const prompt = buildCompetitorImagePrompt({
      category: 'hero',
      styleMode: 'strict',
      sellingPoint: '结实耐玩，适合户外',
    })
    expect(prompt).toMatch(/核心卖点语义（须保持，不得增加未经证实的能力）：结实耐玩，适合户外/)
    expect(prompt).toMatch(/文案不要照抄原句，要用更好的表达说出同一个卖点/)
    expect(prompt).toMatch(/效果承诺或认证/)
    expect(prompt).not.toMatch(/可以自由增加卖点/)
  })

  it('接近竞品模式下，用户改过的排版仍进入最终 prompt，未改排版则不把参考排版写成用户指定', () => {
    const defaultPrompt = buildCompetitorImagePrompt({
      category: 'hero',
      styleMode: 'strict',
      sellingPoint: '结实耐玩',
      layoutSummary: '居中',
      styleSource: 'competitor_reference',
      frameSpec: frameFromPreset('1:1'),
    })
    expect(defaultPrompt).not.toMatch(/用户指定排版：居中/)

    const edited = buildCompetitorImagePrompt({
      category: 'hero',
      styleMode: 'strict',
      sellingPoint: '结实耐玩',
      layoutSummary: '产品居中，标题在上',
      styleSource: 'user_specified',
      sceneHint: '棚拍白底',
      title: '新主标题',
      frameSpec: frameFromPreset('1:1'),
    })
    expect(edited).toMatch(/用户指定排版：产品居中，标题在上/)
    expect(edited).toMatch(/场景提示：棚拍白底/)
    expect(edited).toMatch(/主标题：新主标题/)
    expect(edited).toMatch(/产品和赠品/)
  })

