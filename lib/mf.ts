/**
 * マネーフォワード クラウド API クライアント（サーバー専用）
 *
 * - OAuth 2.0 認可コードフロー。認可サーバーは api.biz.moneyforward.com
 * - トークンは Supabase の mf_connections（service_role のみ）に 1 行だけ持つ
 * - アクセストークンは 1 時間、リフレッシュトークンは 18 か月。更新すると両方が新しくなり
 *   古いものは無効になるので、更新結果は必ず保存してから使う
 *
 * 絶対にクライアント側へ import しないこと（supabaseAdmin と同じ扱い）。
 */
import { supabaseAdmin, appUrl } from './supabaseAdmin'

export const MF_AUTHORIZE_URL = 'https://api.biz.moneyforward.com/authorize'
export const MF_TOKEN_URL = 'https://api.biz.moneyforward.com/token'
export const MF_INVOICE_BASE = 'https://invoice.moneyforward.com/api/v3'
export const MF_ACCOUNTING_BASE = 'https://api-accounting.moneyforward.com/api/v3'

/** 使うスコープ。読み取りだけ。増やすときは再認可が必要 */
export const MF_SCOPES = [
  'mfc/invoice/data.read',
  'mfc/accounting/journal.read',
  'mfc/accounting/offices.read',
  'mfc/accounting/accounts.read',
]

export function mfClientId() {
  return process.env.MF_CLIENT_ID || ''
}
export function mfClientSecret() {
  return process.env.MF_CLIENT_SECRET || ''
}
export function mfRedirectUri() {
  return process.env.MF_REDIRECT_URI || `${appUrl()}/api/mf/callback`
}
export function mfConfigured() {
  return Boolean(mfClientId() && mfClientSecret())
}

export interface MfConnection {
  id: string
  access_token: string
  refresh_token: string
  expires_at: string
  scope: string
  office_name: string
  connected_by: string
  updated_at: string
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  scope?: string
  token_type: string
  expires_in?: number
}

function basicAuthHeader() {
  // クライアント認証方式 CLIENT_SECRET_BASIC：ClientID:ClientSecret を Basic 認証で送る
  return 'Basic ' + Buffer.from(`${mfClientId()}:${mfClientSecret()}`).toString('base64')
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(MF_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams(body).toString(),
    cache: 'no-store',
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`トークン取得に失敗しました（${res.status}）：${text.slice(0, 300)}`)
  }
  return JSON.parse(text) as TokenResponse
}

export function buildAuthorizeUrl(state: string) {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: mfClientId(),
    redirect_uri: mfRedirectUri(),
    scope: MF_SCOPES.join(' '),
    state,
  })
  return `${MF_AUTHORIZE_URL}?${p.toString()}`
}

async function saveTokens(t: TokenResponse, extra: Partial<MfConnection> = {}) {
  const expires = new Date(Date.now() + ((t.expires_in ?? 3600) - 60) * 1000).toISOString()
  const row: Record<string, unknown> = {
    id: 'default',
    access_token: t.access_token,
    expires_at: expires,
    updated_at: new Date().toISOString(),
    ...extra,
  }
  if (t.refresh_token) row.refresh_token = t.refresh_token
  if (t.scope) row.scope = t.scope
  const { error } = await supabaseAdmin.from('mf_connections').upsert(row, { onConflict: 'id' })
  if (error) throw new Error(`トークンの保存に失敗しました：${error.message}`)
}

/** 認可コードをトークンに交換して保存する */
export async function exchangeCode(code: string, connectedBy: string) {
  const t = await postToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: mfRedirectUri(),
  })
  if (!t.refresh_token) throw new Error('リフレッシュトークンが返されませんでした')
  await saveTokens(t, { connected_by: connectedBy })
  // 事業者名を取っておく（画面表示用。失敗しても接続自体は成立している）
  try {
    const office = await mfGet<{ name?: string }>(`${MF_ACCOUNTING_BASE}/offices`)
    if (office?.name) {
      await supabaseAdmin.from('mf_connections').update({ office_name: office.name }).eq('id', 'default')
    }
  } catch {
    /* 事業者名は任意 */
  }
}

export async function getConnection(): Promise<MfConnection | null> {
  const { data, error } = await supabaseAdmin.from('mf_connections').select('*').eq('id', 'default').maybeSingle()
  if (error) throw new Error(`接続情報を読めません：${error.message}`)
  return (data as MfConnection | null) ?? null
}

export async function disconnect() {
  const { error } = await supabaseAdmin.from('mf_connections').delete().eq('id', 'default')
  if (error) throw new Error(error.message)
}

/** 有効なアクセストークンを返す。期限切れ（または間近）なら更新して保存する */
async function validAccessToken(force = false): Promise<string> {
  const c = await getConnection()
  if (!c) throw new Error('マネーフォワードと接続されていません。アクセルダッシュの「マネーフォワード連携」から接続してください')
  const expiresSoon = new Date(c.expires_at).getTime() - Date.now() < 2 * 60 * 1000
  if (!force && !expiresSoon) return c.access_token
  const t = await postToken({ grant_type: 'refresh_token', refresh_token: c.refresh_token })
  await saveTokens(t)
  return t.access_token
}

const RETRY_STATUSES = new Set([429, 502, 503, 504])

/**
 * GET を投げて JSON を返す。401 なら 1 回だけトークンを更新して再試行。
 * 429（レート制限）と一時的な 5xx は少し待って再試行。
 */
export async function mfGet<T = unknown>(url: string, attempt = 0): Promise<T> {
  const token = await validAccessToken(attempt === 1)
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  })
  if (res.status === 401 && attempt === 0) return mfGet<T>(url, 1)
  if (RETRY_STATUSES.has(res.status) && attempt < 4) {
    await sleep(1500 * (attempt + 1))
    return mfGet<T>(url, attempt + 1)
  }
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`MF API エラー（${res.status} ${url.replace(/\?.*$/, '')}）：${text.slice(0, 300)}`)
  }
  return JSON.parse(text) as T
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
