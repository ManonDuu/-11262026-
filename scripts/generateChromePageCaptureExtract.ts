import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { captureDomRuntimeSource } from '../src/pdd/competitor/captureDom.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'prototypes/chrome-page-capture/extract-bundle.js')
const source = captureDomRuntimeSource().replace(/^export\s+/gm, '')
const file = `/* 由 scripts/generateChromePageCaptureExtract.ts 生成，请勿手改。只包含 DOM 解析，不读取 cookie 或发起网络请求。 */
(function (root) {
${source}
  root.__pddExtractCompetitorDom = function (doc, expectedGoodsId) {
    return extractCompetitorDom(doc, expectedGoodsId);
  };
})(globalThis);
`
writeFileSync(target, file)
console.log('wrote', target)
