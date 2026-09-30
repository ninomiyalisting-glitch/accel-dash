/**
 * 財務管理（finance.accel-dash.com）の閲覧権限。
 *
 * 財務は経営数値なので、社内ドメインでも全員には見せない。
 * 見てよい人は Supabase の finance_members（メールアドレス）だけで、
 * 財務アプリのデータもポータルのタイルも、この一覧で RLS が判定する。
 *
 * ポータルのユーザー管理で「財務」にチェックを付けると finance_members に入り、
 * 外すと消える。付け外しできるのは FINANCE_OWNER だけ（サーバー側でも止める）。
 *
 * このファイルはクライアントからも読むので、秘密の値は置かないこと。
 */
export const FINANCE_SLUG = 'finance'
export const FINANCE_OWNER = 'ninomiya@accel-partners.co.jp'

export function isFinanceApp(app: { slug?: string | null } | null | undefined): boolean {
  const s = String(app?.slug ?? '').trim().toLowerCase()
  return s === FINANCE_SLUG || /^https?:\/\/finance\.accel-dash\.com/.test(s)
}

export function canManageFinance(email: string | null | undefined): boolean {
  return String(email ?? '').trim().toLowerCase() === FINANCE_OWNER
}
