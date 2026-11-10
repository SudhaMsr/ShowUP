// @ts-check
import { passwordStrength } from '../app/crypto.js';
import { FREE_ATTEMPTS } from '../app/auth.js';
import { h, setChildren } from './dom.js';
import { demoFrame, typeMarquee } from './welcome.js';

/**
 * Full-screen create-account / sign-in. Resolves once the user is in.
 * @typedef {import('../app/auth.js').Auth} Auth
 * @typedef {{ key: CryptoKey, profile: import('../app/auth.js').Profile }} Unlocked
 *
 * @param {HTMLElement} root
 * @param {Auth} auth
 * @param {{ onErase: () => Promise<void> }} hooks  wipes the encrypted data when the password is forgotten
 * @returns {Promise<Unlocked>}
 */
export function showAuthScreen(root, auth, hooks) {
  return new Promise((resolve) => {
    root.hidden = false;
    document.body.classList.add('auth-open');
    const finish = (/** @type {Unlocked} */ u) => {
      root.classList.add('auth-leaving');
      const done = () => {
        root.hidden = true;
        root.classList.remove('auth-leaving');
        setChildren(root);
        document.body.classList.remove('auth-open');
        resolve(u);
      };
      // Let the exit animation play; skip it when motion is reduced or unsupported.
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) done();
      else {
        root.addEventListener('animationend', done, { once: true });
        setTimeout(done, 600);
      }
    };

    auth.getProfile().then((profile) => (profile ? signIn(profile) : signUp()));

    // ---------- shared pieces ----------
    /** SVG needs the SVG namespace, which h() does not do; build the mark separately. */
    const mark = () => {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 32 32');
      svg.setAttribute('width', '34');
      svg.setAttribute('height', '34');
      svg.setAttribute('aria-hidden', 'true');
      svg.classList.add('brand-mark');
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('width', '32'); r.setAttribute('height', '32'); r.setAttribute('rx', '8'); r.setAttribute('fill', 'currentColor');
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', 'M9 17.5l4.5 4.5L23 11'); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'var(--accent)');
      p.setAttribute('stroke-width', '3.2'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
      p.classList.add('mark-tick');
      svg.append(r, p);
      return svg;
    };
    const header = () => h('div', { class: 'auth-brand' }, mark(), h('span', { class: 'brand-name' }, 'ShowUp'));

    /** @param {string} id @param {string} label @param {Record<string, any>} attrs */
    const field = (id, label, attrs) =>
      h('div', { class: 'field' }, h('label', { for: id }, label), h('input', { id, ...attrs }), h('p', { class: 'field-error', id: `${id}-err`, role: 'alert' }));
    /** @param {string} id @param {string} msg */
    const fieldError = (id, msg) => {
      const el = document.getElementById(`${id}-err`);
      if (el) el.textContent = msg;
      document.getElementById(id)?.setAttribute('aria-invalid', msg ? 'true' : 'false');
    };

    /** Notion-style front page shown before sign-up: nav, big headline, demo, then the form. */
    const landing = (/** @type {HTMLElement} */ card) => {
      const toForm = () => {
        document.getElementById('start')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
        setTimeout(() => /** @type {HTMLElement|null} */ (document.getElementById('auth-name'))?.focus({ preventScroll: true }), 350);
      };
      const nav = h('header', { class: 'lp-nav' },
        h('div', { class: 'lp-nav-in' },
          h('div', { class: 'lp-logo' }, mark(), h('span', { class: 'brand-name' }, 'ShowUp')),
          h('nav', { class: 'lp-links', 'aria-label': 'Page' },
            h('a', { href: '#how', onclick: (/** @type {Event} */ e) => { e.preventDefault(); document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' }); } }, 'How it works'),
            h('a', { href: '#start', onclick: (/** @type {Event} */ e) => { e.preventDefault(); toForm(); } }, 'Privacy'),
            h('a', { href: '#start', onclick: (/** @type {Event} */ e) => { e.preventDefault(); toForm(); } }, 'Get started')),
          h('div', { class: 'lp-nav-cta' },
            h('button', { class: 'btn btn-primary', type: 'button', onclick: toForm }, 'Get ShowUp free'))));
      const hero = h('section', { class: 'lp-hero', 'aria-labelledby': 'lp-title' },
        h('h1', { id: 'lp-title', class: 'lp-title' }, 'Where students never miss an ', h('span', { class: 'wl-word' }, h('i'), 'opportunity'), ' again.'),
        h('p', { class: 'lp-sub' }, 'Capture hackathons, internships and scholarships, track them to a result, and get reminded before the deadline.'),
        h('div', { class: 'lp-cta' },
          h('button', { class: 'btn btn-primary lp-btn', type: 'button', onclick: toForm }, 'Get ShowUp free'),
          h('button', { class: 'btn lp-btn lp-btn-soft', type: 'button', onclick: () => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' }) }, 'See how it works')),
        h('div', { class: 'lp-demo', id: 'how' }, demoFrame()));
      const how = h('section', { class: 'lp-three', 'aria-label': 'What ShowUp does' },
        [['Capture', 'Paste text, say it, snap a screenshot or import a sheet. ShowUp fills in the details.'],
         ['Track', 'Move each opportunity from Found to Applied to Offer, with a checklist and links.'],
         ['Remember', 'Nudges 3 days and 1 day before a deadline, and silence once you have submitted.']].map(([t, d], i) =>
          h('article', { class: 'lp-card', 'data-reveal': '' }, h('span', { class: 'lp-num' }, String(i + 1)), h('h3', null, t), h('p', null, d))));
      const start = h('section', { class: 'lp-start', id: 'start', 'data-reveal': '' },
        h('h2', null, 'Create your private space'),
        h('p', { class: 'muted' }, 'Everything stays in your browser, encrypted with your password. No account, no tracking.'),
        card);
      const root2 = h('div', { class: 'lp' }, nav, hero, typeMarquee(), how, start,
        h('footer', { class: 'lp-foot muted' }, 'ShowUp · local-first, open source'));
      const targets = [...root2.querySelectorAll('[data-reveal]')];
      if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) targets.forEach((t) => t.classList.add('in'));
      else {
        const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.15 });
        requestAnimationFrame(() => targets.forEach((t) => io.observe(t)));
      }
      return root2;
    };

    /** @param {HTMLElement} card @param {string} title @param {string} sub @param {boolean} [front] show the full front page (new visitors only) */
    const frame = (card, title, sub, front = false) => {
      if (front) {
        setChildren(root, landing(card));
        root.scrollTop = 0;
        return;
      }
      setChildren(root, h('div', { class: 'auth-simple' },
        h('div', { class: 'auth-simple-top' }, mark(), h('span', { class: 'brand-name' }, 'ShowUp')),
        h('main', { class: 'auth-main', id: 'auth-main' }, h('p', { class: 'sr-only' }, `${title} ${sub}`), card)));
      queueMicrotask(() => /** @type {HTMLElement|null} */ (root.querySelector('input:not([type=hidden])'))?.focus());
    };

    // ---------- create account ----------
    function signUp() {
      const meter = h('div', { class: 'meter', id: 'auth-meter', 'data-score': '0', role: 'img', 'aria-label': 'Password strength' },
        h('i'), h('i'), h('i'), h('i'));
      const meterLabel = h('span', { class: 'meter-label', id: 'auth-meter-label', 'aria-live': 'polite' });
      const form = h('form', { class: 'auth-card', id: 'auth-form', novalidate: true, autocomplete: 'on' },
        header(),
        h('h1', { class: 'auth-title' }, 'Create your space'),
        h('p', { class: 'auth-lede' }, 'Your events stay on this device, encrypted with your password. No account is sent anywhere.'),
        field('auth-name', 'Your name', { type: 'text', autocomplete: 'name', maxlength: '60', required: true }),
        h('div', { class: 'field' },
          h('label', { for: 'auth-password' }, 'Password'),
          h('input', { id: 'auth-password', type: 'password', autocomplete: 'new-password', maxlength: '200', required: true, 'aria-describedby': 'auth-meter-label' }),
          h('div', { class: 'meter-row' }, meter, meterLabel),
          h('p', { class: 'field-error', id: 'auth-password-err', role: 'alert' })),
        field('auth-confirm', 'Confirm password', { type: 'password', autocomplete: 'new-password', maxlength: '200', required: true }),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'auth-keep' }), h('span', {}, 'Keep me signed in on this device for 30 days')),
        h('p', { class: 'auth-error', id: 'auth-error', role: 'alert' }),
        h('button', { class: 'btn btn-primary btn-block', type: 'submit', id: 'auth-submit' }, 'Create account'),
        h('p', { class: 'auth-fine' }, 'There is no password reset by email, because there is no server. Export a backup now and then.'));
      frame(form, 'Never miss the thing you signed up for.', 'Voice, screenshots and spreadsheets in. Calm reminders out.', true);

      const q = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
      q('auth-password').addEventListener('input', () => {
        const s = passwordStrength(q('auth-password').value);
        meter.dataset.score = String(s.score);
        meterLabel.textContent = s.label;
      });
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        ['auth-name', 'auth-password', 'auth-confirm'].forEach((i) => fieldError(i, ''));
        const name = q('auth-name').value;
        const pw = q('auth-password').value;
        if (pw !== q('auth-confirm').value) return fieldError('auth-confirm', 'The passwords do not match.');
        const btn = q('auth-submit');
        btn.setAttribute('disabled', '');
        btn.textContent = 'Creating…';
        const r = await auth.signUp(name, pw, { keep: q('auth-keep').checked });
        if (!r.ok) {
          btn.removeAttribute('disabled');
          btn.textContent = 'Create account';
          if (r.errors.name) fieldError('auth-name', r.errors.name);
          if (r.errors.password) fieldError('auth-password', r.errors.password);
          if (r.errors.form) { const e = document.getElementById('auth-error'); if (e) e.textContent = r.errors.form; }
          return;
        }
        finish({ key: r.key, profile: r.profile });
      });
    }

    // ---------- sign in ----------
    /** @param {import('../app/auth.js').Profile} profile */
    function signIn(profile) {
      const first = profile.name.split(' ')[0];
      const form = h('form', { class: 'auth-card', id: 'auth-form', novalidate: true },
        header(),
        h('h1', { class: 'auth-title' }, `Welcome back, ${first}`),
        h('p', { class: 'auth-lede' }, 'Enter your password to unlock your events.'),
        h('input', { type: 'text', name: 'username', autocomplete: 'username', value: profile.name, class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' }),
        field('auth-password', 'Password', { type: 'password', autocomplete: 'current-password', maxlength: '200', required: true }),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'auth-keep' }), h('span', {}, 'Keep me signed in on this device for 30 days')),
        h('p', { class: 'auth-error', id: 'auth-error', role: 'alert' }),
        h('button', { class: 'btn btn-primary btn-block', type: 'submit', id: 'auth-submit' }, 'Unlock'),
        h('button', { class: 'linklike', type: 'button', id: 'auth-forgot' }, 'Forgot your password?'));
      frame(form, 'Your events are safe here.', 'Encrypted on this device. Only your password opens them.');

      const q = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
      const errEl = () => /** @type {HTMLElement} */ (document.getElementById('auth-error'));
      /** @type {ReturnType<typeof setInterval>|undefined} */
      let timer;
      const stopTimer = () => {
        if (timer) clearInterval(timer);
        timer = undefined;
      };
      /** @param {number} waitMs */
      const countdown = (waitMs) => {
        stopTimer();
        const until = Date.now() + waitMs;
        q('auth-submit').setAttribute('disabled', '');
        const tick = () => {
          const left = Math.ceil((until - Date.now()) / 1000);
          if (left <= 0) {
            stopTimer();
            errEl().textContent = '';
            q('auth-submit').removeAttribute('disabled');
            q('auth-password').focus();
            return;
          }
          const m = Math.floor(left / 60);
          errEl().textContent = `Too many attempts. Try again in ${m ? `${m}m ` : ''}${left % 60}s.`;
        };
        tick();
        timer = setInterval(tick, 500);
      };
      if (profile.lockedUntil > Date.now()) countdown(profile.lockedUntil - Date.now());

      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        fieldError('auth-password', '');
        errEl().textContent = '';
        const btn = q('auth-submit');
        if (btn.hasAttribute('disabled')) return;
        btn.setAttribute('disabled', '');
        btn.textContent = 'Unlocking…';
        const r = await auth.signIn(q('auth-password').value, { keep: q('auth-keep').checked });
        btn.textContent = 'Unlock';
        if (r.ok) {
          stopTimer();
          return finish({ key: r.key, profile: r.profile });
        }
        q('auth-password').value = '';
        form.classList.remove('shake');
        void form.offsetWidth; // restart the animation
        form.classList.add('shake');
        if (r.reason === 'locked') return countdown(r.waitMs ?? 30_000);
        btn.removeAttribute('disabled');
        const left = r.attemptsLeft ?? FREE_ATTEMPTS;
        fieldError('auth-password', `That password is not right. ${left} ${left === 1 ? 'try' : 'tries'} left before a short wait.`);
        q('auth-password').focus();
      });

      q('auth-forgot').addEventListener('click', () => {
        stopTimer();
        forgot(profile);
      });
    }

    // ---------- forgot password ----------
    /** @param {import('../app/auth.js').Profile} profile */
    function forgot(profile) {
      const card = h('form', { class: 'auth-card', id: 'forgot-form', novalidate: true },
        header(),
        h('h1', { class: 'auth-title' }, 'Reset this device'),
        h('p', { class: 'auth-lede' }, 'Your events are encrypted with your password, and ShowUp has no copy of it, so they cannot be recovered without it.'),
        h('p', { class: 'auth-lede' }, 'You can erase this device and start fresh, then restore from a backup file or re-import your spreadsheet.'),
        field('forgot-confirm', 'Type ERASE to confirm', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' }),
        h('button', { class: 'btn btn-danger btn-block', type: 'submit', id: 'forgot-submit' }, 'Erase everything and start over'),
        h('button', { class: 'linklike', type: 'button', id: 'forgot-back' }, 'Back to sign in'));
      frame(card, 'Locked out?', 'You are in control of your data, including when to let it go.');
      document.getElementById('forgot-back')?.addEventListener('click', () => signIn(profile));
      card.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const input = /** @type {HTMLInputElement} */ (document.getElementById('forgot-confirm'));
        if (input.value.trim().toUpperCase() !== 'ERASE') return fieldError('forgot-confirm', 'Type ERASE exactly to continue.');
        await hooks.onErase();
        await auth.reset();
        signUp();
      });
    }
  });
}
