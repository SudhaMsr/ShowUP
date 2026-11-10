// @ts-check
/* Front-page 3D hero: four deadline cards floating in a navy room with gold sparks.
 * Three.js (MIT, vendored in /vendor) is loaded lazily. If WebGL, the module or motion
 * preferences stand in the way, the pure-CSS cards stay as they are. */

const NAVY = 0x0d1531;
const GOLD = 0xf5c542;

/** @param {HTMLCanvasElement} c @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r */
function roundRect(c, x, y, w, h, r) {
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  return g;
}

/** @param {string[]} t [tag, title, due, stage] @param {string} tagBg @param {string} tagFg */
function cardCanvas(t, tagBg, tagFg) {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 400;
  const g = roundRect(c, 4, 4, 632, 392, 36);
  g.fillStyle = '#14224a'; g.fill();
  g.lineWidth = 3; g.strokeStyle = 'rgba(245,197,66,.45)'; g.stroke();
  const font = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
  g.font = `700 30px ${font}`;
  const tw = g.measureText(t[0]).width + 44;
  roundRect(c, 40, 40, tw, 52, 26); g.fillStyle = tagBg; g.fill();
  g.fillStyle = tagFg; g.textBaseline = 'middle'; g.fillText(t[0], 62, 67);
  g.fillStyle = '#ffffff'; g.font = `800 52px ${font}`; g.textBaseline = 'alphabetic'; g.fillText(t[1], 40, 190);
  g.fillStyle = '#c7d0ee'; g.font = `500 34px ${font}`; g.fillText(t[2], 40, 250);
  g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(40, 292, 560, 2);
  g.fillStyle = '#f5c542'; g.font = `700 30px ${font}`; g.fillText(t[3], 40, 350);
  return c;
}

/**
 * @param {HTMLElement} host element the canvas is placed in (the CSS card scene)
 * @returns {Promise<(() => void) | null>} cleanup, or null when the 3D scene could not start
 */
export async function mountHero3d(host) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return null;
  /** @type {any} */
  let T;
  try {
    T = await import(new URL('../../vendor/three.module.min.js', import.meta.url).href);
  } catch { return null; }

  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setClearColor(NAVY, 0);
  const el = renderer.domElement;
  el.className = 'lp-gl';
  el.setAttribute('aria-hidden', 'true');
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(36, 1, 0.1, 50);
  camera.position.set(0, -0.2, 7.2);
  const rig = new T.Group();
  scene.add(rig);

  const specs = [
    [['Internship', 'Summer placement', 'Due in 3 days', 'Working'], '#ffd88a', '#5a3a00', [-3.1, -0.2, 0.2], 0.34, 0.05],
    [['Scholarship', 'Merit award', 'Due tomorrow', 'Ready to submit'], '#bff0d6', '#0b5d3b', [0, 0.5, 0.5], 0, -0.03],
    [['Hackathon', 'Weekend build', 'Closes Friday', 'Found'], '#e2d6ff', '#3d2391', [3.1, -0.1, 0.1], -0.34, -0.05],
    [['Exam', 'Algorithms final', '12 days to go', '5 of 11 topics'], '#ffd0d0', '#8f1d1d', [0.35, -1.25, 0.7], 0.1, 0.03],
  ];
  const geo = new T.PlaneGeometry(2.4, 1.5);
  /** @type {{ m: any, y: number, ph: number, x: number, z: number, ry: number, rz: number, delay: number, lift: number, spin: number }[]} */
  const cards = [];
  /** @type {any[]} */
  const textures = [];
  for (const [t, bg, fg, pos, ry, rz] of specs) {
    const tex = new T.CanvasTexture(cardCanvas(/** @type {string[]} */ (t), /** @type {string} */ (bg), /** @type {string} */ (fg)));
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 4;
    textures.push(tex);
    const m = new T.Mesh(geo, new T.MeshBasicMaterial({ map: tex, transparent: true, side: T.DoubleSide }));
    const p = /** @type {number[]} */ (pos);
    m.position.set(p[0], p[1], p[2]);
    m.rotation.set(0, /** @type {number} */ (ry), /** @type {number} */ (rz));
    rig.add(m);
    cards.push({ m, y: p[1], ph: Math.random() * 6, x: p[0], z: p[2], ry: /** @type {number} */ (ry), rz: /** @type {number} */ (rz), delay: cards.length * 0.18, lift: 0, spin: 0 });
  }

  // Slow gold rings behind the cards give the scene depth.
  const rings = [2.5, 3.1].map((r, i) => {
    const m = new T.Mesh(new T.RingGeometry(r, r + 0.018, 128), new T.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.22 - i * 0.08, depthWrite: false }));
    m.position.z = -2 - i;
    rig.add(m);
    return m;
  });

  // Gold sparks drifting upward.
  const N = 140;
  const pos = new Float32Array(N * 3);
  const spd = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 12;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 6;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 4 - 1;
    spd[i] = 0.2 + Math.random() * 0.5;
  }
  const pg = new T.BufferGeometry();
  pg.setAttribute('position', new T.BufferAttribute(pos, 3));
  const pm = new T.PointsMaterial({ color: GOLD, size: 0.05, transparent: true, opacity: 0.8, depthWrite: false });
  const sparks = new T.Points(pg, pm);
  scene.add(sparks);

  host.append(el);
  host.classList.add('lp-gl-on');

  const size = () => {
    const w = host.clientWidth || 800, h = host.clientHeight || 330;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < 600 ? 52 : 36;
    camera.updateProjectionMatrix();
  };
  size();
  const ro = new ResizeObserver(size);
  ro.observe(host);

  let tx = 0, ty = 0, rx = 0, ry = 0;
  const move = (/** @type {PointerEvent} */ ev) => {
    const r = host.getBoundingClientRect();
    pick(ev);
    tx = ((ev.clientX - r.left) / r.width - 0.5) * 2;
    ty = ((ev.clientY - r.top) / r.height - 0.5) * 2;
  };
  const ray = new T.Raycaster();
  const ndc = new T.Vector2();
  /** @type {any} */
  let hovered = null;
  const pick = (/** @type {PointerEvent} */ ev) => {
    const r = el.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(cards.map((c) => c.m))[0];
    hovered = hit ? cards.find((c) => c.m === hit.object) : null;
    el.style.cursor = hovered ? 'pointer' : '';
  };
  const click = () => { if (hovered && hovered.spin === 0) hovered.spin = 0.0001; };
  const leave = () => { tx = 0; ty = 0; hovered = null; el.style.cursor = ''; };
  if (matchMedia('(pointer: fine)').matches) {
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', leave);
    el.addEventListener('click', click);
  }

  let visible = true, raf = 0, last = performance.now(), t0 = 0;
  const frame = (/** @type {number} */ now) => {
    raf = 0;
    if (!visible || document.hidden) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now; t0 += dt;
    rx += (ty * 0.12 - rx) * 0.08;
    ry += (tx * 0.22 - ry) * 0.08;
    rig.rotation.x = rx; rig.rotation.y = ry;
    const sc = Math.min(Math.max(-host.getBoundingClientRect().top / 600 + 0.5, -1), 1);
    rig.position.y += (sc * 0.15 - rig.position.y) * 0.06;
    rings.forEach((m, i) => { m.rotation.z = t0 * (i ? -0.05 : 0.07); m.rotation.x = 0.35 + ry * 0.5; });
    for (const c of cards) {
      const k = Math.min(Math.max((t0 - 0.2 - c.delay) / 1.1, 0), 1);
      const e = 1 - Math.pow(1 - k, 4); // ease-out quart
      c.lift += ((c === hovered ? 1 : 0) - c.lift) * 0.12;
      if (c.spin > 0) { c.spin += dt * 1.6; if (c.spin >= 1) c.spin = 0; }
      const spinE = c.spin > 0 ? 1 - Math.pow(1 - c.spin, 3) : 0;
      c.m.position.set(c.x * (0.4 + 0.6 * e), c.y + (1 - e) * -2.4 + Math.sin(t0 * 0.9 + c.ph) * 0.12 + c.lift * 0.15, c.z + (1 - e) * -3 + c.lift * 0.5);
      c.m.rotation.set(c.lift * -0.06, c.ry + (1 - e) * 1.2 + spinE * Math.PI * 2, c.rz);
      c.m.material.opacity = e;
      const s2 = 1 + c.lift * 0.06;
      c.m.scale.set(s2, s2, 1);
    }
    const a = pg.attributes.position;
    for (let i = 0; i < N; i++) {
      let y = a.getY(i) + spd[i] * dt * 0.5;
      if (y > 3) y = -3;
      a.setY(i, y);
    }
    a.needsUpdate = true;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  const kick = () => { if (!raf && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const io = new IntersectionObserver((es) => { visible = Boolean(es[0]?.isIntersecting); kick(); });
  io.observe(host);
  document.addEventListener('visibilitychange', kick);
  kick();

  return () => {
    cancelAnimationFrame(raf); io.disconnect(); ro.disconnect();
    document.removeEventListener('visibilitychange', kick);
    host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave); el.removeEventListener('click', click);
    geo.dispose(); pg.dispose(); pm.dispose(); textures.forEach((x) => x.dispose());
    for (const c of cards) c.m.material.dispose();
    for (const m of rings) { m.geometry.dispose(); m.material.dispose(); }
    renderer.dispose(); el.remove(); host.classList.remove('lp-gl-on');
  };
}
