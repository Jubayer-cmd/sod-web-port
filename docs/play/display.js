// Output stage: takes the game's 240x320 frame and draws it to the page canvas at a
// whole-number device-pixel scale, with optional pixel-art smoothing and screen effects.
//
// Pipeline (WebGL2):  frame texture --[Scale2x]x0..2--> sharp-bilinear upscale + effect --> canvas
// Falls back to a nearest-neighbour 2D canvas when WebGL2 is unavailable.

const W = 240;
const H = 320;

const VS = `#version 300 es
in vec2 pos;
void main() { gl_Position = vec4(pos, 0.0, 1.0); }`;

// Scale2x (AdvMAME2x): doubles resolution by rounding stair-step edges, never inventing
// new colours, so the palette and hard pixel look of the art are preserved.
const SCALE2X_FS = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform ivec2 srcSize;
out vec4 o;
vec4 at(ivec2 p) { return texelFetch(src, clamp(p, ivec2(0), srcSize - 1), 0); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 s = p / 2;
  ivec2 q = p - s * 2;
  vec4 E = at(s);
  vec4 B = at(s + ivec2(0, -1));
  vec4 Hh = at(s + ivec2(0, 1));
  vec4 D = at(s + ivec2(-1, 0));
  vec4 F = at(s + ivec2(1, 0));
  o = E;
  if (B != Hh && D != F) {
    if (q.x == 0 && q.y == 0) o = D == B ? D : E;
    else if (q.x == 1 && q.y == 0) o = B == F ? F : E;
    else if (q.x == 0 && q.y == 1) o = D == Hh ? D : E;
    else o = Hh == F ? F : E;
  }
}`;

// Final pass: sharp-bilinear sampling (exactly nearest at integer ratios, evenly
// anti-aliased seams at fractional ones) plus the selected screen effect.
const FINAL_FS = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 srcSize;
uniform vec2 outSize;
uniform float cell;   // device pixels per game pixel
uniform int effect;   // 0 none, 1 LCD, 2 CRT
out vec4 o;
void main() {
  vec2 fc = vec2(gl_FragCoord.x, outSize.y - gl_FragCoord.y);
  vec2 uv = fc / outSize;
  vec2 scale = outSize / srcSize;
  vec2 texel = uv * srcSize;
  vec2 base = floor(texel);
  vec2 d = fract(texel) - 0.5;
  vec2 range = 0.5 - 0.5 / scale;
  vec2 f = (d - clamp(d, -range, range)) * scale + 0.5;
  vec3 c = texture(src, (base + f) / srcSize).rgb;

  vec2 cp = fract(fc / cell);
  if (effect == 1 && cell >= 3.0) {
    // LCD: thin dark gaps between game pixels, like a 2008 handset panel.
    float edge = max(step(cp.x, 1.0 / cell), step(cp.y, 1.0 / cell));
    c *= 1.0 - 0.22 * edge;
  } else if (effect == 2 && cell >= 2.0) {
    // CRT: per-row scanlines + RGB aperture mask, brightened to compensate.
    float scan = mix(0.55, 1.0, sin(cp.y * 3.14159265));
    int m = int(mod(gl_FragCoord.x, 3.0));
    vec3 mask = m == 0 ? vec3(1.0, 0.8, 0.8) : m == 1 ? vec3(0.8, 1.0, 0.8) : vec3(0.8, 0.8, 1.0);
    c = min(c * scan * mask * 1.35, vec3(1.0));
  }
  o = vec4(c, 1.0);
}`;

function compile(gl, vsSrc, fsSrc) {
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vsSrc], [gl.FRAGMENT_SHADER, fsSrc]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(prog, sh);
  }
  gl.bindAttribLocation(prog, 0, 'pos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  return prog;
}

function makeTexture(gl, w, h) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function webglDisplay(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
  if (!gl) return null;

  const scaleProg = compile(gl, VS, SCALE2X_FS);
  const finalProg = compile(gl, VS, FINAL_FS);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const frameTex = makeTexture(gl, W, H);
  const stages = [1, 2].map((k) => {
    const tex = makeTexture(gl, W << k, H << k);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w: W << k, h: H << k };
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const u = (prog, name) => gl.getUniformLocation(prog, name);
  const loc = {
    sSrc: u(scaleProg, 'src'), sSize: u(scaleProg, 'srcSize'),
    fSrc: u(finalProg, 'src'), fSrcSize: u(finalProg, 'srcSize'), fOut: u(finalProg, 'outSize'),
    fCell: u(finalProg, 'cell'), fEffect: u(finalProg, 'effect'),
  };

  return {
    kind: 'webgl2',
    upload(rgba) {
      gl.bindTexture(gl.TEXTURE_2D, frameTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    },
    render(scale, opts) {
      // Smoothing doubles up to twice, but never beyond the on-screen size.
      const passes = opts.smooth ? (scale >= 4 ? 2 : scale >= 2 ? 1 : 0) : 0;
      let src = { tex: frameTex, w: W, h: H };
      gl.useProgram(scaleProg);
      for (let i = 0; i < passes; i++) {
        const dst = stages[i];
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
        gl.viewport(0, 0, dst.w, dst.h);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.uniform1i(loc.sSrc, 0);
        gl.uniform2i(loc.sSize, src.w, src.h);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        src = dst;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(finalProg);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.uniform1i(loc.fSrc, 0);
      gl.uniform2f(loc.fSrcSize, src.w, src.h);
      gl.uniform2f(loc.fOut, canvas.width, canvas.height);
      gl.uniform1f(loc.fCell, scale);
      gl.uniform1i(loc.fEffect, opts.effect === 'lcd' ? 1 : opts.effect === 'crt' ? 2 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}

function canvasDisplay(canvas) {
  const ctx = canvas.getContext('2d');
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const offCtx = off.getContext('2d');
  const img = offCtx.createImageData(W, H);
  return {
    kind: '2d',
    upload(rgba) {
      img.data.set(rgba);
      offCtx.putImageData(img, 0, 0);
    },
    render() {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
    },
  };
}

export function createDisplay(canvas) {
  let impl = null;
  try {
    impl = webglDisplay(canvas);
  } catch (e) {
    console.warn('WebGL2 output unavailable, using 2D canvas:', e);
  }
  if (!impl) impl = canvasDisplay(canvas);

  let scale = 1;
  let opts = { smooth: false, effect: 'none' };
  let hasFrame = false;

  return {
    kind: impl.kind,
    /**
     * Size the canvas into the available CSS box.
     * 'pixel': whole device pixels per game pixel (every pixel identical, may leave a margin).
     * 'fill':  largest fit at any ratio; the sharp-bilinear pass keeps edges crisp. Best on phones,
     *          where whole-number steps waste a lot of a small screen.
     */
    fit(availCssW, availCssH, mode = 'pixel') {
      const dpr = window.devicePixelRatio || 1;
      const exact = Math.min((availCssW * dpr) / W, (availCssH * dpr) / H);
      scale = mode === 'fill' ? Math.max(1, exact) : Math.max(1, Math.floor(exact));
      canvas.width = Math.round(W * scale);
      canvas.height = Math.round(H * scale);
      canvas.style.width = `${canvas.width / dpr}px`;
      canvas.style.height = `${canvas.height / dpr}px`;
      if (hasFrame) impl.render(scale, opts);
      return scale;
    },
    setOptions(next) {
      opts = { ...opts, ...next };
      if (hasFrame) impl.render(scale, opts);
    },
    draw(rgba) {
      impl.upload(rgba);
      hasFrame = true;
      impl.render(scale, opts);
    },
  };
}
