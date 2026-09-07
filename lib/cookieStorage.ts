/**
 * サブドメイン横断でセッションを共有するための Cookie ストレージ。
 * public/accel-auth.js と同じ仕様。片方を直したら両方を揃えること。
 * （accel-dash 本体は Next.js なので TS 版、静的アプリは JS 版を読み込む）
 */
const SHARED_DOMAIN = 'accel-dash.com'
const CHUNK = 3000
const MAX_CHUNKS = 12
const MAX_AGE = 60 * 60 * 24 * 30

function available() {
  return typeof document !== 'undefined'
}

function domainAttr() {
  const host = location.hostname
  const suffix = '.' + SHARED_DOMAIN
  if (host === SHARED_DOMAIN || host.endsWith(suffix)) return `; domain=${suffix}`
  return ''
}

function secureAttr() {
  return location.protocol === 'https:' ? '; secure' : ''
}

function readRaw(name: string) {
  const target = encodeURIComponent(name) + '='
  const parts = document.cookie ? document.cookie.split('; ') : []
  for (const part of parts) {
    if (part.startsWith(target)) return part.slice(target.length)
  }
  return null
}

function writeRaw(name: string, value: string) {
  document.cookie =
    `${encodeURIComponent(name)}=${value}; path=/${domainAttr()}; max-age=${MAX_AGE}; samesite=lax${secureAttr()}`
}

function deleteRaw(name: string) {
  document.cookie =
    `${encodeURIComponent(name)}=; path=/${domainAttr()}; max-age=0; samesite=lax${secureAttr()}`
}

export const cookieStorage = {
  getItem(key: string) {
    if (!available()) return null

    let joined = ''
    for (let i = 0; i < MAX_CHUNKS; i++) {
      const part = readRaw(`${key}.${i}`)
      if (part === null) break
      joined += part
    }
    if (!joined) {
      const single = readRaw(key)
      if (single === null) return null
      joined = single
    }
    try {
      return decodeURIComponent(joined)
    } catch {
      return null
    }
  },

  setItem(key: string, value: string) {
    if (!available()) return

    const encoded = encodeURIComponent(value)
    const count = Math.ceil(encoded.length / CHUNK) || 1
    deleteRaw(key)
    for (let i = 0; i < count; i++) {
      writeRaw(`${key}.${i}`, encoded.slice(i * CHUNK, (i + 1) * CHUNK))
    }
    for (let j = count; j < MAX_CHUNKS; j++) {
      deleteRaw(`${key}.${j}`)
    }
  },

  removeItem(key: string) {
    if (!available()) return
    deleteRaw(key)
    for (let i = 0; i < MAX_CHUNKS; i++) {
      deleteRaw(`${key}.${i}`)
    }
  }
}
