// Cihaz kimliği. Her cihazın bir imza ve bir şifreleme anahtarı vardır; kullanıcı bunları hiç görmez.
// Kimlik numarası ilk görüldüğü anahtara bağlanır (pin), sonra başka anahtarla gelen reddedilir.
import type {Box, Ev} from './types'

export type KeysJwk = {sign: JsonWebKey; dh: JsonWebKey}
export type Identity = {pk: string; sign: CryptoKey; dh: CryptoKey; jwk: KeysJwk}

const SIGN = {name: 'ECDSA', namedCurve: 'P-256'}
const SIGN_ALG = {name: 'ECDSA', hash: 'SHA-256'}
const DH = {name: 'ECDH', namedCurve: 'P-256'}
const enc = new TextEncoder()
const dec = new TextDecoder()

const b64 = (b: ArrayBuffer | Uint8Array) => {
  let s = ''
  for (const x of new Uint8Array(b as ArrayBuffer)) s += String.fromCharCode(x)
  return btoa(s)
}
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

async function fromJwk(jwk: KeysJwk): Promise<Identity> {
  const sign = await crypto.subtle.importKey('jwk', jwk.sign, SIGN, false, ['sign'])
  const dh = await crypto.subtle.importKey('jwk', jwk.dh, DH, false, ['deriveBits'])
  const pub = async (k: JsonWebKey, alg: EcKeyImportParams, use: KeyUsage[]) => {
    const {d: _, ...p} = k
    const key = await crypto.subtle.importKey('jwk', {...p, key_ops: use}, alg, true, use)
    return b64(await crypto.subtle.exportKey('raw', key))
  }
  return {pk: `${await pub(jwk.sign, SIGN, ['verify'])}.${await pub(jwk.dh, DH, [])}`, sign, dh, jwk}
}

export async function newIdentity(): Promise<Identity> {
  const s = await crypto.subtle.generateKey(SIGN, true, ['sign', 'verify'])
  const d = await crypto.subtle.generateKey(DH, true, ['deriveBits'])
  return fromJwk({sign: await crypto.subtle.exportKey('jwk', s.privateKey), dh: await crypto.subtle.exportKey('jwk', d.privateKey)})
}

export const loadIdentity = (jwk: KeysJwk) => fromJwk(jwk)

export function validJwk(k: unknown): k is KeysJwk {
  const x = k as KeysJwk
  const one = (j: JsonWebKey) => !!j && j.kty === 'EC' && j.crv === 'P-256' && [j.d, j.x, j.y].every(v => typeof v === 'string' && v.length < 64)
  return !!x && one(x.sign) && one(x.dh)
}

export const validPk = (pk: unknown): pk is string => typeof pk === 'string' && pk.length < 200 && /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(pk)

// Anahtar sırası sabit: aynı olay her cihazda aynı metne dönüşmeli, yoksa imza tutmaz.
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return Object.fromEntries(Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => [k, canon(o[k])]))
  }
  return v
}
const payload = (e: Ev) => { const {sig: _, ...rest} = e; return enc.encode(JSON.stringify(canon(rest))) }

export async function signText(id: Identity, text: string) {
  return b64(await crypto.subtle.sign(SIGN_ALG, id.sign, enc.encode(text)))
}

export async function verifyText(pk: string, text: string, sig: string) {
  try {
    const key = await crypto.subtle.importKey('raw', unb64(pk.split('.')[0]), SIGN, false, ['verify'])
    return await crypto.subtle.verify(SIGN_ALG, key, unb64(sig), enc.encode(text))
  } catch { return false }
}

export async function signEvent<T extends Ev>(id: Identity, e: T): Promise<T> {
  const withKey = {...e, pk: id.pk}
  return {...withKey, sig: b64(await crypto.subtle.sign(SIGN_ALG, id.sign, payload(withKey)))}
}

export async function verifyEvent(e: Ev) {
  if (!e.pk || !e.sig) return false
  try {
    const key = await crypto.subtle.importKey('raw', unb64(e.pk.split('.')[0]), SIGN, false, ['verify'])
    return await crypto.subtle.verify(SIGN_ALG, key, unb64(e.sig), payload(e))
  } catch { return false }
}

// İki taraf da aynı ortak anahtarı üretir; ağda hiç dolaşmaz.
const shared = new Map<string, Promise<CryptoKey>>()
function pairKey(id: Identity, theirPk: string) {
  const key = id.pk + '|' + theirPk
  let p = shared.get(key)
  if (!p) {
    p = (async () => {
      const pub = await crypto.subtle.importKey('raw', unb64(theirPk.split('.')[1]), DH, false, [])
      const bits = await crypto.subtle.deriveBits({name: 'ECDH', public: pub}, id.dh, 256)
      const hash = await crypto.subtle.digest('SHA-256', new Uint8Array([...enc.encode('telsiz-dm-1'), ...new Uint8Array(bits)]))
      return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt'])
    })()
    shared.set(key, p)
  }
  return p
}

const gcm = async (key: CryptoKey, data: BufferSource) => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  return {iv: b64(iv), ct: b64(await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, data))}
}
const ungcm = (key: CryptoKey, x: {iv: string; ct: string}) => crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(x.iv)}, key, unb64(x.ct))

// Mesaj tek seferlik bir anahtarla şifrelenir, o anahtar da her üye için ayrı kilitlenir.
export async function sealBox(id: Identity, inner: unknown, members: Record<string, string>): Promise<Box> {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt'])
  const body = await gcm(key, enc.encode(JSON.stringify(inner)))
  const keys: Box['keys'] = {}
  for (const [uid, pk] of Object.entries(members)) keys[uid] = await gcm(await pairKey(id, pk), raw)
  return {...body, keys}
}

export async function openBox(id: Identity, box: Box, myUid: string, senderPk: string): Promise<unknown> {
  const mine = box.keys[myUid]
  if (!mine) throw new Error('bu kişiye değil')
  const raw = await ungcm(await pairKey(id, senderPk), mine)
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt'])
  return JSON.parse(dec.decode(await ungcm(key, box)))
}
