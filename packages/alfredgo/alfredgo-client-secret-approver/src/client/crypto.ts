/**
 * WebCrypto primitives of the AgentSecret approver protocol, byte-compatible with
 * AgentSecret's `seal.py`, `matcher.py`, and browser approver: base64url without
 * padding, ECDSA P-256 signatures, ECIES sealing, and credential matchers.
 */

/** Public part of a P-256 JWK as AgentSecret pairing files carry it. */
export interface PublicJwk {
  readonly kty: 'EC'
  readonly crv: 'P-256'
  readonly x: string
  readonly y: string
}

/** One compiled matcher: what lets an injector recognise a credential without holding it. */
export interface Matcher {
  readonly alias: string
  readonly length: number
  readonly tag: number
  readonly salt: string
  readonly digest: string
}

/** A box sealed to one injector. */
export interface Sealed {
  readonly epk: string
  readonly nonce: string
  readonly ct: string
}

/** Rolling-hash modulus of `matcher.py`. */
export const MATCHER_MOD = (1n << 61n) - 1n

/**
 * Encode text as UTF-8.
 * @param value - text.
 * @returns its UTF-8 bytes.
 */
export function bytes(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value)
}

/**
 * Encode bytes as unpadded base64url.
 * @param data - bytes.
 * @returns the encoded text.
 */
export function b64(data: ArrayBuffer | Uint8Array): string {
  return btoa(Array.from(new Uint8Array(data), b => String.fromCharCode(b)).join(''))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/**
 * Decode unpadded base64url.
 * @param text - encoded text.
 * @returns the decoded bytes.
 */
export function unb64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))
}

/**
 * Encode bytes as lowercase hex.
 * @param data - bytes.
 * @returns the hex text.
 */
export function hex(data: ArrayBuffer): string {
  return [...new Uint8Array(data)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Keep only the public P-256 coordinates of a JWK.
 * @param jwk - any JWK with `x` and `y`.
 * @returns the public JWK.
 */
export function publicJwk(jwk: { readonly x?: string | undefined; readonly y?: string | undefined }): PublicJwk {
  if (typeof jwk.x !== 'string' || typeof jwk.y !== 'string') throw new Error('not a P-256 public key')
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }
}

/**
 * Sign text with the device key.
 * @param key - ECDSA P-256 private key.
 * @param text - exact text to sign.
 * @returns the raw r||s signature, base64url.
 */
export async function sign(key: CryptoKey, text: string): Promise<string> {
  return b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes(text)))
}

/**
 * Verify an injector's signature over a request.
 * @param jwk - the injector's signing key recorded at pairing.
 * @param signature - base64url r||s signature.
 * @param text - exact signed text.
 * @returns whether the signature is valid.
 */
export async function verify(jwk: PublicJwk, signature: string, text: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64(signature), bytes(text))
}

/**
 * Additional data that binds a sealed box to one request.
 * @param requestText - the exact request text the injector signed.
 * @returns `secret-guard/seal/v1:` followed by the request's SHA-256 in hex.
 */
export async function sealAad(requestText: string): Promise<Uint8Array<ArrayBuffer>> {
  return bytes('secret-guard/seal/v1:' + hex(await crypto.subtle.digest('SHA-256', bytes(requestText))))
}

/**
 * Seal bytes to an injector: ephemeral P-256 ECDH, HKDF-SHA256, AES-256-GCM.
 * @param recipient - the injector's encryption key recorded at pairing.
 * @param plaintext - bytes to seal.
 * @param aad - additional data from {@link sealAad}.
 * @returns the sealed box.
 */
export async function seal(recipient: PublicJwk, plaintext: Uint8Array<ArrayBuffer>, aad: Uint8Array<ArrayBuffer>): Promise<Sealed> {
  const key = await crypto.subtle.importKey('jwk', recipient, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const epk = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey))
  const recipientRaw = new Uint8Array(await crypto.subtle.exportKey('raw', key))
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: key }, ephemeral.privateKey, 256)
  const salt = new Uint8Array(130)
  salt.set(epk)
  salt.set(recipientRaw, 65)
  const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  const aes = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: bytes('secret-guard/seal/v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  return { epk: b64(epk), nonce: b64(nonce), ct: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad }, aes, plaintext)) }
}

/**
 * Pick a random rolling-hash base for one rules version.
 * @returns a base in [257, MATCHER_MOD).
 */
export function matcherBase(): bigint {
  const random = new BigUint64Array(1)
  crypto.getRandomValues(random)
  return (random[0] ?? 0n) % (MATCHER_MOD - 257n) + 257n
}

/**
 * Compile one credential value into a matcher, as `matcher.py` does: byte length,
 * 16-bit rolling-hash tag, and a salted 50,000-round PBKDF2-SHA256 digest.
 * @param alias - credential alias.
 * @param value - credential value.
 * @param base - rolling-hash base of this rules version.
 * @returns the matcher, or null for an empty value.
 */
export async function compileMatcher(alias: string, value: string, base: bigint): Promise<Matcher | null> {
  const data = bytes(value)
  if (data.length === 0) return null
  let h = 0n
  for (const b of data) h = (h * base + BigInt(b)) % MATCHER_MOD
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', data, 'PBKDF2', false, ['deriveBits'])
  const digest = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 50000 }, key, 256)
  return { alias, length: data.length, tag: Number(h & 0xFFFFn), salt: b64(salt), digest: b64(digest) }
}

/**
 * Make a value of the same shape as a credential: digits and letters replaced at
 * random, separators and a short `prefix-` or `prefix_` kept.
 * @param value - the stored credential.
 * @returns the mock value.
 */
export function mockValue(value: string): string {
  const pick = (pool: string): string => pool[(crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % pool.length] ?? ''
  const low = 'abcdefghijklmnopqrstuvwxyz'
  const head = value.slice(0, 8)
  const cut = Math.max(head.indexOf('-'), head.indexOf('_')) + 1
  // oxlint-disable-next-line typescript/no-misused-spread -- code points keep a non-ASCII character as one masked unit.
  return value.slice(0, cut) + [...value.slice(cut)].map(c => /[0-9]/.test(c) ? pick('0123456789')
    : /[a-z]/.test(c) ? pick(low) : /[A-Z]/.test(c) ? pick(low.toUpperCase()) : c).join('')
}
