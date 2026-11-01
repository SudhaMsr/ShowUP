// @ts-check
import { createVault, openVault, rewrapVault } from './crypto.js';

/**
 * Device account: a name and a password that unlocks the encrypted data on this
 * device. There is no server, so there is no password reset by email. A forgotten
 * password means erasing the device data and restoring from a backup file.
 *
 * @typedef {import('./crypto.js').Vault} Vault
 * @typedef {Object} Profile
 * @property {1} v
 * @property {string} name
 * @property {Vault} vault
 * @property {number} createdAt
 * @property {number} failed        consecutive wrong passwords
 * @property {number} lockedUntil   epoch ms; sign-in refused before this
 * @property {number} idleMinutes   auto-lock after this much inactivity; 0 = never
 * @typedef {{ key: CryptoKey, expiresAt: number }} Session
 * @typedef {Object} AuthStorage
 * @property {() => Promise<Profile|null>} getProfile
 * @property {(p: Profile) => Promise<void>} putProfile
 * @property {() => Promise<Session|null>} getSession
 * @property {(s: Session) => Promise<void>} putSession
 * @property {() => Promise<void>} clearSession
 * @property {() => Promise<void>} clearAll
 */

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;
export const FREE_ATTEMPTS = 5;
const MAX_LOCKOUT_MS = 15 * 60_000;
const KEEP_SIGNED_IN_MS = 30 * 24 * 60 * 60_000;
export const IDLE_CHOICES = [5, 15, 30, 60, 0];

/** In-memory storage for tests. @returns {AuthStorage} */
export function memoryAuthStorage() {
  /** @type {Profile|null} */ let profile = null;
  /** @type {Session|null} */ let session = null;
  return {
    getProfile: async () => (profile ? structuredClone(profile) : null),
    putProfile: async (p) => void (profile = structuredClone(p)),
    getSession: async () => session,
    putSession: async (s) => void (session = s),
    clearSession: async () => void (session = null),
    clearAll: async () => {
      profile = null;
      session = null;
    },
  };
}

/** @param {string} name */
export function cleanName(name) {
  return name.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** Validate sign-up input. Returns field errors (empty object when fine). @param {string} name @param {string} password */
export function validateNewAccount(name, password) {
  /** @type {Record<string,string>} */
  const errors = {};
  if (!cleanName(name)) errors.name = 'Enter your name.';
  if (password.length < MIN_PASSWORD) errors.password = `Use at least ${MIN_PASSWORD} characters.`;
  else if (password.length > MAX_PASSWORD) errors.password = `Use at most ${MAX_PASSWORD} characters.`;
  else if (!password.trim()) errors.password = 'A password cannot be only spaces.';
  return errors;
}

/**
 * @param {AuthStorage} storage
 * @param {{ now?: () => number, iterations?: number }} [opts]
 */
export function createAuth(storage, opts = {}) {
  const now = opts.now ?? Date.now;
  const kdf = opts.iterations ? { iterations: opts.iterations } : {};

  /** Wait imposed after `failed` consecutive misses: 0 for the first few, then 30s doubling to 15 min. @param {number} failed */
  function lockoutFor(failed) {
    if (failed < FREE_ATTEMPTS) return 0;
    return Math.min(MAX_LOCKOUT_MS, 30_000 * 2 ** (failed - FREE_ATTEMPTS));
  }

  /** @param {CryptoKey} key @param {boolean} keep */
  async function remember(key, keep) {
    if (keep) await storage.putSession({ key, expiresAt: now() + KEEP_SIGNED_IN_MS });
    else await storage.clearSession();
  }

  return {
    getProfile: () => storage.getProfile(),

    /**
     * @param {string} name @param {string} password @param {{ keep?: boolean }} [o]
     * @returns {Promise<{ ok: true, key: CryptoKey, profile: Profile } | { ok: false, errors: Record<string,string> }>}
     */
    async signUp(name, password, o = {}) {
      if (await storage.getProfile()) return { ok: false, errors: { form: 'An account already exists on this device.' } };
      const errors = validateNewAccount(name, password);
      if (Object.keys(errors).length) return { ok: false, errors };
      const { vault, key } = await createVault(password, kdf);
      /** @type {Profile} */
      const profile = { v: 1, name: cleanName(name), vault, createdAt: now(), failed: 0, lockedUntil: 0, idleMinutes: 30 };
      await storage.putProfile(profile);
      await remember(key, Boolean(o.keep));
      return { ok: true, key, profile };
    },

    /**
     * @param {string} password @param {{ keep?: boolean }} [o]
     * @returns {Promise<{ ok: true, key: CryptoKey, profile: Profile } | { ok: false, reason: 'none'|'locked'|'wrong', waitMs?: number, attemptsLeft?: number }>}
     */
    async signIn(password, o = {}) {
      const profile = await storage.getProfile();
      if (!profile) return { ok: false, reason: 'none' };
      const t = now();
      if (profile.lockedUntil > t) return { ok: false, reason: 'locked', waitMs: profile.lockedUntil - t };
      const key = password.length <= MAX_PASSWORD ? await openVault(profile.vault, password) : null;
      if (!key) {
        profile.failed += 1;
        const wait = lockoutFor(profile.failed);
        profile.lockedUntil = wait ? now() + wait : 0;
        await storage.putProfile(profile);
        return wait
          ? { ok: false, reason: 'locked', waitMs: wait }
          : { ok: false, reason: 'wrong', attemptsLeft: FREE_ATTEMPTS - profile.failed };
      }
      profile.failed = 0;
      profile.lockedUntil = 0;
      await storage.putProfile(profile);
      await remember(key, Boolean(o.keep));
      return { ok: true, key, profile };
    },

    /** Pick up a "keep me signed in" session. @returns {Promise<{ key: CryptoKey, profile: Profile } | null>} */
    async resume() {
      const [profile, session] = await Promise.all([storage.getProfile(), storage.getSession()]);
      if (!profile || !session) return null;
      if (session.expiresAt <= now()) {
        await storage.clearSession();
        return null;
      }
      return { key: session.key, profile };
    },

    /** Forget the session; the next visit needs the password again. */
    lock: () => storage.clearSession(),

    /**
     * @param {string} oldPassword @param {string} newPassword
     * @returns {Promise<{ ok: true } | { ok: false, errors: Record<string,string> }>}
     */
    async changePassword(oldPassword, newPassword) {
      const profile = await storage.getProfile();
      if (!profile) return { ok: false, errors: { form: 'No account on this device.' } };
      const errors = validateNewAccount(profile.name, newPassword);
      if (errors.password) return { ok: false, errors: { newPassword: errors.password } };
      const next = await rewrapVault(profile.vault, oldPassword, newPassword, kdf);
      if (!next) return { ok: false, errors: { oldPassword: 'That is not your current password.' } };
      profile.vault = next.vault;
      await storage.putProfile(profile);
      return { ok: true };
    },

    /** @param {number} minutes one of IDLE_CHOICES */
    async setIdleMinutes(minutes) {
      const profile = await storage.getProfile();
      if (!profile || !IDLE_CHOICES.includes(minutes)) return;
      profile.idleMinutes = minutes;
      await storage.putProfile(profile);
    },

    /** @param {string} name */
    async rename(name) {
      const profile = await storage.getProfile();
      const clean = cleanName(name);
      if (!profile || !clean) return false;
      profile.name = clean;
      await storage.putProfile(profile);
      return true;
    },

    /** Erase the account (the caller also erases the encrypted data). */
    reset: () => storage.clearAll(),
  };
}

/** @typedef {ReturnType<typeof createAuth>} Auth */
