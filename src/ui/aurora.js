// @ts-check
/**
 * A flowing gradient drawn by a small fragment shader (WebGL, no library).
 * Falls back silently to the CSS background when WebGL is unavailable, pauses
 * while the tab is hidden, and renders one still frame for reduced motion.
 */

const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const FRAG = `precision mediump float;
uniform vec2 r;uniform float t;uniform vec3 a;uniform vec3 b;uniform vec3 c;
float blob(vec2 uv, vec2 c0, float s){return smoothstep(s,0.,length(uv-c0));}
void main(){
  vec2 uv=gl_FragCoord.xy/r;
  float asp=r.x/r.y; vec2 q=vec2(uv.x*asp,uv.y);
  float k=t*.12;
  vec3 col=mix(c, c*.55, uv.y);
  col+=a*blob(q,vec2(asp*(.3+.25*sin(k*1.3)),.35+.25*cos(k*1.1)),.75)*.9;
  col+=b*blob(q,vec2(asp*(.7+.2*cos(k*.9)),.65+.2*sin(k*1.4)),.7)*.85;
  col+=a*blob(q,vec2(asp*(.5+.3*sin(k*.7+2.)),.2+.15*cos(k*1.7)),.5)*.45;
  float g=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
  col+=(g-.5)*.03;
  gl_FragColor=vec4(col,1.);
}`;

/** @param {string} hex */
function rgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ colors?: [string,string,string] }} [o]  accent, second, base
 * @returns {() => void} stop
 */
export function startAurora(canvas, o = {}) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) return () => {};
  const compile = (/** @type {number} */ type, /** @type {string} */ src) => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return () => {};
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return () => {};
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const [ca, cb, cc] = o.colors ?? ['#e5532d', '#0f766e', '#16181d'];
  const u = (/** @type {string} */ n) => gl.getUniformLocation(prog, n);
  gl.uniform3fv(u('a'), rgb(ca).map((v) => v * 0.9));
  gl.uniform3fv(u('b'), rgb(cb).map((v) => v * 0.9));
  gl.uniform3fv(u('c'), rgb(cc));
  const uR = u('r');
  const uT = u('t');

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr * 0.6));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr * 0.6));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uR, w, h);
  };

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  let stopped = false;
  const t0 = performance.now();
  const frame = (/** @type {number} */ now) => {
    if (stopped) return;
    resize();
    gl.uniform1f(uT, reduced ? 4 : (now - t0) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!reduced && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const onVis = () => {
    if (!document.hidden && !reduced && !stopped) {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    }
  };
  document.addEventListener('visibilitychange', onVis);
  canvas.classList.add('aurora-on');
  raf = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', onVis);
  };
}
