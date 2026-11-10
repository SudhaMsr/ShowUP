// Tiny JSON-file database. Devices only; written atomically, file mode 0600.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * @typedef {{ key: string, at: number, title: string, body: string }} Reminder
 * @typedef {{ id: string, secretHash: string, channels: Record<string, any>, reminders: Reminder[], sent: Record<string, number>, createdAt: number, updatedAt: number }} Device
 */

/** @param {string|null} file */
export function createDb(file) {
  /** @type {{ devices: Record<string, Device> }} */
  let data = { devices: {} };
  if (file && existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (parsed && typeof parsed.devices === 'object') data = parsed;
    } catch {
      /* start empty; a corrupt file is replaced on the next write */
    }
  }
  let chain = Promise.resolve();
  return {
    devices: () => Object.values(data.devices),
    /** @param {string} id @returns {Device|undefined} */
    get: (id) => data.devices[id],
    /** @param {Device} d */
    put(d) {
      data.devices[d.id] = d;
      return this.flush();
    },
    /** @param {string} id */
    remove(id) {
      delete data.devices[id];
      return this.flush();
    },
    count: () => Object.keys(data.devices).length,
    flush() {
      if (!file) return Promise.resolve();
      chain = chain.then(() => {
        mkdirSync(dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
        renameSync(tmp, file);
      }).catch((err) => console.error('relay: could not write database:', err.message));
      return chain;
    },
  };
}
