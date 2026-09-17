import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { generateSecret, generateURI, generate, verify } from 'otplib'

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me'
const ENC_KEY_HEX = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex')
const ENC_KEY = /^[0-9a-fA-F]{64}$/.test(ENC_KEY_HEX)
  ? Buffer.from(ENC_KEY_HEX, 'hex')
  : crypto.createHash('sha256').update(ENC_KEY_HEX).digest()

/* ---------- passwords ---------- */
export async function hashPassword(pwd) { return bcrypt.hash(pwd, 12) }
export async function verifyPassword(pwd, hash) {
  if (!hash) return false
  if (typeof hash === 'string' && hash.startsWith('$2')) return bcrypt.compare(pwd, hash)
  // legacy plain (auto-upgrade path used in login)
  return pwd === hash
}
export function passwordStrong(pwd) {
  return typeof pwd === 'string' && pwd.length >= 10 &&
    /[A-Z]/.test(pwd) && /[0-9]/.test(pwd) && /[^A-Za-z0-9]/.test(pwd)
}

/* ---------- signed session token (HMAC) ---------- */
export function signToken(payload, ttlSeconds = 60 * 60 * 24 * 7) {
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSeconds }
  const b64 = Buffer.from(JSON.stringify(body)).toString('base64url')
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url')
  return `${b64}.${sig}`
}
export function verifyToken(token) {
  try {
    const [b64, sig] = String(token || '').split('.')
    if (!b64 || !sig) return null
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url')
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
    const body = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'))
    if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null
    return body
  } catch { return null }
}

/* ---------- AES-256-GCM ---------- */
export function encrypt(plain) {
  if (plain == null || plain === '') return plain
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv)
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return 'enc:v1:' + Buffer.concat([iv, tag, enc]).toString('base64')
}
export function decrypt(payload) {
  if (typeof payload !== 'string' || !payload.startsWith('enc:v1:')) return payload
  try {
    const raw = Buffer.from(payload.slice(7), 'base64')
    const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), enc = raw.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  } catch { return null }
}

/* ---------- TOTP 2FA ---------- */
export function generateTotpSecret() { return generateSecret() }
export function totpUri(secret, email, issuer = 'Clinica Buena Salud') {
  return generateURI({ secret, accountName: email, issuer })
}
export function verifyTotp(token, secret) {
  try { return verify({ token: String(token || '').replace(/\s/g, ''), secret }) } catch { return false }
}
export function generateRecoveryCodes(n = 10) {
  return Array.from({ length: n }).map(() => crypto.randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g).join('-'))
}

/* ---------- rate limiter (in-memory) ---------- */
const buckets = new Map()
export function rateLimit(key, limit, windowMs) {
  const now = Date.now()
  const b = buckets.get(key) || { count: 0, reset: now + windowMs }
  if (now > b.reset) { b.count = 0; b.reset = now + windowMs }
  b.count += 1
  buckets.set(key, b)
  return { allowed: b.count <= limit, remaining: Math.max(0, limit - b.count), reset: b.reset }
}

/* ---------- IP helper ---------- */
export function clientIp(req) {
  const h = req.headers
  return (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown'
}
