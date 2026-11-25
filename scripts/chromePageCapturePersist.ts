import { mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { downloadAllowedImage } from './downloadAllowedImage'
import type { ChromePageCaptureImport, ChromePageCaptureSavedFile } from './chromePageCapturePairing'

export type DownloadImageFn = typeof downloadAllowedImage

export const DEFAULT_IMPORT_ROOT = join(homedir(), 'pdd-image-studio-test', 'var', 'chrome-page-capture-imports')

function extensionFor(mimeType: string): string {
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  return '.jpg'
}

function folderStamp(now: number): string {
  return new Date(now).toISOString().replace(/[:.]/g, '-').replace('T', '_').replace(/Z$/, '')
}

async function saveOne(
  kind: ChromePageCaptureSavedFile['kind'],
  sourceUrl: string | null,
  fileStem: string,
  dir: string,
  downloadImage: DownloadImageFn,
  optionName?: string,
): Promise<ChromePageCaptureSavedFile> {
  if (!sourceUrl) {
    return { kind, fileName: null, bytesStatus: 'unavailable', byteLength: 0, optionName }
  }
  try {
    const result = await downloadImage(sourceUrl)
    if (result.status !== 'ok' || !result.bytes.byteLength) {
      return { kind, fileName: null, bytesStatus: result.status, byteLength: result.bytes.byteLength, optionName }
    }
    const fileName = `${fileStem}${extensionFor(result.mimeType)}`
    writeFileSync(join(dir, fileName), result.bytes)
    return { kind, fileName, bytesStatus: 'ok', byteLength: result.bytes.byteLength, optionName }
  } catch {
    return { kind, fileName: null, bytesStatus: 'unavailable', byteLength: 0, optionName }
  }
}

function completeMessage(heroSaved: number, detailSaved: number, optionSaved: number, optionsInspected: boolean): { acceptedAsComplete: boolean; message: string } {
  if (heroSaved > 0 && detailSaved > 0 && optionSaved > 0 && optionsInspected) {
    return {
      acceptedAsComplete: true,
      message: '已保存主图、详情图，以及已绑定套餐名的规格图文件。这次按本地文件完成验收，不是只收到链接。',
    }
  }
  if (heroSaved > 0 && detailSaved > 0 && optionSaved === 0) {
    return {
      acceptedAsComplete: false,
      message: '主图和详情图文件已保存，但还缺少已绑定套餐名的规格图。请在当前商品页先点开规格（不要点购买或确认），再点一次扩展图标。',
    }
  }
  if (heroSaved + detailSaved + optionSaved === 0) {
    return {
      acceptedAsComplete: false,
      message: '已收到分类后的图片链接，但没有成功下载到本地文件，不能算取图成功。',
    }
  }
  return {
    acceptedAsComplete: false,
    message: '只保存了部分图片文件，还不能算三类图片都验收完成。',
  }
}

export async function persistCapturedImages(input: {
  record: ChromePageCaptureImport
  downloadImage?: DownloadImageFn
  importRoot?: string
}): Promise<ChromePageCaptureImport> {
  const downloadImage = input.downloadImage || downloadAllowedImage
  const folder = folderStamp(input.record.receivedAt)
  const dir = join(input.importRoot || DEFAULT_IMPORT_ROOT, folder)
  mkdirSync(dir, { recursive: true })

  const files: ChromePageCaptureSavedFile[] = []
  for (const [index, image] of input.record.hero.entries()) {
    files.push(await saveOne('hero', image.sourceUrl, `hero-${String(index + 1).padStart(3, '0')}`, dir, downloadImage))
  }
  for (const [index, image] of input.record.detail.entries()) {
    files.push(await saveOne('detail', image.sourceUrl, `detail-${String(index + 1).padStart(3, '0')}`, dir, downloadImage))
  }
  for (const [index, option] of input.record.options.entries()) {
    files.push(await saveOne(
      'option',
      option.sourceUrl,
      `option-${String(index + 1).padStart(3, '0')}`,
      dir,
      downloadImage,
      option.optionName,
    ))
  }

  const heroSaved = files.filter((item) => item.kind === 'hero' && item.bytesStatus === 'ok').length
  const detailSaved = files.filter((item) => item.kind === 'detail' && item.bytesStatus === 'ok').length
  const optionSaved = files.filter((item) => item.kind === 'option' && item.bytesStatus === 'ok').length
  const { acceptedAsComplete, message } = completeMessage(heroSaved, detailSaved, optionSaved, input.record.optionsInspected)

  return {
    ...input.record,
    folder,
    files,
    heroSaved,
    detailSaved,
    optionSaved,
    bytesSaved: heroSaved + detailSaved + optionSaved > 0,
    acceptedAsComplete,
    message,
  }
}
