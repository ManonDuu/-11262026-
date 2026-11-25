import { describe, expect, it } from 'vitest'
import { buildCoverageRows, describeCoverage, describeDetailCoverage, describeHeroCoverage, describeManualOptionCoverage, describeOptionCoverage, describeUploadedCategory, emptyCaptureCoverage } from './coverage'

describe('coverage labels', () => {
  it('主图在缺少总数或数量不足时给出明确标注', () => {
    expect(describeHeroCoverage(3, 3).status).toBe('ok')
    expect(describeHeroCoverage(2, 4).status).toBe('partial')
    expect(describeHeroCoverage(2, 4).note).toMatch(/部分覆盖/)
    expect(describeHeroCoverage(2, null).status).toBe('unknown_total')
    expect(describeHeroCoverage(0, 4).status).toBe('none')
  })

  it('详情长图区分完整保留与未能取得完整文件', () => {
    expect(describeDetailCoverage(2, 1, 0)).toMatch(/完整保留，未切片/)
    expect(describeDetailCoverage(2, 0, 1)).toMatch(/未能取得完整长图/)
  })

  it('旧采集覆盖函数仍描述未检查选项，但主流程改用上传口径', () => {
    expect(describeOptionCoverage(false, 0, 0, 0)).toMatch(/未检查选项/)
    expect(describeOptionCoverage(true, 3, 2, 1)).toMatch(/缺失 1/)
    expect(describeManualOptionCoverage(0, 0, 0)).toMatch(/还没有套餐记录/)
    expect(describeManualOptionCoverage(3, 2, 1)).toMatch(/缺失 1/)
    expect(describeUploadedCategory('hero', 0, 0)).toMatch(/尚未上传/)
    expect(describeUploadedCategory('hero', 2, 0)).toBe('主图已上传 2 张。')
    expect(describeUploadedCategory('hero', 1, 1)).toMatch(/历史采集 1/)
  })

  it('主流程覆盖率按已上传图片统计，不把旧采集失败提示当作当前说明', () => {
    const rows = buildCoverageRows([], [], true, {
      ...emptyCaptureCoverage(),
      attempted: true,
      blocked: 'login',
      blockedMessage: '采集被中止。需要登录。',
      option: { inspected: false, total: 0, bound: 0, missing: 0, note: describeOptionCoverage(false, 0, 0, 0) },
    })
    expect(rows.find((row) => row.category === 'option')?.note).toMatch(/还没有套餐记录/)
    expect(rows.find((row) => row.category === 'hero')?.note).toMatch(/尚未上传/)
    expect(rows.every((row) => !row.note.includes('需要登录') && !row.note.includes('未检查选项'))).toBe(true)
    expect(describeCoverage(rows)).toMatch(/主图：已上传 0/)
    expect(describeCoverage(rows)).not.toMatch(/补传/)
  })

  it('同时统计手动上传与历史采集数量', () => {
    const rows = buildCoverageRows([
      { id: '1', category: 'hero', asset: { id: 'a', imageId: 'a', name: 'a.png' }, optionName: '', contentsNote: '', sellingPoint: '', sceneHint: '', layoutSummary: '', analysisStatus: 'pending', source: 'manual_import' },
      { id: '2', category: 'hero', asset: { id: 'b', imageId: 'b', name: 'b.png' }, optionName: '', contentsNote: '', sellingPoint: '', sceneHint: '', layoutSummary: '', analysisStatus: 'pending', source: 'link_capture' },
    ])
    expect(rows.find((row) => row.category === 'hero')).toMatchObject({ imported: 1, captured: 1 })
    expect(describeCoverage(rows)).toMatch(/主图：已上传 2，其中历史采集 1/)
  })
})
