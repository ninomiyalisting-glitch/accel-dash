/**
 * 資料リンクの種類。URL から判定して、一覧のアイコンと色分けに使う。
 * Google ドライブ系は URL の形が決まっているので、貼るだけで種類が付く。
 */
export type DocKind = 'sheet' | 'doc' | 'slide' | 'form' | 'folder' | 'pdf' | 'file' | 'link'

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  sheet: 'スプレッドシート',
  doc: 'ドキュメント',
  slide: 'スライド',
  form: 'フォーム',
  folder: 'フォルダ',
  pdf: 'PDF',
  file: 'ファイル',
  link: 'リンク',
}

export function detectKind(url: string): DocKind {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return 'link'
  }
  const host = u.hostname
  const path = u.pathname
  if (host === 'docs.google.com') {
    if (path.startsWith('/spreadsheets')) return 'sheet'
    if (path.startsWith('/document')) return 'doc'
    if (path.startsWith('/presentation')) return 'slide'
    if (path.startsWith('/forms')) return 'form'
  }
  if (host === 'drive.google.com') {
    if (path.includes('/folders/')) return 'folder'
    if (path.startsWith('/file/')) return 'file'
  }
  if (/\.pdf($|\?)/i.test(path)) return 'pdf'
  return 'link'
}

/** 入力の揺れを吸収する。スキーム無しは https を付ける */
export function normalizeUrl(raw: string): string {
  const v = raw.trim()
  if (!v) return ''
  if (/^https?:\/\//i.test(v)) return v
  return `https://${v}`
}
