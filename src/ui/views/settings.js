// @ts-check
import { toICS } from '../../domain/ics.js';
import { toBackupJSON, toEventsCSV } from '../../io/backup.js';
import { notificationState, requestNotificationPermission, showSystemNotification } from '../../app/notify.js';
import { confirmDialog, download, h, toast } from '../dom.js';
import { importPanel } from '../import-panel.js';
import { accountPanel } from '../account-panel.js';
import { connectionsPanel } from '../connections-panel.js';
import { offsetsEditor } from '../offsets-editor.js';

/** @typedef {import('./today.js').ViewCtx} ViewCtx */

/** @param {ViewCtx} ctx */
export function renderSettings(ctx) {
  const { store } = ctx;
  const { settings, events, persistent } = store.getState();

  // ---- Reminders ----
  const offsets = offsetsEditor(settings.reminderOffsets, async (chosen) => {
    await store.updateSettings({ reminderOffsets: chosen });
    toast(chosen.length ? 'Reminder times saved.' : 'Reminders turned off. You will still be asked how events went.');
  });

  const hourSel = h('select', { id: 'allday-hour', 'aria-label': 'All-day reminder time' },
    Array.from({ length: 24 }, (_, hh) => h('option', { value: String(hh), selected: hh === settings.allDayReminderHour }, `${String(hh).padStart(2, '0')}:00`)));
  hourSel.addEventListener('change', async () => {
    await store.updateSettings({ allDayReminderHour: Number(/** @type {HTMLSelectElement} */ (hourSel).value) });
    toast('Saved.');
  });

  // ---- Notifications ----
  const notifStatus = h('p', { class: 'muted', id: 'notif-status', role: 'status' });
  const paintNotif = () => {
    const s = notificationState();
    notifStatus.textContent =
      s === 'granted' ? 'Notifications are on for this browser.'
      : s === 'denied' ? 'Notifications are blocked. Re-enable them in your browser’s site settings.'
      : s === 'unsupported' ? 'This browser does not support notifications. Reminders still appear inside the app.'
      : 'Notifications are off.';
  };
  paintNotif();
  const notifBtn = h('button', { class: 'btn', type: 'button', id: 'enable-notif' }, 'Turn on notifications');
  notifBtn.addEventListener('click', async () => {
    const s = await requestNotificationPermission();
    paintNotif();
    if (s === 'granted') {
      await showSystemNotification({ title: 'ShowUp reminders are on', body: 'You will be nudged before each event.', tag: 'showup-test' });
    }
  });

  // ---- Calendar export ----
  const exportIcs = h('button', { class: 'btn', type: 'button', id: 'export-ics' }, 'Download calendar file (.ics)');
  exportIcs.addEventListener('click', () => {
    const upcoming = store.getState().events.filter((e) => e.status === 'upcoming');
    if (!upcoming.length) return toast('No upcoming events to export.', { kind: 'error' });
    download('showup-events.ics', toICS(upcoming, { settings: store.getState().settings, name: 'ShowUp events' }), 'text/calendar;charset=utf-8');
    toast(`Exported ${upcoming.length} events with reminders.`);
  });

  // ---- AI key ----
  const keyInput = /** @type {HTMLInputElement} */ (h('input', { type: 'password', id: 'ai-key', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-ant-…', 'aria-label': 'AI provider API key' }));
  const keyStatus = h('p', { class: 'muted', id: 'ai-status', role: 'status' });
  const paintKey = async () => {
    keyStatus.textContent = (await store.repo.getMeta('aiKey')) ? 'A key is saved in this browser.' : 'No key saved. Screenshots are read on your device.';
  };
  paintKey();
  const saveKey = h('button', { class: 'btn', type: 'button', id: 'ai-save' }, 'Save key');
  saveKey.addEventListener('click', async () => {
    const v = keyInput.value.trim();
    if (!v) return;
    if (v.length > 300 || /\s/.test(v)) return toast('That does not look like an API key.', { kind: 'error' });
    await store.repo.setMeta('aiKey', v);
    keyInput.value = '';
    await paintKey();
    toast('Key saved on this device only.');
  });
  const clearKey = h('button', { class: 'btn', type: 'button', id: 'ai-clear' }, 'Remove key');
  clearKey.addEventListener('click', async () => {
    await store.repo.deleteMeta('aiKey');
    await paintKey();
    toast('Key removed.');
  });

  // ---- Danger ----
  const wipe = h('button', { class: 'btn btn-danger', type: 'button', id: 'wipe' }, 'Delete all events');
  wipe.addEventListener('click', async () => {
    if (await confirmDialog('Delete all events?', 'This removes every event from this browser. Export a backup first if you might want them back.', 'Delete everything')) {
      await store.clearAll();
      toast('All events deleted.');
    }
  });

  return h('div', { class: 'stack-lg' },
    persistent ? null : h('p', { class: 'banner banner-warn', role: 'alert' }, 'Your browser is blocking storage, so events will be lost when you close this tab. Check private-browsing or site-data settings.'),
    accountPanel(ctx),
    connectionsPanel(ctx),
    h('section', { class: 'panel', 'aria-labelledby': 's-rem' },
      h('h2', { id: 's-rem' }, 'Reminders'),
      h('p', { class: 'muted' }, 'Tap the times you want a nudge before every event. Add your own too.'),
      offsets.el,
      h('div', { class: 'field field-inline' }, h('label', { for: 'allday-hour' }, 'All-day events remind at'), hourSel),
      notifStatus, notifBtn,
      h('p', { class: 'muted' }, 'Notifications appear while ShowUp is open or installed. For alerts when it is closed, add your events to your calendar:'),
      exportIcs),
    h('section', { class: 'panel', 'aria-labelledby': 's-data' },
      h('h2', { id: 's-data' }, 'Your data'),
      h('p', { class: 'muted' }, `${events.length} event${events.length === 1 ? '' : 's'} stored in this browser only.`),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', id: 'export-json', onclick: () => download('showup-backup.json', toBackupJSON(store.getState().events), 'application/json') }, 'Backup (.json)'),
        h('button', { class: 'btn', type: 'button', id: 'export-csv', onclick: () => download('showup-events.csv', toEventsCSV(store.getState().events), 'text/csv;charset=utf-8') }, 'Export (.csv)')),
      importPanel(ctx), wipe),
    h('section', { class: 'panel', 'aria-labelledby': 's-about' },
      h('h2', { id: 's-about' }, 'Privacy'),
      h('p', { class: 'muted' }, 'No tracking and no server. Your sign-in lives only on this device. Your events never leave this browser unless you export them or use your own AI key for a screenshot.')),
    h('details', { class: 'panel adv' },
      h('summary', {}, 'Advanced: AI screenshot reading (optional, not needed for Excel)'),
      h('div', { class: 'stack' },
        h('p', { class: 'muted' }, 'Only for the Screenshot option on Capture. Excel, CSV, voice and typing never use this. By default screenshots are read on your device; add your own Anthropic API key for higher accuracy. It stays in this browser (encrypted) and goes only to api.anthropic.com. Usage is billed to your own account.'),
        h('div', { class: 'row' }, keyInput, saveKey, clearKey),
        keyStatus)));
}