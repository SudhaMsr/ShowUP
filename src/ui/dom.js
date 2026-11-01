// @ts-check
/**
 * Tiny DOM helpers. All string children become text nodes, so user-supplied
 * text can never be interpreted as markup. There is deliberately no innerHTML
 * path here (a unit test greps src/ui to keep it that way).
 */

/**
 * @param {string} tag
 * @param {Record<string, any>|null} [props]  class, dataset, on<Event> handlers, or attributes
 * @param {...any} children  Node | string | number | null | false | arrays of those
 * @returns {HTMLElement}
 */
export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value' && 'value' in el) /** @type {any} */ (el).value = value;
    else if (key === 'checked' && 'checked' in el) /** @type {any} */ (el).checked = Boolean(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

/** @param {Node} parent @param {any[]} children */
function append(parent, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(parent, c);
    else parent.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Replace all children of a node. @param {Node} parent @param {...any} children */
export function setChildren(parent, ...children) {
  parent.textContent = '';
  append(parent, children);
}

/** @param {string} id @returns {HTMLElement} */
export function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

/**
 * Trigger a client-side file download.
 * @param {string} filename @param {string} content @param {string} mime
 */
export function download(filename, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Non-blocking message. Errors are announced assertively.
 * @param {string} message
 * @param {{ kind?: 'info'|'error', ms?: number }} [opts]
 */
export function toast(message, opts = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const kind = opts.kind ?? 'info';
  const el = h('div', { class: `toast${kind === 'error' ? ' toast-error' : ''}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  host.appendChild(el);
  while (host.children.length > 4) host.firstElementChild?.remove();
  setTimeout(() => el.remove(), opts.ms ?? 5000);
}

/**
 * Accessible confirm dialog (replaces window.confirm, which blocks the page and
 * cannot be styled or tested reliably).
 * @param {string} title @param {string} body @param {string} [confirmLabel]
 * @returns {Promise<boolean>}
 */
export function confirmDialog(title, body, confirmLabel = 'Confirm') {
  return new Promise((resolve) => {
    const dlg = /** @type {HTMLDialogElement} */ (
      h('dialog', { class: 'dialog dialog-small', 'aria-labelledby': 'confirm-title' },
        h('form', { method: 'dialog', class: 'stack' },
          h('h2', { id: 'confirm-title' }, title),
          h('p', null, body),
          h('div', { class: 'row end' },
            h('button', { class: 'btn', value: 'cancel', type: 'submit', autofocus: true }, 'Cancel'),
            h('button', { class: 'btn btn-danger', value: 'ok', type: 'submit', id: 'confirm-ok' }, confirmLabel))))
    );
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'ok');
      dlg.remove();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

/**
 * SVG element builder (SVG needs its own namespace). Same rules as h(): strings are text.
 * @param {string} tag @param {Record<string, string|number>} [attrs] @param {...(Node|string)} children
 * @returns {SVGElement}
 */
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}
