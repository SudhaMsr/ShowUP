// @ts-check
import { ACCEPT, readImportFiles } from '../io/import-files.js';
import { h, toast } from './dom.js';
import { openImportPreview } from './dialogs.js';

/**
 * Upload many files at once (drop or choose): Excel workbooks (every sheet),
 * CSV, calendar (.ics) and ShowUp backups. Shows one combined preview before
 * anything is saved.
 * @param {{ store: import('../app/store.js').Store }} ctx
 */
export function importPanel(ctx) {
  const { store } = ctx;
  const input = /** @type {HTMLInputElement} */ (
    h('input', { type: 'file', id: 'import-file', multiple: true, accept: ACCEPT, class: 'sr-only', 'aria-label': 'Choose files to import' })
  );
  const status = h('p', { class: 'muted', id: 'import-status', role: 'status' });
  const drop = h('label', { class: 'drop', for: 'import-file', id: 'upload-drop' },
    h('strong', null, 'Drop your files here, or choose them'),
    h('span', { class: 'muted' }, 'Pick several at once. Excel (.xlsx, every sheet), CSV, calendar (.ics) or a ShowUp backup (.json).'));

  /** @param {FileList|File[]} list */
  async function handle(list) {
    const files = [...list];
    if (!files.length) return;
    status.textContent = `Reading ${files.length} file${files.length === 1 ? '' : 's'}…`;
    drop.classList.add('drop-busy');
    try {
      const batch = await readImportFiles(files, { existing: store.getState().events });
      // Nothing readable at all: a plain error is clearer than an empty preview.
      if (!batch.events.length && batch.summaries.length && batch.summaries.every((f) => f.error)) {
        toast(batch.summaries.length === 1 ? /** @type {string} */ (batch.summaries[0].error) : `None of those files could be read. ${batch.summaries[0].error}`, { kind: 'error', ms: 8000 });
        return;
      }
      const single = files.length === 1;
      const isBackup = single && /\.json$/i.test(files[0].name);
      const ok = await openImportPreview({
        title: isBackup ? 'Restore backup' : single ? `Import from “${files[0].name}”` : `Import from ${files.length} files`,
        total: batch.events.length,
        flagged: batch.flagged,
        skipped: batch.skipped,
        files: batch.summaries,
      });
      if (ok && batch.events.length) {
        const n = await store.saveMany(batch.events);
        toast(isBackup ? 'Backup restored.' : `Imported ${n} event${n === 1 ? '' : 's'}${single ? '' : ` from ${files.length} files`}.${batch.flagged ? ` ${batch.flagged} to double-check on Today.` : ''}`);
      }
    } catch (err) {
      toast(/** @type {Error} */ (err).message || 'Could not read those files.', { kind: 'error', ms: 8000 });
    } finally {
      status.textContent = '';
      drop.classList.remove('drop-busy');
    }
  }

  input.addEventListener('change', () => {
    const picked = input.files ? [...input.files] : [];
    input.value = '';
    handle(picked);
  });
  for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('drop-over'); });
  for (const t of ['dragleave', 'drop']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('drop-over'); });
  drop.addEventListener('drop', (e) => {
    const files = /** @type {DragEvent} */ (e).dataTransfer?.files;
    if (files?.length) handle(files);
  });

  return h('div', { class: 'stack' }, drop, input, status);
}
