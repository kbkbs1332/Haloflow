/* =========================================================
   猫猫虫 · WebGL 发光层
   只画「光点」：身体、尾迹、粒子、冲击波碎屑。
   2D 层负责背景、食物、头和 UI，叠加起来就是霓虹感。
   ========================================================= */
(function (root) {
  "use strict";

  var canvas = null, gl = null, prog = null, buf = null, tex = null;
  var loc = {}, data = null, count = 0, cap = 0;
  var W = 1, H = 1, DPR = 1, ready = false;
  var STRIDE = 7;
  var maxPoints = 9000;

  var VS = [
    "attribute vec2 aPos;",
    "attribute float aSize;",
    "attribute vec3 aColor;",
    "attribute float aAlpha;",
    "uniform vec2 uRes;",
    "uniform float uGlow;",
    "varying vec3 vColor;",
    "varying float vAlpha;",
    "void main(){",
    "  vec2 p = aPos / uRes;",
    "  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);",
    "  gl_PointSize = aSize * uGlow;",
    "  vColor = aColor;",
    "  vAlpha = aAlpha;",
    "}"
  ].join("\n");

  var FS = [
    "precision mediump float;",
    "uniform sampler2D uTex;",
    "uniform float uAlpha;",
    "varying vec3 vColor;",
    "varying float vAlpha;",
    "void main(){",
    "  vec4 t = texture2D(uTex, gl_PointCoord);",
    "  gl_FragColor = vec4(vColor, vAlpha * uAlpha) * t;",
    "}"
  ].join("\n");

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) || "shader");
    }
    return sh;
  }

  function makeTexture() {
    var size = 64;
    var c = document.createElement("canvas");
    c.width = c.height = size;
    var g = c.getContext("2d");
    var grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.35, "rgba(255,255,255,.92)");
    grd.addColorStop(0.7, "rgba(255,255,255,.28)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function init(cv) {
    canvas = cv;
    try {
      gl = cv.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: false })
        || cv.getContext("experimental-webgl", { alpha: true });
    } catch (e) { gl = null; }
    if (!gl) return false;

    var vs = compile(gl.VERTEX_SHADER, VS);
    var fs = compile(gl.FRAGMENT_SHADER, FS);
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);

    loc.aPos = gl.getAttribLocation(prog, "aPos");
    loc.aSize = gl.getAttribLocation(prog, "aSize");
    loc.aColor = gl.getAttribLocation(prog, "aColor");
    loc.aAlpha = gl.getAttribLocation(prog, "aAlpha");
    loc.uRes = gl.getUniformLocation(prog, "uRes");
    loc.uGlow = gl.getUniformLocation(prog, "uGlow");
    loc.uAlpha = gl.getUniformLocation(prog, "uAlpha");
    loc.uTex = gl.getUniformLocation(prog, "uTex");

    tex = makeTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc.uTex, 0);

    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    cap = maxPoints * STRIDE;
    data = new Float32Array(cap);
    gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.clearColor(0, 0, 0, 0);

    ready = true;
    return true;
  }

  function resize(w, h, dpr) {
    if (!ready) return;
    W = w; H = h; DPR = dpr || 1;
    canvas.width = Math.round(w * DPR);
    canvas.height = Math.round(h * DPR);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
  }

  function begin() {
    count = 0;
  }

  /* x,y,r 都是 CSS 像素 */
  function add(x, y, r, cr, cg, cb, alpha) {
    if (!ready || count >= maxPoints) return;
    if (!isFinite(x) || !isFinite(y) || !isFinite(r) || r <= 0) return;
    var o = count * STRIDE;
    data[o] = x * DPR;
    data[o + 1] = y * DPR;
    data[o + 2] = Math.min(220, r * DPR * 2);
    data[o + 3] = cr / 255;
    data[o + 4] = cg / 255;
    data[o + 5] = cb / 255;
    data[o + 6] = alpha;
    count++;
  }

  function flush() {
    if (!ready || !count) {
      if (ready) gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, count * STRIDE));

    var stride = STRIDE * 4;
    gl.enableVertexAttribArray(loc.aPos);
    gl.vertexAttribPointer(loc.aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(loc.aSize);
    gl.vertexAttribPointer(loc.aSize, 1, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(loc.aColor);
    gl.vertexAttribPointer(loc.aColor, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(loc.aAlpha);
    gl.vertexAttribPointer(loc.aAlpha, 1, gl.FLOAT, false, stride, 24);

    // 外层光晕
    gl.uniform1f(loc.uGlow, 2.6);
    gl.uniform1f(loc.uAlpha, 0.22);
    gl.drawArrays(gl.POINTS, 0, count);
    // 内核
    gl.uniform1f(loc.uGlow, 1.0);
    gl.uniform1f(loc.uAlpha, 0.95);
    gl.drawArrays(gl.POINTS, 0, count);
  }

  root.WormGL = {
    init: init,
    resize: resize,
    begin: begin,
    add: add,
    flush: flush,
    get ready() { return ready; }
  };
})(window);
