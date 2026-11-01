// @ts-check
/** Small motion helpers. Everything here is a no-op under prefers-reduced-motion. */

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A short confetti burst on a canvas that removes itself. Used when an event is marked attended.
 * @param {{ x?: number, y?: number }} [origin]  viewport pixels; defaults to the middle
 */
export function confetti(origin = {}) {
  if (reducedMotion()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas.remove();
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const palette = [css.getPropertyValue('--accent'), css.getPropertyValue('--teal'), '#f5b700', css.getPropertyValue('--ink')].map((c) => c.trim() || '#e5532d');
  const ox = origin.x ?? innerWidth / 2;
  const oy = origin.y ?? innerHeight * 0.4;
  const parts = Array.from({ length: 70 }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
    const v = 6 + Math.random() * 8;
    return { x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: 5 + Math.random() * 6, h: 3 + Math.random() * 4, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: palette[(Math.random() * palette.length) | 0] };
  });
  const start = performance.now();
  const step = (/** @type {number} */ now) => {
    const age = now - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.28;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - age / 1800);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (age < 1800) requestAnimationFrame(step);
    else canvas.remove();
  };
  requestAnimationFrame(step);
}

/**
 * Count a number up to its value. The final text is set immediately for assistive tech.
 * @param {HTMLElement} el @param {number} to @param {number} [ms]
 */
export function countUp(el, to, ms = 700) {
  el.textContent = String(to);
  if (reducedMotion() || to <= 0) return;
  const start = performance.now();
  const step = (/** @type {number} */ now) => {
    const k = Math.min(1, (now - start) / ms);
    el.textContent = String(Math.round(to * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
