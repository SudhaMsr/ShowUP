// @ts-check
/**
 * Speech capture through the Web Speech API (Chrome, Edge, Safari). Feature
 * detected; the UI disables the mic button when unsupported and typing remains.
 */

/** @returns {any} */
function ctor() {
  const w = /** @type {any} */ (globalThis);
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function voiceSupported() {
  return ctor() !== null;
}

/** @param {string} code */
export function describeVoiceError(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission was denied. Allow it in the address bar and try again.';
    case 'no-speech':
      return 'I did not hear anything. Try again a little closer to the mic.';
    case 'audio-capture':
      return 'No microphone was found.';
    case 'network':
      return 'Speech recognition needs an internet connection in this browser.';
    default:
      return `Voice input failed (${code}).`;
  }
}

/**
 * @param {{ onText: (text: string) => void, onError: (message: string) => void, onEnd: () => void, lang?: string }} handlers
 * @returns {{ start: () => void, stop: () => void } | null}
 */
export function createVoice(handlers) {
  const Recognition = ctor();
  if (!Recognition) return null;
  const rec = new Recognition();
  rec.lang = handlers.lang ?? 'en-GB';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = '';
  rec.onresult = (/** @type {any} */ ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) finalText += `${r[0].transcript} `;
      else interim += r[0].transcript;
    }
    handlers.onText((finalText + interim).trim());
  };
  rec.onerror = (/** @type {any} */ ev) => handlers.onError(describeVoiceError(String(ev.error ?? 'unknown')));
  rec.onend = () => handlers.onEnd();
  return {
    start() {
      finalText = '';
      try {
        rec.start();
      } catch {
        handlers.onError('Could not start the microphone. Try again.');
      }
    },
    stop() {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}
