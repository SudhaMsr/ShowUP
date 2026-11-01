// @ts-check
import { IDLE_CHOICES } from '../app/auth.js';
import { passwordStrength } from '../app/crypto.js';
import { confirmDialog, h, toast } from './dom.js';

/**
 * @typedef {{ name: string, idleMinutes: number, auth: import('../app/auth.js').Auth, lock: () => Promise<void>, eraseAll: () => Promise<void> }} Account
 */

/**
 * Settings → Account. Returns null when this browser runs without sign-in.
 * @param {{ account?: Account | null }} ctx
 */
export function accountPanel(ctx) {
  const account = ctx.account;
  if (!account) return null;
  const { auth } = account;

  const nameInput = /** @type {HTMLInputElement} */ (h('input', { id: 'acc-name', type: 'text', maxlength: '60', value: account.name, autocomplete: 'name' }));
  const saveName = h('button', { class: 'btn', type: 'button', id: 'acc-name-save' }, 'Save name');
  saveName.addEventListener('click', async () => {
    if (await auth.rename(nameInput.value)) {
      toast('Name updated.');
      account.name = nameInput.value.trim();
    } else toast('Enter a name.', { kind: 'error' });
  });

  const idle = /** @type {HTMLSelectElement} */ (
    h('select', { id: 'acc-idle', 'aria-label': 'Auto-lock' },
      IDLE_CHOICES.map((m) => h('option', { value: String(m), selected: m === account.idleMinutes }, m ? `After ${m} minutes idle` : 'Never'))));
  idle.addEventListener('change', async () => {
    await auth.setIdleMinutes(Number(idle.value));
    account.idleMinutes = Number(idle.value);
    toast('Auto-lock saved.');
  });

  const oldPw = /** @type {HTMLInputElement} */ (h('input', { id: 'acc-old', type: 'password', autocomplete: 'current-password', maxlength: '200' }));
  const newPw = /** @type {HTMLInputElement} */ (h('input', { id: 'acc-new', type: 'password', autocomplete: 'new-password', maxlength: '200' }));
  const meter = h('div', { class: 'meter', 'data-score': '0', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
  const pwErr = h('p', { class: 'field-error', id: 'acc-pw-err', role: 'alert' });
  newPw.addEventListener('input', () => (meter.dataset.score = String(passwordStrength(newPw.value).score)));
  const changeBtn = h('button', { class: 'btn', type: 'button', id: 'acc-pw-save' }, 'Change password');
  changeBtn.addEventListener('click', async () => {
    pwErr.textContent = '';
    changeBtn.setAttribute('disabled', '');
    const r = await auth.changePassword(oldPw.value, newPw.value);
    changeBtn.removeAttribute('disabled');
    if (!r.ok) {
      pwErr.textContent = r.errors.oldPassword || r.errors.newPassword || r.errors.form || 'Could not change the password.';
      return;
    }
    oldPw.value = newPw.value = '';
    meter.dataset.score = '0';
    toast('Password changed. Your events did not need re-encrypting.');
  });

  const lockNow = h('button', { class: 'btn', type: 'button', id: 'acc-lock' }, 'Lock now');
  lockNow.addEventListener('click', () => account.lock());

  const erase = h('button', { class: 'btn btn-danger', type: 'button', id: 'acc-erase' }, 'Delete account and all data');
  erase.addEventListener('click', async () => {
    if (await confirmDialog('Delete everything?', 'This erases your account and every event on this device. It cannot be undone. Export a backup first if you might want them back.', 'Delete everything')) {
      await account.eraseAll();
    }
  });

  return h('section', { class: 'panel', 'aria-labelledby': 's-acc', id: 'account-panel' },
    h('h2', { id: 's-acc' }, 'Account'),
    h('p', { class: 'muted' }, 'Your events are encrypted on this device with your password. Nothing is uploaded.'),
    h('div', { class: 'field' }, h('label', { for: 'acc-name' }, 'Name'), nameInput, saveName),
    h('div', { class: 'field' }, h('label', { for: 'acc-idle' }, 'Auto-lock'), idle),
    h('fieldset', { class: 'stack' },
      h('legend', {}, 'Change password'),
      h('div', { class: 'field' }, h('label', { for: 'acc-old' }, 'Current password'), oldPw),
      h('div', { class: 'field' }, h('label', { for: 'acc-new' }, 'New password'), newPw, meter),
      pwErr, changeBtn),
    h('div', { class: 'row-actions' }, lockNow, erase));
}
