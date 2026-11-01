// @ts-check
import { h, toast } from './dom.js';

/**
 * Settings → Connections (Google Calendar and Gmail, read-only).
 * @param {{ connections?: import('../app/connections.js').Connections }} ctx
 */
export function connectionsPanel(ctx) {
  const c = ctx.connections;
  if (!c) return null;

  const clientId = /** @type {HTMLInputElement} */ (h('input', { id: 'g-client', type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: '1234-abc.apps.googleusercontent.com', 'aria-label': 'Google Client ID' }));
  const gmail = /** @type {HTMLInputElement} */ (h('input', { id: 'g-gmail', type: 'checkbox' }));
  const status = h('p', { class: 'muted', id: 'g-status', role: 'status' });
  const errors = h('p', { class: 'field-error', id: 'g-errors', role: 'alert' });
  const connect = /** @type {HTMLButtonElement} */ (h('button', { class: 'btn btn-primary', type: 'button', id: 'g-connect' }, 'Connect Google'));
  const syncBtn = /** @type {HTMLButtonElement} */ (h('button', { class: 'btn', type: 'button', id: 'g-sync' }, 'Check now'));
  const disconnect = /** @type {HTMLButtonElement} */ (h('button', { class: 'btn btn-danger', type: 'button', id: 'g-disconnect' }, 'Disconnect'));
  const row = h('div', { class: 'row-actions' }, connect, syncBtn, disconnect);

  const paint = async () => {
    const cfg = await c.config();
    if (document.activeElement !== clientId) clientId.value = cfg.clientId;
    gmail.checked = cfg.gmail;
    connect.textContent = cfg.connected ? (cfg.needsReconnect ? 'Reconnect' : 'Reconnect Google') : 'Connect Google';
    syncBtn.hidden = disconnect.hidden = !cfg.connected;
    status.textContent = !cfg.connected
      ? 'Not connected.'
      : cfg.needsReconnect
        ? 'Google access expired. Press Reconnect to keep syncing.'
        : cfg.lastSync
          ? `Connected. Last checked ${new Date(cfg.lastSync).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}, ${cfg.lastAdded} new.`
          : 'Connected.';
    errors.textContent = cfg.errors.join(' ');
  };
  c.subscribe(() => void paint());
  void paint();

  const guard = async (/** @type {HTMLButtonElement} */ btn, /** @type {() => Promise<unknown>} */ fn) => {
    btn.disabled = true;
    try {
      await fn();
    } catch (e) {
      toast(/** @type {Error} */ (e).message, { kind: 'error', ms: 8000 });
    } finally {
      btn.disabled = false;
      void paint();
    }
  };

  connect.addEventListener('click', () =>
    guard(connect, async () => {
      const r = await c.connect(clientId.value, gmail.checked);
      toast(r.added ? `Found ${r.added} event${r.added === 1 ? '' : 's'}. Open Approvals to review.` : 'Connected. Nothing new to approve yet.');
    }));
  syncBtn.addEventListener('click', () =>
    guard(syncBtn, async () => {
      const r = await c.syncNow();
      if (r.needsReconnect) toast('Google access expired. Press Reconnect.', { kind: 'error' });
      else toast(r.added ? `Found ${r.added} new. Open Approvals.` : 'Checked. Nothing new.');
    }));
  disconnect.addEventListener('click', () => guard(disconnect, () => c.disconnect().then(() => toast('Disconnected. Access was revoked at Google.'))));
  gmail.addEventListener('change', async () => {
    const cfg = await c.config();
    if (!cfg.connected) return;
    await guard(connect, () => c.setGmail(gmail.checked));
  });

  const origin = location.origin;
  return h('section', { class: 'panel', 'aria-labelledby': 's-google', id: 'connections-panel' },
    h('h2', { id: 's-google' }, 'Connect Google'),
    h('p', { class: 'muted' }, 'ShowUp reads your Google Calendar (and, if you choose, recent registration emails), proposes events, and waits for your approval before adding anything. It never writes to Google. It checks every 20 minutes while ShowUp is open.'),
    h('div', { class: 'field' }, h('label', { for: 'g-client' }, 'Your Google Client ID'), clientId),
    h('label', { class: 'check' }, gmail, h('span', {}, 'Also scan Gmail for registration emails (last 30 days)')),
    row, status, errors,
    h('details', { class: 'adv', id: 'g-help' },
      h('summary', {}, 'How to get a Client ID (free, about 5 minutes)'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Go to console.cloud.google.com and create a project (any name).'),
        h('li', {}, 'APIs & Services → Library: enable “Google Calendar API” (and “Gmail API” if you want email).'),
        h('li', {}, 'APIs & Services → OAuth consent screen: choose External, fill in the app name and your email, and add yourself under “Test users”.'),
        h('li', {}, 'APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.'),
        h('li', {}, `Under “Authorized JavaScript origins” add exactly: ${origin}`),
        h('li', {}, 'Copy the Client ID it gives you, paste it above, and press Connect Google.')),
      h('p', { class: 'muted' }, 'Why you make your own: ShowUp has no server, so there is nowhere safe to keep a shared secret. Your own ID keeps your calendar between you and Google. While the project is in “Testing”, Google asks you to sign in again about weekly, and ShowUp will show a Reconnect button.')));
}
