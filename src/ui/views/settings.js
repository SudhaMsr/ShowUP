// @ts-check
import { describeOffset } from '../../domain/reminders.js';
import { toICS } from '../../domain/ics.js';
import { mapSheet, mapWorkbook } from '../../io/sheet-import.js';
import { parseCSV } from '../../io/csv.js';
import { readXlsx } from '../../io/xlsx.js';
import { mergeById, parseBackupJSON, toBackupJSON, toEventsCSV } from '../../io/backup.js';
import { notificationState, requestNotificationPermission, showSystemNotification } from '../../app/notify.js';
import { confirmDialog, download, h, toast } from '../dom.js';
import { openImportPreview } from '../dialogs.js';

/** @typedef {import('./today.js').ViewCtx} ViewCtx */

const OFFSET_CHOICES = [10080, 2880, 1440, 180, 60, 15, 0];

/** @param {ViewCtx} ctx */
export function renderSettings(ctx) {
  const { store } = ctx;
  const { settings, events, persistent } = store.getState();

  // ---- Reminders ----
  const boxes = OFFSET_CHOICES.map((m) => {
    const id = `off-${m}`;
    const cb = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', id, checked: settings.reminderOffsets.includes(m), value: String(m) }));
    cb.addEventListener('change', async () => {
      const chosen = OFFSET_CHOICES.filter((x) => /** @type {HTMLInputElement} */ (document.getElementById(`off-${x}`)).checked);
      await store.updateSettings({ reminderOffsets: chosen });
      toast('Reminder times saved.');
    });
    return h('label', { class: 'check', for: id }, cb, describeOffset(m));
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

  // ---- Import ----
  const importInput = /** @type {HTMLInputElement} */ (h('input', { type: 'file', id: 'import-file', accept: '.xlsx,.csv,.json', class: 'sr-only', 'aria-label': 'Choose a file to import' }));
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    try {
      const name = file.name.toLowerCase();
      const existing = store.getState().events;
      if (name.endsWith('.xlsx')) {
        const sheets = await readXlsx(await file.arrayBuffer());
        const r = mapWorkbook(sheets, { existing });
        const ok = await openImportPreview({ title: `Import from “${file.name}”`, total: r.events.length, flagged: r.flagged, skipped: r.skipped, extra: r.sheetName ? `Using sheet “${r.sheetName}”.` : undefined });
        if (ok) toast(`Imported ${await store.saveMany(r.events)} events.`);
      } else if (name.endsWith('.csv')) {
        const r = mapSheet(parseCSV(await file.text()), { existing });
        const ok = await openImportPreview({ title: `Import from “${file.name}”`, total: r.events.length, flagged: r.flagged, skipped: r.skipped });
        if (ok) toast(`Imported ${await store.saveMany(r.events)} events.`);
      } else if (name.endsWith('.json')) {
        const { events: incoming, rejected } = parseBackupJSON(await file.text());
        const { merged, added, updated } = mergeById(existing, incoming);
        const ok = await openImportPreview({
          title: 'Restore backup', total: added + updated, flagged: 0,
          skipped: rejected ? [{ row: 0, reason: `${rejected} invalid event${rejected === 1 ? '' : 's'} ignored`, preview: '' }] : [],
          extra: `${added} new, ${updated} updated.`,
        });
        if (ok) {
          await store.saveMany(merged.filter((m) => incoming.some((i) => i.id === m.id)));
          toast('Backup restored.');
        }
      } else {
        toast('Choose an .xlsx, .csv or .json file.', { kind: 'error' });
      }
    } catch (err) {
      toast(/** @type {Error} */ (err).message || 'Could not read that file.', { kind: 'error', ms: 8000 });
    }
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
    h('section', { class: 'panel', 'aria-labelledby': 's-rem' },
      h('h2', { id: 's-rem' }, 'Reminders'),
      h('fieldset', { class: 'checks' }, h('legend', { class: 'sr-only' }, 'When to remind me'), boxes),
      h('div', { class: 'field field-inline' }, h('label', { for: 'allday-hour' }, 'All-day events remind at'), hourSel),
      notifStatus, notifBtn,
      h('p', { class: 'muted' }, 'Notifications appear while ShowUp is open or installed. For alerts when it is closed, add your events to your calendar:'),
      exportIcs),
    h('section', { class: 'panel', 'aria-labelledby': 's-data' },
      h('h2', { id: 's-data' }, 'Your data'),
      h('p', { class: 'muted' }, `${events.length} event${events.length === 1 ? '' : 's'} stored in this browser only.`),
      h('div', { class: 'row' },
        h('label', { class: 'btn', for: 'import-file', id: 'import-label', tabindex: '0', role: 'button', onkeydown: (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); importInput.click(); } } }, 'Import spreadsheet or backup'),
        h('button', { class: 'btn', type: 'button', id: 'export-json', onclick: () => download('showup-backup.json', toBackupJSON(store.getState().events), 'application/json') }, 'Backup (.json)'),
        h('button', { class: 'btn', type: 'button', id: 'export-csv', onclick: () => download('showup-events.csv', toEventsCSV(store.getState().events), 'text/csv;charset=utf-8') }, 'Export (.csv)')),
      importInput, wipe),
    h('section', { class: 'panel', 'aria-labelledby': 's-ai' },
      h('h2', { id: 's-ai' }, 'Better screenshot reading (optional)'),
      h('p', { class: 'muted' }, 'By default screenshots are read on your device. For higher accuracy you can add your own Anthropic API key. It is stored only in this browser and sent only to api.anthropic.com. Usage is billed to your own account.'),
      h('div', { class: 'row' }, keyInput, saveKey, clearKey),
      keyStatus),
    h('section', { class: 'panel', 'aria-labelledby': 's-about' },
      h('h2', { id: 's-about' }, 'Privacy'),
      h('p', { class: 'muted' }, 'No account, no tracking, no server. Your events never leave this browser unless you export them or use your own AI key for a screenshot.')));
}
