/* Horizon kit 1.0.1 · window.Horizon
   The Luma poster's ordered dither as a living horizon.
   Classic script: no modules, no network, no inline styles needed. Works from file:// and in a VS Code webview. */
(function () {
  'use strict';

  var VERSION = '1.0.1';
  var params = new URLSearchParams(location.search);
  var mql = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var root = document.documentElement;

  function motionAllowed() { return params.get('motion') !== 'off' && !(mql && mql.matches); }
  var MANUAL = params.get('clock') === 'manual';
  if (params.get('embed') === '1') root.classList.add('hz-embed');
  root.classList.add(motionAllowed() ? 'hz-motion' : 'hz-still');

  function qnum(name) { var v = parseFloat(params.get(name)); return isNaN(v) ? null : v; }
  // Knobs from the URL override every instance, so Eli can tune live: ?speed=0.8&intensity=1.2&swell=1.3&moments=25
  var URLK = { speed: qnum('speed'), intensity: qnum('intensity'), swell: qnum('swell'), moments: qnum('moments'), seed: qnum('seed'), level: qnum('level'), tilt: qnum('tilt') };

  var DEFAULTS = {
    level: 0.32,        // band height, 0 to 1 of the host
    tilt: 0.55,         // -1 to 1; positive rises to the right
    curve: 1.6,         // how late the band climbs toward its high side
    cell: 7,            // cell size in CSS px
    intro: 'rise',      // 'rise' or 'none'
    ambient: false,     // continuous swell (hero, title, welcome only)
    interactive: false, // pointer lifts a local swell
    seed: 7,
    maxDpr: 2,
    edge: 'bottom',     // 'bottom' or 'top' (a strip that hangs from the top)
    speed: 1,           // ambient tempo
    intensity: 1,       // shimmer, condensing cells and crest light
    swell: 1,           // swell height
    moments: 30,        // mean seconds between bigger moments; 0 turns them off
    glow: 0.6,          // corner light on the high side
    scrollLift: 0,      // level rises by this fraction as the host scrolls away
    renderer: 'auto',   // 'auto', 'webgl' or '2d'
    condense: null,     // element, selector or list; defaults to [data-hz-condense] inside the host
    onIntroEnd: null
  };

  var IMAX = 2.6, BYTE1 = 255 / IMAX;
  var DEFAULT_RAMP = ['#124874', '#1b6b9e', '#2390b9', '#34abbd', '#4fc4d0', '#7ae1e3', '#89eaeb', '#c4f5f3'];
  var STOPS = [0, 0.22, 0.5, 0.8, 1.1, 1.4, 1.75, 2.3];

  // ---------- math ----------
  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function smooth(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  function smoothstep(a, b, x) { return smooth((x - a) / (b - a)); }
  var EASE = {
    linear: function (t) { return t; },
    in: function (t) { return t * t * t; },
    out: function (t) { return 1 - Math.pow(1 - t, 3); },
    inOut: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    expoOut: function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }
  };
  function easing(e) { return typeof e === 'function' ? e : (EASE[e] || EASE.inOut); }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function makeNoise(seed) {
    var rnd = mulberry32((seed * 2654435761) >>> 0), perm = new Uint16Array(512), vals = new Float32Array(256), i;
    for (i = 0; i < 256; i++) { perm[i] = i; vals[i] = rnd(); }
    for (i = 255; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), s = perm[i]; perm[i] = perm[j]; perm[j] = s; }
    for (i = 0; i < 256; i++) perm[i + 256] = perm[i];
    return function (x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      var X = xi & 255, Y = yi & 255;
      var a = vals[perm[perm[X] + Y]], b = vals[perm[perm[X + 1] + Y]];
      var c = vals[perm[perm[X] + Y + 1]], d = vals[perm[perm[X + 1] + Y + 1]];
      var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      var top = a + (b - a) * u;
      return top + (c + (d - c) * u - top) * v;
    };
  }
  function hash3(x, y, z) {
    var h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // Bayer 8x8, generated recursively; thresholds in (0, 1)
  var BAYER = (function () {
    var m = [[0]];
    for (var n = 1; n < 8; n *= 2) {
      var size = n * 2, next = [];
      for (var y = 0; y < size; y++) {
        next.push([]);
        for (var x = 0; x < size; x++) next[y].push(m[y % n][x % n] * 4 + [0, 2, 3, 1][(y < n ? 0 : 2) + (x < n ? 0 : 1)]);
      }
      m = next;
    }
    var bytes = new Uint8Array(64), thr = new Float32Array(64);
    for (var i = 0; i < 64; i++) {
      bytes[i] = Math.round((m[i >> 3][i & 7] + 0.5) / 64 * 255);
      thr[i] = bytes[i] / 255 * BYTE1; // threshold in field-byte units
    }
    return { bytes: bytes, thr: thr };
  })();

  function parseColor(s, fb) {
    s = (s || '').trim();
    var m = /^#([0-9a-f]{6})$/i.exec(s);
    if (!m) { m = /^#([0-9a-f]{3})$/i.exec(s); if (m) s = '#' + m[1][0] + m[1][0] + m[1][1] + m[1][1] + m[1][2] + m[1][2]; else return fb ? parseColor(fb) : [0, 0, 0]; }
    return [parseInt(s.substr(1, 2), 16), parseInt(s.substr(3, 2), 16), parseInt(s.substr(5, 2), 16)];
  }
  function readRamp() {
    var cs = getComputedStyle(root), out = [];
    for (var i = 0; i < 8; i++) out.push(parseColor(cs.getPropertyValue('--hz-ramp-' + i), DEFAULT_RAMP[i]));
    return out;
  }
  function rampAt(ramp, T, out) {
    if (T <= STOPS[0]) { out[0] = ramp[0][0]; out[1] = ramp[0][1]; out[2] = ramp[0][2]; return out; }
    for (var i = 1; i < 8; i++) {
      if (T <= STOPS[i]) {
        var a = ramp[i - 1], b = ramp[i], f = (T - STOPS[i - 1]) / (STOPS[i] - STOPS[i - 1]);
        out[0] = a[0] + (b[0] - a[0]) * f; out[1] = a[1] + (b[1] - a[1]) * f; out[2] = a[2] + (b[2] - a[2]) * f;
        return out;
      }
    }
    out[0] = ramp[7][0]; out[1] = ramp[7][1]; out[2] = ramp[7][2]; return out;
  }

  // ---------- the field ----------
  // Writes one RGBA texel per cell: r = density (dither input), g = tone (color), a = 255 where lit.
  function computeField(S, data) {
    var cols = S.cols, rows = S.rows, H = S.H, cell = S.cellCss, n = S.noise, t = S.t;
    var tilt = S.tilt, at = Math.min(1, Math.abs(tilt));
    if (!S.hc || S.hc.length !== cols) { S.hc = new Float32Array(cols); S.lc = new Float32Array(cols); }
    var hc = S.hc, lc = S.lc, c, u, uh, h, L;
    var shape = S.shape, sw = S.swell * shape, inten = S.intensity;
    var maxH = 1;
    for (c = 0; c < cols; c++) {
      u = (c + 0.5) / cols; uh = tilt >= 0 ? u : 1 - u;
      h = H * S.level * (1 - at + at * (S.curve + 1) * Math.pow(uh, S.curve));
      if (sw > 0) {
        var s = (n(u * 1.7 + t * 0.040, 3.1 + t * 0.017) - 0.5) * 1.24
          + (n(u * 4.1 - t * 0.075, 11.7 + t * 0.031) - 0.5) * 0.56
          + (n(u * 9.7 + t * 0.16, 23.3 + t * 0.07) - 0.5) * 0.2;
        h += s * H * 0.075 * sw * Math.min(1, S.level * 3.2);
      }
      L = 0;
      var mo = S.moment;
      if (mo) {
        var env = Math.sin(Math.PI * clamp01(mo.p));
        if (mo.type === 'wave') {
          var uc = mo.dir > 0 ? -0.25 + 1.5 * mo.p : 1.25 - 1.5 * mo.p;
          var dw = (u - uc) / 0.085, gw = Math.exp(-dw * dw);
          h += H * 0.032 * gw * env * Math.min(1, S.level * 3); L += 1.15 * gw * env;
        } else {
          h *= 1 + 0.15 * env * env; L += 0.3 * env * env;
        }
      }
      if (S.bumpA > 0.002) {
        var db = (u - S.bumpU) / 0.07, gb = Math.exp(-db * db);
        h += H * 0.075 * S.bumpA * gb; L += 0.45 * S.bumpA * gb;
      }
      if (shape > 0 && inten > 0) {
        var ln = n(u * 2.3 - t * 0.06, 41.3 + t * 0.022);
        ln = ln > 0.52 ? (ln - 0.52) / 0.48 : 0;
        L += ln * ln * 1.1 * inten * shape;
      }
      if (S.rise < 1) {
        var rv = smooth((uh - (1 - 1.9 * S.rise)) / 0.75);
        h *= rv * (0.25 + 0.75 * EASE.out(S.rise));
      }
      if (h < 0) h = 0;
      hc[c] = h; lc[c] = L;
      if (h > maxH) maxH = h;
    }
    data.fill(0);
    var glow = S.glow * S.riseE, fr = 0.5 * inten * shape, shim = 0.14 * inten * shape * S.live;
    var tf = t * 0.7, kf = Math.floor(tf), ff = smooth(tf - kf);
    var top = S.edge === 'top';
    for (c = 0; c < cols; c++) {
      h = hc[c]; L = lc[c];
      u = (c + 0.5) / cols; uh = tilt >= 0 ? u : 1 - u;
      var gx = (1 - uh) * (1 - uh) * 5, inv = 1 / Math.max(h, 1);
      for (var i = 0; i < rows; i++) {
        var yb = (i + 0.5) * cell;
        var depth = 1 - yb * inv;
        if (depth < -0.7) break;
        var I = depth * 1.75;
        if (glow > 0) { var gy = yb / maxH; I += glow * Math.exp(-(gx + gy * gy * 2.2)); }
        if (fr > 0 && depth > -0.45 && depth < 0.85) {
          var wn = depth - 0.15;
          I += (n(c * 0.11 + t * 0.06, i * 0.11 - t * 0.035 + 57.0) - 0.5) * fr * Math.exp(-wn * wn / 0.09);
        }
        if (shim > 0 && depth > -0.3 && depth < 0.5) {
          var ws = (depth - 0.08) / 0.15, h0 = hash3(c, i, kf), h1 = hash3(c, i, kf + 1);
          I += (h0 + (h1 - h0) * ff - 0.5) * shim * Math.exp(-ws * ws);
        }
        if (I <= 0) continue;
        var dl = depth - 0.12;
        var T = I + L * Math.exp(-dl * dl / 0.07) * 0.9;
        var r = top ? i : rows - 1 - i;
        var o = (r * cols + c) * 4;
        var ib = I * BYTE1 + 0.5, tb = T * BYTE1 + 0.5;
        data[o] = ib > 255 ? 255 : ib; data[o + 1] = tb > 255 ? 255 : tb; data[o + 3] = 255;
      }
    }
  }

  // ---------- renderers ----------
  function Renderer2D(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.low = document.createElement('canvas'); this.lctx = this.low.getContext('2d');
    this.kind = '2d';
  }
  Renderer2D.prototype.render = function (F) {
    var ctx = this.ctx, cv = this.canvas, cols = F.cols, rows = F.rows, cp = F.cellPx, d = F.data, ramp = F.ramp;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    var NB = 64, paths = new Array(NB), thr = BAYER.thr, one = BYTE1, r, c, o;
    for (r = 0; r < rows; r++) {
      var y0 = Math.round(r * cp), y1 = Math.round((r + 1) * cp), rb = (r & 7) << 3;
      for (c = 0; c < cols; c++) {
        o = (r * cols + c) * 4;
        var ib = d[o];
        if (!ib) continue;
        if (ib < one && ib < thr[rb + (c & 7)]) continue;
        var b = d[o + 1] >> 2;
        var x0 = Math.round(c * cp);
        (paths[b] || (paths[b] = new Path2D())).rect(x0, y0, Math.round((c + 1) * cp) - x0, y1 - y0);
      }
    }
    var col = [0, 0, 0];
    for (var k = 0; k < NB; k++) {
      if (!paths[k]) continue;
      rampAt(ramp, (k * 4 + 2) / BYTE1, col);
      ctx.fillStyle = 'rgb(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ')';
      ctx.fill(paths[k]);
    }
    if (this.low.width !== cols || this.low.height !== rows) { this.low.width = cols; this.low.height = rows; this.img = null; }
    if (!this.img) this.img = this.lctx.createImageData(cols, rows);
    var px = this.img.data, any = false;
    for (o = 0; o < d.length; o += 4) {
      var I = d[o] / BYTE1, a = I > 0.92 ? smoothstep(0.92, 1.42, I) : 0;
      if (a <= 0) { px[o + 3] = 0; continue; }
      rampAt(ramp, d[o + 1] / BYTE1, col);
      px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = a * 255; any = true;
    }
    if (any) {
      this.lctx.putImageData(this.img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      ctx.drawImage(this.low, 0, 0, cols * cp, rows * cp);
    }
  };
  Renderer2D.prototype.destroy = function () {};

  var VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  var FS = [
    'precision highp float;',
    'uniform sampler2D uN;uniform sampler2D uL;uniform sampler2D uB;',
    'uniform vec2 uGrid;uniform vec2 uRes;uniform float uCell;uniform float uIMax;',
    'uniform vec3 uC[8];uniform float uS[8];',
    'vec3 ramp(float t){vec3 c=uC[0];for(int i=1;i<8;i++){c=mix(c,uC[i],clamp((t-uS[i-1])/(uS[i]-uS[i-1]),0.,1.));}return c;}',
    'void main(){',
    ' vec2 q=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);',
    ' vec2 cell=floor(q/uCell);',
    ' vec4 f=texture2D(uN,(cell+.5)/uGrid);',
    ' float I=f.r*uIMax;',
    ' float th=texture2D(uB,(mod(cell,8.)+.5)/8.).r*uIMax/uIMax;',
    ' float lit=(f.r>0.)&&(I>=1.||I>=th)?1.:0.;',
    ' vec4 s=texture2D(uL,q/uCell/uGrid);',
    ' float a=smoothstep(.92,1.42,s.r*uIMax);',
    ' vec3 cc=ramp(f.g*uIMax)/255.;vec3 sc=ramp(s.g*uIMax)/255.;',
    ' gl_FragColor=vec4(sc*a+cc*lit*(1.-a),a+lit*(1.-a));',
    '}'
  ].join('\n');

  function RendererGL(canvas) {
    var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no webgl');
    this.gl = gl; this.canvas = canvas; this.kind = 'webgl';
    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    var pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('link');
    gl.useProgram(pr);
    this.pr = pr;
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    function tex(filter) {
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    this.tN = tex(gl.NEAREST); this.tL = tex(gl.LINEAR);
    this.tB = tex(gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 8, 8, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, BAYER.bytes);
    this.u = {};
    var names = ['uN', 'uL', 'uB', 'uGrid', 'uRes', 'uCell', 'uIMax', 'uC', 'uS'];
    for (var i = 0; i < names.length; i++) this.u[names[i]] = gl.getUniformLocation(pr, names[i]);
    gl.uniform1i(this.u.uN, 0); gl.uniform1i(this.u.uL, 1); gl.uniform1i(this.u.uB, 2);
    gl.uniform1f(this.u.uIMax, IMAX);
    gl.uniform1fv(this.u.uS, new Float32Array(STOPS));
    this.size = [0, 0];
    this.rampKey = '';
  }
  RendererGL.prototype.render = function (F) {
    var gl = this.gl, cv = this.canvas;
    if (gl.isContextLost()) throw new Error('context lost');
    gl.viewport(0, 0, cv.width, cv.height);
    var key = F.ramp.join('|');
    if (key !== this.rampKey) {
      var flat = new Float32Array(24);
      for (var i = 0; i < 8; i++) { flat[i * 3] = F.ramp[i][0]; flat[i * 3 + 1] = F.ramp[i][1]; flat[i * 3 + 2] = F.ramp[i][2]; }
      gl.uniform3fv(this.u.uC, flat); this.rampKey = key;
    }
    var fresh = this.size[0] !== F.cols || this.size[1] !== F.rows;
    var units = [this.tN, this.tL];
    for (var k = 0; k < 2; k++) {
      gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, units[k]);
      if (fresh) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, F.cols, F.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, F.data);
      else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, F.cols, F.rows, gl.RGBA, gl.UNSIGNED_BYTE, F.data);
    }
    this.size = [F.cols, F.rows];
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.tB);
    gl.uniform2f(this.u.uGrid, F.cols, F.rows);
    gl.uniform2f(this.u.uRes, cv.width, cv.height);
    gl.uniform1f(this.u.uCell, F.cellPx);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  RendererGL.prototype.destroy = function () { var e = this.gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); };

  function makeRenderer(canvas, pref) {
    if (pref !== '2d' && params.get('gl') !== '0') {
      try { return new RendererGL(canvas); } catch (e) { /* fall back to 2D */ }
    }
    return new Renderer2D(canvas);
  }

  // ---------- scheduler ----------
  var instances = [], rafId = 0, lastNow = 0, clockNow = 0;
  var stats = { frames: 0, total: 0, max: 0 };
  function now() { return MANUAL ? clockNow : performance.now(); }
  function wake() {
    if (MANUAL || rafId) return;
    lastNow = -1;
    rafId = requestAnimationFrame(loop);
  }
  function step(dtMs) {
    var dt = Math.max(0, Math.min(dtMs, 64)) / 1000, busy = false;
    for (var i = 0; i < instances.length; i++) {
      var inst = instances[i];
      if (inst._active()) { var t0 = performance.now(); inst._frame(dt); var ms = performance.now() - t0; stats.frames++; stats.total += ms; if (ms > stats.max) stats.max = ms; busy = true; }
    }
    return busy;
  }
  function loop(ts) {
    rafId = 0;
    var dt = lastNow < 0 ? 16.7 : ts - lastNow; lastNow = ts;
    if (dt < 0) dt = 0;
    if (step(dt)) rafId = requestAnimationFrame(loop);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) wake(); });

  // ---------- reveals and the condensing headline ----------
  function revealEls(host) { return Array.prototype.slice.call(host.querySelectorAll('[data-hz-reveal]')); }
  function setRevealStyle(el, p) {
    var e = EASE.out(p);
    el.style.opacity = String(e);
    el.style.transform = e >= 1 ? '' : 'translateY(' + ((1 - e) * 12).toFixed(2) + 'px)';
  }
  function finishReveal(el) { el.style.opacity = ''; el.style.transform = ''; el.classList.add('hz-in'); }

  function Condenser(el, ground, accent) {
    this.el = el;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    var cv = document.createElement('canvas');
    cv.className = 'hz-condense';
    cv.setAttribute('aria-hidden', 'true');
    el.appendChild(cv);
    this.cv = cv; this.ctx = cv.getContext('2d');
    this.ground = ground; this.accent = accent;
    this.ink = parseColor(rgbToHex(getComputedStyle(el).color), '#0d1014');
  }
  function rgbToHex(s) {
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || '');
    if (!m) return s;
    return '#' + [m[1], m[2], m[3]].map(function (v) { return ('0' + (+v).toString(16)).slice(-2); }).join('');
  }
  Condenser.prototype.layout = function () {
    var el = this.el, r = el.getBoundingClientRect(), sc = el.offsetWidth ? r.width / el.offsetWidth : 1;
    var dpr = Math.min(window.devicePixelRatio || 1, 2), fs = parseFloat(getComputedStyle(el).fontSize) || 48;
    var cvp = this.cv.parentNode; if (cvp) cvp.removeChild(this.cv);
    var range = document.createRange(); range.selectNodeContents(el);
    var rects = range.getClientRects(), lines = [];
    if (cvp) el.appendChild(this.cv);
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (var i = 0; i < rects.length; i++) {
      var q = rects[i]; if (q.width < 1 || q.height < 1) continue;
      var x0 = (q.left - r.left) / sc, y0 = (q.top - r.top) / sc, x1 = (q.right - r.left) / sc, y1 = (q.bottom - r.top) / sc;
      var pad = (y1 - y0) * 0.08;
      var top = Math.max(y0 - pad, -2);
      lines.push([x0 - pad, top, x1 + pad, y1 + pad]);
      minX = Math.min(minX, x0 - pad); minY = Math.min(minY, top); maxX = Math.max(maxX, x1 + pad); maxY = Math.max(maxY, y1 + pad);
    }
    if (!lines.length) { minX = 0; minY = 0; maxX = el.offsetWidth; maxY = el.offsetHeight; lines.push([0, 0, maxX, maxY]); }
    this.box = [minX, minY, maxX, maxY];
    this.lines = lines;
    var cv = this.cv;
    cv.style.left = minX + 'px'; cv.style.top = minY + 'px';
    cv.style.width = (maxX - minX) + 'px'; cv.style.height = (maxY - minY) + 'px';
    this.px = sc * dpr;
    cv.width = Math.max(1, Math.round((maxX - minX) * this.px)); cv.height = Math.max(1, Math.round((maxY - minY) * this.px));
    this.cell = Math.max(3, Math.round(fs / 13));
  };
  // p: 0 hidden, 1 fully condensed
  Condenser.prototype.draw = function (p) {
    var ctx = this.ctx, cv = this.cv, g = this.ground;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    var m = p < 0.3 ? 4 : p < 0.55 ? 2 : 1;
    var cp = this.cell * m * this.px, open = smooth(p / 0.92);
    ctx.fillStyle = 'rgb(' + g[0] + ',' + g[1] + ',' + g[2] + ')';
    var bx = this.box[0], by = this.box[1];
    ctx.beginPath();
    for (var li = 0; li < this.lines.length; li++) {
      var L = this.lines[li];
      var c0 = Math.floor((L[0] - bx) * this.px / cp), c1 = Math.ceil((L[2] - bx) * this.px / cp);
      var r0 = Math.floor((L[1] - by) * this.px / cp), r1 = Math.ceil((L[3] - by) * this.px / cp);
      for (var r = r0; r < r1; r++) {
        for (var c = c0; c < c1; c++) {
          if (BAYER.bytes[((r & 7) << 3) + (c & 7)] / 255 < open) continue;
          var x0 = Math.round(c * cp), y0 = Math.round(r * cp);
          ctx.rect(x0, y0, Math.round((c + 1) * cp) - x0, Math.round((r + 1) * cp) - y0);
        }
      }
    }
    ctx.fill();
    var k = smoothstep(0.45, 1, p), a = this.accent, ink = this.ink;
    this.el.style.color = k >= 1 ? '' : 'rgb(' + Math.round(a[0] + (ink[0] - a[0]) * k) + ',' + Math.round(a[1] + (ink[1] - a[1]) * k) + ',' + Math.round(a[2] + (ink[2] - a[2]) * k) + ')';
  };
  Condenser.prototype.destroy = function () {
    if (this.cv.parentNode) this.cv.parentNode.removeChild(this.cv);
    this.el.style.color = '';
  };

  // ---------- instance ----------
  function Instance(host, opts) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in opts || {}) if (opts[k] !== undefined) o[k] = opts[k];
    for (k in URLK) if (URLK[k] !== null && (k !== 'level' && k !== 'tilt' || o.urlPosition)) o[k] = URLK[k];
    this.o = o;
    this.host = host;
    host.classList.add('hz-host');
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var cv = document.createElement('canvas');
    cv.className = 'hz-canvas';
    cv.setAttribute('aria-hidden', 'true');
    host.insertBefore(cv, host.firstChild);
    this.canvas = cv;
    this.renderer = makeRenderer(cv, o.renderer);
    this.kind = this.renderer.kind;
    this.noise = makeNoise(o.seed);
    this.rng = mulberry32((o.seed * 7919) >>> 0);
    this.motion = motionAllowed();
    this.S = {
      noise: this.noise, t: o.seed * 13.7, level: o.level, tilt: o.tilt, curve: o.curve, swell: o.swell, intensity: o.intensity,
      glow: o.glow, edge: o.edge, shape: 0.6, live: 0, rise: 1, riseE: 1, bumpU: 0.5, bumpA: 0, moment: null
    };
    this.tw = {};
    this.amb = 0; this.ambTarget = 0;
    this.visible = true; this.paused = false; this.dirty = true;
    this.introT = -1; this.mult = 1;
    this.bumpTarget = 0;
    this.scrollK = 0;
    this.ramp = readRamp();
    this.ground = parseColor(getComputedStyle(root).getPropertyValue('--hz-ground'), '#ffffff');
    this.accent = parseColor(getComputedStyle(root).getPropertyValue('--hz-accent'), '#1b6b9e');
    this.reveals = revealEls(host);
    var cd = o.condense;
    if (typeof cd === 'string') cd = host.querySelectorAll(cd);
    else if (cd && cd.nodeType) cd = [cd];
    else if (!cd) cd = host.querySelectorAll('[data-hz-condense]');
    this.condenseEls = Array.prototype.slice.call(cd || []);
    this.condensers = [];
    this.nextMoment = 0;
    var self = this;
    this.measure();
    if (window.ResizeObserver) { this.ro = new ResizeObserver(function () { self.measure(); self.dirty = true; wake(); }); this.ro.observe(host); }
    if (window.IntersectionObserver) {
      this.io = new IntersectionObserver(function (es) { self.visible = es[es.length - 1].isIntersecting; if (self.visible) { self.dirty = true; wake(); } }, { rootMargin: '64px' });
      this.io.observe(host);
    }
    if (o.interactive && this.motion) this._bindPointer();
    if (o.scrollLift > 0) {
      this._onScroll = function () { self.dirty = true; wake(); };
      window.addEventListener('scroll', this._onScroll, { passive: true });
    }
    this.start();
  }

  Instance.prototype.measure = function () {
    var host = this.host, r = host.getBoundingClientRect();
    var W = host.offsetWidth || r.width, H = host.offsetHeight || r.height;
    var scale = host.offsetWidth ? r.width / host.offsetWidth : 1;
    var dpr = Math.min(window.devicePixelRatio || 1, this.o.maxDpr);
    this.W = W; this.H = H; this.scale = scale; this.dpr = dpr;
    var cv = this.canvas;
    var bw = Math.max(1, Math.round(W * scale * dpr)), bh = Math.max(1, Math.round(H * scale * dpr));
    if (cv.width !== bw) cv.width = bw;
    if (cv.height !== bh) cv.height = bh;
    this.layoutGrid();
    for (var i = 0; i < this.condensers.length; i++) this.condensers[i].layout();
  };
  Instance.prototype.layoutGrid = function () {
    var cellCss = this.o.cell * this.mult;
    var cellPx = cellCss * this.scale * this.dpr;
    var cols = Math.max(1, Math.ceil(this.canvas.width / cellPx)), rows = Math.max(1, Math.ceil(this.canvas.height / cellPx));
    if (cols !== this.cols || rows !== this.rows) { this.cols = cols; this.rows = rows; this.data = new Uint8Array(cols * rows * 4); }
    this.cellPx = cellPx;
    var S = this.S; S.cols = cols; S.rows = rows; S.cellCss = cellCss; S.W = this.W; S.H = this.H;
  };

  Instance.prototype._bindPointer = function () {
    var self = this, host = this.host;
    function move(e) {
      var r = host.getBoundingClientRect();
      if (!r.width) return;
      var u = (e.clientX - r.left) / r.width, vy = (r.bottom - e.clientY) / r.height;
      if (self.o.edge === 'top') vy = (e.clientY - r.top) / r.height;
      var col = Math.max(0, Math.min(self.cols - 1, Math.floor(u * self.cols)));
      var crest = self.S.hc ? self.S.hc[col] / self.H : self.S.level;
      self.S.bumpU = u;
      self.bumpTarget = u < 0 || u > 1 ? 0 : 1 - smoothstep(0.02, 0.32, vy - crest);
      wake();
    }
    function leave() { self.bumpTarget = 0; wake(); }
    host.addEventListener('pointermove', move, { passive: true });
    host.addEventListener('pointerdown', move, { passive: true });
    host.addEventListener('pointerleave', leave, { passive: true });
    host.addEventListener('pointercancel', leave, { passive: true });
    this._unbind = function () { host.removeEventListener('pointermove', move); host.removeEventListener('pointerdown', move); host.removeEventListener('pointerleave', leave); host.removeEventListener('pointercancel', leave); };
  };

  Instance.prototype.start = function () {
    var o = this.o, i;
    for (i = 0; i < this.condensers.length; i++) this.condensers[i].destroy();
    this.condensers = [];
    if (this.motion && o.intro === 'rise') {
      this.introT = 0; this.S.rise = 0; this.S.riseE = 0; this.mult = 8; this.layoutGrid();
      for (i = 0; i < this.reveals.length; i++) { this.reveals[i].classList.remove('hz-in'); setRevealStyle(this.reveals[i], 0); }
      for (i = 0; i < this.condenseEls.length; i++) { var el = this.condenseEls[i]; el.classList.remove('hz-in'); el.style.opacity = '0'; var cd = new Condenser(el, this.ground, this.accent); cd.layout(); this.condensers.push(cd); }
      this.amb = 0; this.S.shape = 0.6;
    } else {
      this.introT = -1; this.S.rise = 1; this.S.riseE = 1; this.mult = 1; this.layoutGrid();
      for (i = 0; i < this.reveals.length; i++) finishReveal(this.reveals[i]);
      for (i = 0; i < this.condenseEls.length; i++) finishReveal(this.condenseEls[i]);
      this.amb = this.motion && o.ambient ? 1 : 0;
    }
    this.ambTarget = this.motion && o.ambient ? 1 : 0;
    this.S.shape = 0.6 + 0.4 * this.amb;
    this.nextMoment = this._scheduleFirst();
    this.dirty = true;
    wake();
    if (!MANUAL && !rafId) this._frame(0);
  };
  Instance.prototype._scheduleFirst = function () { var m = this.o.moments; return m > 0 ? 9 + this.rng() * 8 : Infinity; };
  Instance.prototype._scheduleNext = function (at) { var m = this.o.moments; return m > 0 ? at + m * (0.65 + this.rng() * 0.7) : Infinity; };

  Instance.prototype._active = function () {
    if (this.destroyed || this.paused || !this.visible || document.hidden) return false;
    return this.dirty || !!this.S.moment || this.introT >= 0 || this.amb > 0.001 || this.ambTarget > 0 || this.S.bumpA > 0.002 || this.bumpTarget > 0 || this._tweening();
  };
  Instance.prototype._tweening = function () { for (var k in this.tw) if (this.tw[k]) return true; return false; };

  Instance.prototype._tween = function (key, to, opt) {
    opt = opt || {};
    var dur = opt.duration === undefined ? 1200 : opt.duration;
    var from = key === 'amb' ? this.amb : this.S[key];
    if (!this.motion || dur <= 0) { this.tw[key] = null; this._set(key, to); this.dirty = true; wake(); return; }
    this.tw[key] = { from: from, to: to, t: 0, dur: dur / 1000, ease: easing(opt.easing || 'inOut') };
    this.dirty = true; wake();
  };
  Instance.prototype._set = function (key, v) { if (key === 'amb') { this.amb = v; this.ambTarget = v; } else this.S[key] = v; };

  Instance.prototype._frame = function (dt) {
    var o = this.o, S = this.S, i, k;
    if (!(dt > 0)) dt = 0;
    for (k in this.tw) {
      var tw = this.tw[k]; if (!tw) continue;
      tw.t += dt; var p = clamp01(tw.t / tw.dur);
      this._set(k, tw.from + (tw.to - tw.from) * tw.ease(p));
      if (k === 'amb') this.ambTarget = tw.to;
      if (p >= 1) this.tw[k] = null;
    }
    // intro
    if (this.introT >= 0) {
      this.introT += dt;
      var t = this.introT;
      S.rise = clamp01(t / 2.3); S.riseE = EASE.out(S.rise);
      var m = t < 0.42 ? 8 : t < 0.78 ? 4 : t < 1.1 ? 2 : 1;
      if (m !== this.mult) { this.mult = m; this.layoutGrid(); }
      for (i = 0; i < this.reveals.length; i++) {
        var el = this.reveals[i], d = parseFloat(el.getAttribute('data-hz-reveal')) || 0;
        var rp = clamp01((t - d) / 0.85);
        if (rp >= 1) { if (!el.classList.contains('hz-in')) finishReveal(el); } else setRevealStyle(el, rp);
      }
      for (i = 0; i < this.condensers.length; i++) {
        var cd = this.condensers[i], cel = cd.el, cdl = parseFloat(cel.getAttribute('data-hz-condense')) || 0.5;
        var cp = clamp01((t - cdl) / 1.35);
        if (t >= cdl && cel.style.opacity === '0') cel.style.opacity = '1';
        cd.draw(cp);
      }
      if (t >= 1.7 && !this._lightDone) { this._lightDone = true; S.moment = { type: 'wave', p: 0, dur: 3.2, dir: o.tilt >= 0 ? -1 : 1 }; }
      if (t >= 2.6) {
        this.introT = -1; this.mult = 1; this.layoutGrid();
        for (i = 0; i < this.condensers.length; i++) { this.condensers[i].destroy(); finishReveal(this.condensers[i].el); }
        this.condensers = [];
        for (i = 0; i < this.reveals.length; i++) finishReveal(this.reveals[i]);
        if (this.ambTarget > 0) this._tween('amb', this.ambTarget, { duration: 2600, easing: 'inOut' });
        if (typeof o.onIntroEnd === 'function') o.onIntroEnd(this);
      }
    }
    // ambient
    if (this.amb > 0.001 && this.motion) {
      S.t += dt * o.speed * this.amb;
      S.shape = 0.6 + 0.4 * this.amb;
      S.live = this.amb;
      if (S.t >= this.nextMoment + o.seed * 13.7 && !S.moment && o.moments > 0) {
        S.moment = this.rng() < 0.62 ? { type: 'wave', p: 0, dur: 6.5 + this.rng() * 2, dir: this.rng() < 0.5 ? 1 : -1 } : { type: 'rise', p: 0, dur: 6 + this.rng() * 2 };
        this.nextMoment = this._scheduleNext(this.nextMoment);
      }
    } else { S.live = 0; S.shape = 0.6 + 0.4 * this.amb; }
    if (S.moment) { S.moment.p += dt / S.moment.dur; if (S.moment.p >= 1) S.moment = null; }
    // pointer
    if (this.motion) {
      var bt = this.bumpTarget * (o.interactive ? 1 : 0);
      S.bumpA += (bt - S.bumpA) * (1 - Math.exp(-dt * (bt > S.bumpA ? 5 : 2.2)));
      if (S.bumpA < 0.002 && bt === 0) S.bumpA = 0;
    }
    // scroll lift
    var lvl = S.level;
    if (o.scrollLift > 0) {
      var r = this.host.getBoundingClientRect();
      var target = clamp01(-r.top / Math.max(1, r.height));
      this.scrollK += (target - this.scrollK) * (this.motion ? 1 - Math.exp(-dt * 6) : 1);
      if (Math.abs(target - this.scrollK) < 0.001) this.scrollK = target;
      S.level = lvl * (1 + o.scrollLift * this.scrollK);
    }
    computeField(S, this.data);
    S.level = lvl;
    this.ramp = this.ramp || readRamp();
    try {
      this.renderer.render({ data: this.data, cols: this.cols, rows: this.rows, cellPx: this.cellPx, ramp: this.ramp });
    } catch (e) {
      if (this.renderer.kind === 'webgl') { if (window.HZ_DEBUG) console.warn('Horizon: WebGL failed, using 2D', e && e.message); this._fallback(); } else throw e;
    }
    this.dirty = o.scrollLift > 0 && Math.abs(clamp01(-this.host.getBoundingClientRect().top / Math.max(1, this.H)) - this.scrollK) > 0.001;
  };
  Instance.prototype._fallback = function () {
    var old = this.canvas, cv = document.createElement('canvas');
    cv.className = 'hz-canvas'; cv.setAttribute('aria-hidden', 'true');
    old.parentNode.replaceChild(cv, old);
    this.canvas = cv; this.renderer = new Renderer2D(cv); this.kind = '2d';
    this.measure(); this.dirty = true; wake();
  };

  // Public instance API
  Instance.prototype.setLevel = function (level, opt) { this._tween('level', level, opt); return this; };
  Instance.prototype.setTilt = function (tilt, opt) { this._tween('tilt', tilt, opt); return this; };
  Instance.prototype.setMotion = function (amount, opt) {
    if (!this.motion) return this;
    this.ambTarget = amount;
    if (this.introT >= 0) { this.dirty = true; wake(); return this; }
    this._tween('amb', amount, opt || { duration: 1600 });
    return this;
  };
  Instance.prototype.set = function (knobs) {
    for (var k in knobs) {
      this.o[k] = knobs[k];
      if (k === 'swell' || k === 'intensity' || k === 'glow' || k === 'edge' || k === 'curve') this.S[k] = knobs[k];
      if (k === 'cell' || k === 'maxDpr') this.measure();
      if (k === 'moments') this.nextMoment = this._scheduleNext(this.S.t - this.o.seed * 13.7);
    }
    this.dirty = true; wake();
    return this;
  };
  Instance.prototype.pause = function () { this.paused = true; return this; };
  Instance.prototype.resume = function () { this.paused = false; this.dirty = true; wake(); return this; };
  Instance.prototype.replay = function () { this._lightDone = false; this.S.moment = null; this.start(); return this; };
  Instance.prototype.refresh = function () { this.measure(); this.dirty = true; wake(); return this; };
  Instance.prototype.destroy = function () {
    this.destroyed = true;
    if (this.ro) this.ro.disconnect();
    if (this.io) this.io.disconnect();
    if (this._unbind) this._unbind();
    if (this._onScroll) window.removeEventListener('scroll', this._onScroll);
    for (var i = 0; i < this.condensers.length; i++) this.condensers[i].destroy();
    this.renderer.destroy();
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.host.classList.remove('hz-host');
    var idx = instances.indexOf(this); if (idx >= 0) instances.splice(idx, 1);
  };
  Object.defineProperty(Instance.prototype, 'level', { get: function () { return this.S.level; } });
  Object.defineProperty(Instance.prototype, 'tilt', { get: function () { return this.S.tilt; } });

  // ---------- public ----------
  function mount(el, opts) {
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) throw new Error('Horizon.mount: element not found');
    var inst = new Instance(el, opts || {});
    instances.push(inst);
    wake();
    return inst;
  }

  // A deterministic, high-resolution still (print, fallbacks). Uses the 2D renderer.
  function renderStill(canvas, opts) {
    opts = opts || {};
    var w = Math.round(opts.width || canvas.width || 1920), h = Math.round(opts.height || canvas.height || 1080);
    canvas.width = w; canvas.height = h;
    var cell = opts.cell || Math.max(4, Math.round(w / 275));
    var cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
    var seed = opts.seed === undefined ? 7 : opts.seed;
    var S = {
      noise: makeNoise(seed), t: seed * 13.7, level: opts.level === undefined ? 0.32 : opts.level, tilt: opts.tilt === undefined ? 0.55 : opts.tilt, curve: opts.curve || 1.6,
      swell: opts.swell === undefined ? 1 : opts.swell, intensity: opts.intensity === undefined ? 1 : opts.intensity, glow: opts.glow === undefined ? 0.6 : opts.glow,
      edge: opts.edge || 'bottom', shape: 0.6, live: 0, rise: 1, riseE: 1, bumpU: 0.5, bumpA: 0, moment: null,
      cols: cols, rows: rows, cellCss: cell, W: w, H: h
    };
    var data = new Uint8Array(cols * rows * 4);
    computeField(S, data);
    var ramp = opts.ramp ? opts.ramp.map(function (c, i) { return parseColor(c, DEFAULT_RAMP[i]); }) : readRamp();
    var ctx = canvas.getContext('2d');
    if (opts.background) { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, w, h); }
    var r2 = new Renderer2D(canvas);
    if (opts.background) {
      var tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
      new Renderer2D(tmp).render({ data: data, cols: cols, rows: rows, cellPx: cell, ramp: ramp });
      ctx.drawImage(tmp, 0, 0);
    } else r2.render({ data: data, cols: cols, rows: rows, cellPx: cell, ramp: ramp });
    return canvas;
  }

  function refreshAll() { for (var i = 0; i < instances.length; i++) instances[i].refresh(); }
  var rzT = 0;
  window.addEventListener('resize', function () { clearTimeout(rzT); rzT = setTimeout(refreshAll, 80); });
  if (mql && mql.addEventListener) mql.addEventListener('change', function () { location.reload(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refreshAll);

  // Safety net: never leave content hidden if a page forgot to mount.
  setTimeout(function () {
    var els = document.querySelectorAll('[data-hz-reveal]:not(.hz-in), [data-hz-condense]:not(.hz-in)');
    for (var i = 0; i < els.length; i++) {
      var owned = false;
      for (var j = 0; j < instances.length; j++) if (instances[j].host.contains(els[i])) owned = true;
      if (!owned) finishReveal(els[i]);
    }
  }, 4000);

  window.Horizon = {
    version: VERSION,
    defaults: DEFAULTS,
    mount: mount,
    renderStill: renderStill,
    instances: instances,
    refresh: refreshAll,
    motionAllowed: motionAllowed,
    stats: function () { return { frames: stats.frames, avgMs: stats.frames ? +(stats.total / stats.frames).toFixed(2) : 0, maxMs: +stats.max.toFixed(2), renderer: instances.map(function (i) { return i.kind; }) }; },
    resetStats: function () { stats.frames = 0; stats.total = 0; stats.max = 0; },
    // Deterministic clock for recording: load with ?clock=manual, then call Horizon.advance(ms) per frame.
    advance: function (ms) { clockNow += ms; step(ms); }
  };
})();
