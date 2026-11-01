// @ts-check
/**
 * Encryption primitives (Web Crypto only, no dependencies).
 *
 * Design
 *  - A random 256-bit data key (DEK) encrypts every stored record (AES-GCM).
 *  - The DEK is never stored in the clear. It is "wrapped" (encrypted) by a key
 *    derived from the user's password with PBKDF2-SHA-256 and a random salt.
 *  - Wrong password => unwrapping fails authentication => no oracle other than that.
 *  - Changing the password re-wraps the same DEK: no need to re-encrypt records.
 *  - Each record is bound to its location with AES-GCM "additional data", so an
 *    attacker cannot swap one record's ciphertext into another slot undetected.
 */

const te = new TextEncoder();
const td = new TextDecoder();

/** PBKDF2 work factor. OWASP's 2023 guidance for PBKDF2-HMAC-SHA256 is 600k; 310k keeps phones responsive. */
export const KDF_ITERATIONS = 310_000;
const MIN_ITERATIONS = 1_000;
const MAX_ITERATIONS = 5_000_000;

/** @param {Uint8Array} bytes */
export function toB64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

/** @param {string} s */
export function fromB64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/** @param {number} n */
function random(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/**
 * @typedef {Object} Vault
 * @property {1} v
 * @property {'PBKDF2-SHA256'} kdf
 * @property {number} iterations
 * @property {string} salt     base64
 * @property {string} iv       base64
 * @property {string} wrapped  base64, the data key encrypted under the password-derived key
 */

/**
 * @param {string} password @param {Uint8Array} salt @param {number} iterations
 * @returns {Promise<CryptoKey>}
 */
async function deriveWrappingKey(password, salt, iterations) {
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new Error('Unsupported key-derivation settings.');
  }
  const base = await crypto.subtle.importKey('raw', te.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: /** @type {BufferSource} */ (salt), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/** Re-import a data key as non-extractable so it can never be read back out. @param {CryptoKey} key */
async function lockDown(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * Create a new vault protected by a password.
 * @param {string} password
 * @param {{ iterations?: number }} [opts]
 * @returns {Promise<{ vault: Vault, key: CryptoKey }>}
 */
export async function createVault(password, opts = {}) {
  const iterations = opts.iterations ?? KDF_ITERATIONS;
  const salt = random(16);
  const iv = random(12);
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const kek = await deriveWrappingKey(password, salt, iterations);
  const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
  return {
    vault: { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: toB64(salt), iv: toB64(iv), wrapped: toB64(new Uint8Array(wrapped)) },
    key: await lockDown(dek),
  };
}

/**
 * @param {Vault} vault @param {string} password @param {boolean} extractable
 * @returns {Promise<CryptoKey|null>} null when the password is wrong
 */
async function unwrap(vault, password, extractable) {
  const kek = await deriveWrappingKey(password, fromB64(vault.salt), vault.iterations);
  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      /** @type {BufferSource} */ (fromB64(vault.wrapped)),
      kek,
      { name: 'AES-GCM', iv: /** @type {BufferSource} */ (fromB64(vault.iv)) },
      { name: 'AES-GCM' },
      extractable,
      ['encrypt', 'decrypt'],
    );
  } catch {
    return null;
  }
}

/**
 * Open a vault with a password.
 * @param {Vault} vault @param {string} password
 * @returns {Promise<CryptoKey|null>} the (non-extractable) data key, or null when the password is wrong
 */
export function openVault(vault, password) {
  return unwrap(vault, password, false);
}

/**
 * Change the password: same data key, new salt and wrapping.
 * @param {Vault} vault @param {string} oldPassword @param {string} newPassword
 * @param {{ iterations?: number }} [opts]
 * @returns {Promise<{ vault: Vault, key: CryptoKey } | null>} null when the old password is wrong
 */
export async function rewrapVault(vault, oldPassword, newPassword, opts = {}) {
  const dek = await unwrap(vault, oldPassword, true);
  if (!dek) return null;
  const iterations = opts.iterations ?? KDF_ITERATIONS;
  const salt = random(16);
  const iv = random(12);
  const kek = await deriveWrappingKey(newPassword, salt, iterations);
  const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
  return {
    vault: { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: toB64(salt), iv: toB64(iv), wrapped: toB64(new Uint8Array(wrapped)) },
    key: await lockDown(dek),
  };
}

/**
 * @typedef {{ enc: 1, iv: string, ct: string }} Sealed
 */

/**
 * Encrypt any JSON-serialisable value. `where` binds the ciphertext to its slot.
 * @param {CryptoKey} key @param {unknown} value @param {string} where  e.g. "events:abc"
 * @returns {Promise<Sealed>}
 */
export async function seal(key, value, where) {
  const iv = random(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: te.encode(where) },
    key,
    te.encode(JSON.stringify(value)),
  );
  return { enc: 1, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

/**
 * Decrypt a sealed value. Throws if the key is wrong, the data was altered, or
 * it was moved to a different slot.
 * @param {CryptoKey} key @param {Sealed} sealed @param {string} where
 * @returns {Promise<unknown>}
 */
export async function open(key, sealed, where) {
  const plain = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: /** @type {BufferSource} */ (fromB64(sealed.iv)),
      additionalData: te.encode(where),
    },
    key,
    /** @type {BufferSource} */ (fromB64(sealed.ct)),
  );
  return JSON.parse(td.decode(plain));
}

/** @param {unknown} v @returns {v is Sealed} */
export function isSealed(v) {
  return Boolean(v) && typeof v === 'object' && /** @type {any} */ (v).enc === 1 && typeof /** @type {any} */ (v).iv === 'string' && typeof /** @type {any} */ (v).ct === 'string';
}

/**
 * Storage codec used by the IndexedDB repository.
 * @typedef {Object} Codec
 * @property {(where: string, value: unknown) => Promise<Sealed>} encode
 * @property {(where: string, sealed: Sealed) => Promise<unknown>} decode
 */

/** @param {CryptoKey} key @returns {Codec} */
export function makeCodec(key) {
  return {
    encode: (where, value) => seal(key, value, where),
    decode: (where, sealed) => open(key, sealed, where),
  };
}

/**
 * Rough password strength for the meter (0 to 4). Length dominates, as it should.
 * @param {string} pw
 */
export function passwordStrength(pw) {
  if (!pw) return { score: 0, label: '' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length >= 16) score = Math.max(score, 3);
  if (/^(.)\1+$/.test(pw) || /^(password|12345678|qwertyui|letmein1?)$/i.test(pw)) score = 0;
  score = Math.min(4, score);
  return { score, label: ['Too weak', 'Weak', 'Okay', 'Strong', 'Excellent'][score] };
}
