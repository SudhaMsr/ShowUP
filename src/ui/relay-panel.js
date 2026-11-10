// @ts-check
import { h, toast } from './dom.js';

/**
 * Settings → "Reminders when ShowUp is closed" (optional relay).
 * @param {{ relay?: import('../app/relay.js').Relay }} ctx
 */
export function relayPanel(ctx) {
  const relay = ctx.relay;
  if (!relay) return null;

  /** @param {string} id @param {string} label @param {string} [placeholder] @param {string} [type] */
  const input = (id, label, placeholder = '', type = 'text') => {
    const el = /** @type {HTMLInputElement} */ (h('input', { id, type, autocomplete: 'off', spellcheck: 'false', placeholder, 'aria-label': label }));
    return { el, row: h('div', { class: 'field' }, h('label', { for: id }, label), el) };
  };
  const url = input('r-url', 'Relay address', 'https://relay.example.org', 'url');
  const ntfy = input('r-ntfy', 'ntfy topic', 'a long random name, e.g. showup-7f3k9x2m');
  const tgToken = input('r-tg-token', 'Telegram bot token', '123456:ABC…', 'password');
  const tgChat = input('r-tg-chat', 'Telegram chat id', '123456789');
  const hook = input('r-hook', 'Webhook address', 'https://…', 'url');
  const email = input('r-email', 'Email me at', 'you@example.com', 'email');
  const hide = /** @type {HTMLInputElement} */ (h('input', { id: 'r-hide', type: 'checkbox' }));
  const pushBtn = /** @type {HTMLButtonElement} */ (h('button', { class: 'btn', type: 'button', id: 'r-push' }, 'Use this browser (Web Push)'));
  const pushNote = h('p', { class: 'muted', id: 'r-push-note' });
  const status = h('p', { class: 'muted', id: 'r-status', role: 'status' });
  const errors = h('p', { class: 'field-error', id: 'r-errors', role: 'alert' });
  const connect = /** @type {HTMLButtonElement} */ (h('button', { class: 'btn btn-primary', type: 'button', id: 'r-connect' }, 'Save and connect'));
  const testBtn = /** @type {HTMLButtonElement} */ (h('button', { class: 'btn', type: 'button', id: 'r-test' }, 'Send a test'));
  const off = /** @type {HTMLButtonElement} */ (h('button', { class: 'btn btn-danger', type: 'button', id: 'r-off' }, 'Disconnect'));

  /** @type {{ endpoint: string, keys: { p256dh: string, auth: string } } | undefined} */
  let pushSub;

  const paint = async () => {
    const c = await relay.config();
    if (document.activeElement !== url.el) url.el.value = c.url;
    pushSub = c.enabled ? c.channels.push?.subscription : pushSub;
    ntfy.el.value = c.channels.ntfy?.topic ?? ntfy.el.value;
    if (c.channels.telegram) { tgToken.el.value = c.channels.telegram.botToken; tgChat.el.value = c.channels.telegram.chatId; }
    hook.el.value = c.channels.webhook?.url ?? hook.el.value;
    email.el.value = c.channels.email?.to ?? email.el.value;
    hide.checked = c.hideTitles;
    pushNote.textContent = pushSub ? 'This browser is subscribed.' : '';
    testBtn.hidden = off.hidden = !c.enabled;
    status.textContent = !c.enabled
      ? 'Not connected. ShowUp only reminds you while it is open or installed.'
      : c.lastError
        ? 'Connected, but the last update failed.'
        : c.lastSync
          ? `Connected. ${c.lastCount} upcoming reminder${c.lastCount === 1 ? '' : 's'} sent to your relay at ${new Date(c.lastSync).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`
          : 'Connected.';
    errors.textContent = c.lastError ?? '';
  };
  relay.subscribe(() => void paint());
  void paint();

  /** @param {HTMLButtonElement} btn @param {() => Promise<unknown>} fn */
  const guard = async (btn, fn) => {
    btn.disabled = true;
    errors.textContent = '';
    try {
      await fn();
    } catch (err) {
      errors.textContent = err instanceof Error ? err.message : 'Something went wrong.';
    } finally {
      btn.disabled = false;
    }
  };

  pushBtn.addEventListener('click', () => guard(pushBtn, async () => {
    pushSub = await relay.subscribePush(url.el.value);
    pushNote.textContent = 'This browser is ready. Press Save and connect to finish.';
  }));

  connect.addEventListener('click', () => guard(connect, async () => {
    /** @type {import('../app/relay.js').Channels} */
    const channels = {};
    if (ntfy.el.value.trim()) channels.ntfy = { topic: ntfy.el.value.trim() };
    if (tgToken.el.value.trim() || tgChat.el.value.trim()) channels.telegram = { botToken: tgToken.el.value.trim(), chatId: tgChat.el.value.trim() };
    if (hook.el.value.trim()) channels.webhook = { url: hook.el.value.trim() };
    if (email.el.value.trim()) channels.email = { to: email.el.value.trim() };
    if (pushSub) channels.push = { subscription: pushSub };
    await relay.connect({ url: url.el.value, channels, hideTitles: hide.checked });
    toast('Relay connected. Reminders will now reach you when ShowUp is closed.');
  }));

  testBtn.addEventListener('click', () => guard(testBtn, async () => {
    const r = await relay.test();
    const lines = Object.entries(r.results).map(([k, v]) => `${k}: ${v.ok ? 'sent' : v.detail}`);
    toast(r.ok ? `Test sent (${lines.join(', ')}).` : `The test did not go through (${lines.join(', ')}).`, { kind: r.ok ? undefined : 'error', ms: 8000 });
  }));

  off.addEventListener('click', () => guard(off, async () => {
    const r = await relay.disconnect();
    toast(r.remoteGone ? 'Disconnected. Your reminder times were deleted from the relay.' : 'Disconnected here. The relay could not be reached to delete your reminder times; they expire on their own.', { ms: 8000 });
  }));

  return h('details', { class: 'panel adv', id: 'relay-panel' },
    h('summary', {}, 'Optional: reminders when ShowUp is closed'),
    h('div', { class: 'stack' },
      h('p', { class: 'muted' }, 'A phone browser cannot wake a closed web app, so ShowUp can hand your reminder times to a small relay that you host (see server/README.md). It sends only the time, title and text of upcoming reminders, never your notes, links or other details, and you can hide titles below. Choose one or more ways to be reached.'),
      url.row,
      h('div', { class: 'details-grid' }, ntfy.row, hook.row, tgToken.row, tgChat.row, email.row),
      h('div', { class: 'row' }, pushBtn, pushNote),
      h('div', { class: 'field field-inline' }, hide, h('label', { for: 'r-hide' }, 'Hide event titles from the relay (reminders just say "ShowUp reminder")')),
      h('div', { class: 'row-actions' }, connect, testBtn, off),
      status, errors,
      h('p', { class: 'muted' }, 'The relay keeps your device secret hashed, and any Telegram token or webhook address you give it as plain text on its disk. Only use a relay you trust. On an iPhone, Web Push needs ShowUp added to the Home Screen; ntfy and Telegram work without that.')));
}
