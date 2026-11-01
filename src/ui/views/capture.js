// @ts-check
import { parseCapture, parseMany } from '../../domain/capture.js';
import { localISO } from '../../domain/dates.js';
import { createVoice, voiceSupported } from '../../capture/voice.js';
import { checkImage } from '../../capture/image.js';
import { ocrDrafts, visionDrafts } from '../../capture/screenshot.js';
import { h, toast } from '../dom.js';
import { openEditor, openReview } from '../dialogs.js';
import { importPanel } from '../import-panel.js';

/** @typedef {import('./today.js').ViewCtx} ViewCtx */

/** @param {ViewCtx} ctx */
export function renderCapture(ctx) {
  const { store } = ctx;

  // ---- Type / paste ----
  const area = /** @type {HTMLTextAreaElement} */ (
    h('textarea', {
      id: 'capture-text', rows: 4, maxlength: 4000,
      placeholder: 'e.g. “AWS Summit London on 12 Nov at 9am at ExCeL London” or paste an email or schedule',
      'aria-label': 'Describe or paste an event',
    })
  );
  const addBtn = h('button', { class: 'btn btn-primary', type: 'button', id: 'capture-go' }, 'Review event');
  const submitText = async () => {
    const text = area.value.trim();
    if (!text) {
      toast('Type or paste something first.', { kind: 'error' });
      area.focus();
      return;
    }
    const drafts = parseMany(text);
    const saved = await openReview(store, drafts, 'text');
    if (saved) area.value = '';
  };
  addBtn.addEventListener('click', submitText);
  area.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitText();
  });

  // ---- Voice ----
  const voiceStatus = h('p', { class: 'muted', id: 'voice-status', role: 'status' }, 'Tap the microphone and say it naturally.');
  const transcript = h('p', { class: 'transcript', id: 'voice-transcript', 'aria-live': 'polite' });
  const micBtn = h('button', { class: 'mic', type: 'button', id: 'mic', 'aria-pressed': 'false', 'aria-label': 'Start voice capture' },
    h('span', { class: 'mic-dot', 'aria-hidden': 'true' }), h('span', { class: 'mic-label' }, 'Speak'));
  let listening = false;
  let latest = '';
  /** @type {ReturnType<typeof createVoice>} */
  let voice = null;
  const setListening = (/** @type {boolean} */ on) => {
    listening = on;
    micBtn.setAttribute('aria-pressed', String(on));
    micBtn.setAttribute('aria-label', on ? 'Stop voice capture' : 'Start voice capture');
    /** @type {HTMLElement} */ (micBtn.querySelector('.mic-label')).textContent = on ? 'Stop' : 'Speak';
    micBtn.classList.toggle('mic-on', on);
  };
  if (voiceSupported()) {
    voice = createVoice({
      onText: (t) => {
        latest = t;
        transcript.textContent = t;
      },
      onError: (m) => {
        voiceStatus.textContent = m;
        setListening(false);
      },
      onEnd: async () => {
        const wasListening = listening;
        setListening(false);
        if (wasListening && latest.trim()) {
          voiceStatus.textContent = 'Got it. Review below.';
          const saved = await openReview(store, [parseCapture(latest)], 'voice');
          if (saved) transcript.textContent = '';
        }
      },
    });
    micBtn.addEventListener('click', () => {
      if (listening) {
        voice?.stop();
      } else {
        latest = '';
        transcript.textContent = '';
        voiceStatus.textContent = 'Listening…';
        setListening(true);
        voice?.start();
      }
    });
  } else {
    micBtn.setAttribute('disabled', '');
    voiceStatus.textContent = 'Voice capture is not available in this browser. Try Chrome, Edge or Safari, or type instead.';
  }

  // ---- Screenshot ----
  const shotStatus = h('p', { class: 'muted', id: 'shot-status', role: 'status' });
  const fileInput = /** @type {HTMLInputElement} */ (h('input', { type: 'file', id: 'shot-file', accept: 'image/png,image/jpeg,image/webp', class: 'sr-only', 'aria-label': 'Choose a screenshot' }));
  const drop = h('label', { class: 'drop', for: 'shot-file', id: 'drop' },
    h('strong', null, 'Drop, choose or paste a screenshot'),
    h('span', { class: 'muted' }, 'Registration emails, tickets, flyers, schedules'));

  /** @param {File|Blob} file */
  async function handleImage(file) {
    try {
      checkImage(file);
    } catch (err) {
      toast(/** @type {Error} */ (err).message, { kind: 'error' });
      return;
    }
    const key = /** @type {string|undefined} */ (await store.repo.getMeta('aiKey'));
    const { aiModel } = store.getState().settings;
    shotStatus.textContent = key ? 'Reading the image with your AI key…' : 'Reading the image on this device… (first time takes a moment)';
    drop.classList.add('drop-busy');
    try {
      const result = key
        ? await visionDrafts(file, { apiKey: key, model: aiModel, today: localISO() })
        : await ocrDrafts(file);
      shotStatus.textContent = '';
      if (!result.drafts.length) {
        toast('No events found in that image. You can add one manually.', { kind: 'error' });
        openEditor(store, null);
        return;
      }
      await openReview(store, result.drafts, 'screenshot', {
        note: result.provider === 'ocr'
          ? 'Read on your device. Text recognition can slip, so double-check each field.'
          : 'Read by your AI provider. Check each field before saving.',
      });
    } catch (err) {
      shotStatus.textContent = '';
      toast(/** @type {Error} */ (err).message, { kind: 'error', ms: 8000 });
    } finally {
      drop.classList.remove('drop-busy');
    }
  }
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) handleImage(f);
    fileInput.value = '';
  });
  for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('drop-over'); });
  for (const t of ['dragleave', 'drop']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('drop-over'); });
  drop.addEventListener('drop', (e) => {
    const f = /** @type {DragEvent} */ (e).dataTransfer?.files?.[0];
    if (f) handleImage(f);
  });
  const onPaste = (/** @type {ClipboardEvent} */ e) => {
    if (!document.getElementById('drop')) {
      document.removeEventListener('paste', onPaste);
      return;
    }
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    const f = item?.getAsFile();
    if (f) {
      e.preventDefault();
      handleImage(f);
    }
  };
  document.addEventListener('paste', onPaste);

  return h('div', { class: 'stack-lg' },
    h('section', { class: 'panel', 'aria-labelledby': 'cap-voice' },
      h('h2', { id: 'cap-voice' }, 'Say it'),
      micBtn, voiceStatus, transcript),
    h('section', { class: 'panel', 'aria-labelledby': 'cap-shot' },
      h('h2', { id: 'cap-shot' }, 'Show it'),
      drop, fileInput, shotStatus),
    h('section', { class: 'panel', 'aria-labelledby': 'cap-files' },
      h('h2', { id: 'cap-files' }, 'Upload your files'),
      h('p', { class: 'muted' }, 'Already keep your events in Excel, a CSV or a calendar? Drop all your files in at once.'),
      importPanel(ctx)),
    h('section', { class: 'panel', 'aria-labelledby': 'cap-type' },
      h('h2', { id: 'cap-type' }, 'Type or paste it'),
      area,
      h('div', { class: 'row' }, addBtn,
        h('button', { class: 'btn', type: 'button', id: 'add-manual', onclick: () => openEditor(store, null) }, 'Fill in a form instead'))));
}
