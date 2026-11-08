/**
 * HaloFlow · content script v1.1
 * ① 选中文字 → 双语浮窗（小尺寸、渐变描边）
 * ② 整页翻译：双语插入 / 直接替换原文（保留原样式）
 * ③ 可吸边悬浮球
 */
(() => {
  if (window.__haloflowLoaded) return;
  window.__haloflowLoaded = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'KBD', 'SAMP',
    'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'SVG', 'CANVAS', 'IFRAME'
  ]);
  const INLINE_TAGS = new Set([
    'A', 'SPAN', 'B', 'I', 'EM', 'STRONG', 'CODE', 'SMALL', 'MARK', 'ABBR',
    'TIME', 'SUP', 'SUB', 'BR', 'CITE', 'Q', 'S', 'U', 'VAR', 'KBD', 'SAMP',
    'DFN', 'BDI', 'BDO', 'WBR', 'IMG', 'PICTURE', 'svg', 'SVG', 'FONT'
  ]);
  // 尊重站点自己的"别翻我"声明
  const SKIP_SELECTOR = [
    '[translate="no"]',
    '.notranslate',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[contenteditable="plaintext-only"]',
    '#haloflow-host'
  ].join(',');

  const BLOCK_TAGS = new Set([
    'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'TD', 'TH',
    'FIGCAPTION', 'DD', 'DT', 'SUMMARY', 'DIV', 'CAPTION', 'LABEL', 'ARTICLE', 'SECTION'
  ]);
  const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, figcaption, dd, dt, summary, div, caption, label';

  // 判断是不是"段落级叶子"：子元素不多，且都是内联标签。
  // 否则（比如整篇文章的容器 div）就不能当一段处理，否则会把整页揉成一块。
  function isLeafLike(el) {
    const kids = el.children;
    if (kids.length > 8) return false;
    for (let i = 0; i < kids.length; i++) {
      if (!INLINE_TAGS.has(kids[i].tagName)) return false;
    }
    return true;
  }

  // 只检查直接子元素，避免在大页面上做嵌套 querySelector（性能）
  function hasBlockChild(el) {
    const kids = el.children;
    for (let i = 0; i < kids.length; i++) {
      if (BLOCK_TAGS.has(kids[i].tagName)) return true;
    }
    return false;
  }

  let cfg = {
    translateMode: 'both',   // both | replace
    showBall: true,
    ballSide: 'right',
    ballY: 0.62
  };

  const state = { pageTranslated: false, translating: false, mode: 'both', lastMode: null, autoFollow: false };
  let runId = 0;   // 每次翻译/恢复都递增，正在跑的批次发现不一致就退出
  const translationCache = new Map();   // 划词浮窗用
  const CACHE_KEY = 'haloflowCache';
  const CACHE_MAX = 1200;               // 条数上限，超出丢最早写入的
  let pageCache = new Map();            // 整页翻译缓存（原文 → 译文）
  let cacheLoaded = false;

  async function loadCache() {
    if (cacheLoaded) return;
    try {
      const s = await chrome.storage.local.get(CACHE_KEY);
      const obj = s && s[CACHE_KEY];
      if (obj && typeof obj === 'object') {
        pageCache = new Map(Object.entries(obj));
      }
    } catch (_) {}
    cacheLoaded = true;
  }

  let cacheSaveTimer = null;
  function saveCache() {
    clearTimeout(cacheSaveTimer);
    cacheSaveTimer = setTimeout(() => {
      try {
        const entries = [...pageCache.entries()].slice(-CACHE_MAX);
        if (entries.length !== pageCache.size) pageCache = new Map(entries);
        chrome.storage.local.set({ [CACHE_KEY]: Object.fromEntries(entries) });
      } catch (_) {}
    }, 700);
  }

  // 设置页点"清除缓存"后，内存里的也同步清掉
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (!(CACHE_KEY in changes)) return;
      const next = changes[CACHE_KEY].newValue;
      pageCache = next && typeof next === 'object' ? new Map(Object.entries(next)) : new Map();
    });
  } catch (_) {}

  loadCache();
  const replacedEls = new Map();   // el -> 原文（replace 模式）

  let hostEl = null, shadow = null, popup = null, toastEl = null, ballEl = null, menuEl = null;

  /* ================= Shadow 容器 ================= */
  function ensureShadow() {
    if (shadow && document.documentElement.contains(hostEl)) return shadow;
    hostEl = document.createElement('div');
    hostEl.id = 'haloflow-host';
    hostEl.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483645;';
    (document.body || document.documentElement).appendChild(hostEl);
    shadow = hostEl.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = SHADOW_CSS;
    shadow.appendChild(style);
    return shadow;
  }

  const SHADOW_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    /* ---------- 浮窗 ---------- */
    .hf-card {
      position: fixed;
      pointer-events: auto;
      max-width: min(340px, calc(100vw - 24px));
      max-height: min(300px, 46vh);
      overflow: auto;
      padding: 8px 10px 9px;
      border-radius: 12px;
      border: 1px solid transparent;
      background:
        linear-gradient(rgba(9,12,20,.96), rgba(9,12,20,.96)) padding-box,
        linear-gradient(135deg, rgba(56,240,216,.75), rgba(124,92,255,.55) 55%, rgba(255,92,200,.45)) border-box;
      box-shadow: 0 12px 32px rgba(0,0,0,.6), 0 0 0 1px rgba(0,0,0,.35), 0 0 22px rgba(56,240,216,.10);
      backdrop-filter: blur(10px);
      color: #e8f4ff;
      font: 13px/1.55 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      opacity: 0; transform: translateY(5px) scale(.985);
      transition: opacity .15s ease, transform .15s ease;
      -webkit-overflow-scrolling: touch;
    }
    .hf-card.show { opacity: 1; transform: translateY(0) scale(1); }

    .hf-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    .hf-dot { width: 5px; height: 5px; border-radius: 50%; background: #38f0d8; box-shadow: 0 0 7px #38f0d8; flex: 0 0 auto; }
    .hf-title { font-size: 9px; letter-spacing: .16em; text-transform: uppercase; color: #6d90ac; flex: 1; }

    .hf-btn {
      border: 1px solid rgba(120,150,190,.3);
      background: rgba(255,255,255,.035);
      color: #a8c6de;
      border-radius: 6px; padding: 2px 7px;
      font-size: 10.5px; line-height: 1.5; cursor: pointer;
      transition: .14s; white-space: nowrap;
    }
    .hf-btn:hover, .hf-btn:active { background: rgba(56,240,216,.16); color: #eafffb; border-color: rgba(56,240,216,.55); }
    .hf-btn.active { background: rgba(56,240,216,.18); color: #8ffff0; border-color: rgba(56,240,216,.6); }

    .hf-src { color: #8ea6bc; font-size: 12px; border-left: 2px solid rgba(124,92,255,.6); padding-left: 7px; margin-bottom: 6px; }
    .hf-dst { color: #f2fbff; }
    .hf-loading { display: flex; align-items: center; gap: 6px; color: #7fa8c8; font-size: 12px; }
    .hf-spin {
      width: 11px; height: 11px; border-radius: 50%;
      border: 2px solid rgba(56,240,216,.22); border-top-color: #38f0d8;
      animation: hfspin .7s linear infinite;
    }
    @keyframes hfspin { to { transform: rotate(360deg); } }
    .hf-err { color: #ff9bb0; font-size: 12px; }

    /* ---------- 悬浮球 ---------- */
    .hf-ball {
      position: fixed;
      width: 42px; height: 42px; border-radius: 50%;
      pointer-events: auto; cursor: pointer;
      display: grid; place-items: center;
      border: 1.5px solid transparent;
      background:
        linear-gradient(rgba(8,11,18,.82), rgba(8,11,18,.82)) padding-box,
        linear-gradient(140deg, #38f0d8, #7c5cff 55%, #ff5cc8) border-box;
      box-shadow: 0 4px 16px rgba(0,0,0,.55), 0 0 14px rgba(56,240,216,.35);
      transition: transform .18s cubic-bezier(.3,1.4,.5,1), box-shadow .2s, opacity .2s;
      touch-action: none;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
    }
    .hf-ball:active { transform: scale(.92); }
    .hf-ball.dragging { transition: none; }
    .hf-ball svg { width: 21px; height: 21px; display: block; }
    .hf-ball .ring {
      width: 17px; height: 17px; border-radius: 50%;
      border: 2px solid rgba(56,240,216,.9);
      border-right-color: rgba(124,92,255,.9);
      border-bottom-color: rgba(255,92,200,.7);
      animation: hfspinslow 4s linear infinite;
    }
    @keyframes hfspinslow { to { transform: rotate(360deg); } }
    .hf-ball.busy .ring { animation-duration: .9s; border-top-color: #fff; }

    /* 悬浮球菜单 */
    .hf-menu {
      position: fixed;
      pointer-events: auto;
      display: flex; flex-direction: column; gap: 6px;
      padding: 7px;
      border-radius: 12px;
      border: 1px solid transparent;
      background:
        linear-gradient(rgba(9,12,20,.96), rgba(9,12,20,.96)) padding-box,
        linear-gradient(135deg, rgba(56,240,216,.7), rgba(124,92,255,.55)) border-box;
      box-shadow: 0 12px 30px rgba(0,0,0,.6);
      backdrop-filter: blur(10px);
      opacity: 0; transform: scale(.9); transform-origin: center;
      transition: opacity .14s, transform .14s;
    }
    .hf-menu.show { opacity: 1; transform: scale(1); }
    .hf-menu button {
      pointer-events: auto;
      min-width: 84px; padding: 7px 11px;
      border-radius: 8px; cursor: pointer;
      border: 1px solid rgba(120,150,190,.24);
      background: rgba(255,255,255,.04);
      color: #c6dcee; font-size: 12px; font-family: inherit;
      text-align: left; transition: .14s;
    }
    .hf-menu button:hover, .hf-menu button:active {
      background: rgba(56,240,216,.16); border-color: rgba(56,240,216,.5); color: #eafffb;
    }

    /* ---------- toast ---------- */
    .hf-diag {
      position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
      width: min(92vw, 560px); max-height: 78vh; z-index: 2147483647;
      display: flex; flex-direction: column; gap: 8px; padding: 12px;
      border-radius: 14px; pointer-events: auto;
      background: rgba(9,12,20,.98);
      border: 1px solid rgba(90,230,255,.32);
      box-shadow: 0 16px 44px rgba(0,0,0,.7);
      color: #dff6ff; font: 12px/1.5 -apple-system, "PingFang SC", sans-serif;
    }
    .hf-diag .hd { font-size: 13px; font-weight: 700; color: #6cf5c9; }
    .hf-diag .body { flex: 1; overflow: auto; margin: 0; white-space: pre-wrap;
      word-break: break-all; background: rgba(255,255,255,.04); padding: 8px;
      border-radius: 8px; font: 11px/1.55 ui-monospace, Menlo, monospace; }
    .hf-diag .row { display: flex; gap: 8px; }
    .hf-diag .row button { flex: 1; padding: 8px; border-radius: 9px; cursor: pointer;
      border: 1px solid rgba(120,150,190,.35); background: rgba(255,255,255,.06);
      color: #dff6ff; font: inherit; }
    .hf-diag .row button.send { background: linear-gradient(135deg, #38f0d8, #7c5cff); color: #06121a; font-weight: 700; border: none; }
    .hf-diag .row button:disabled { opacity: .6; }

    .hf-pickbar {
      position: fixed; left: 50%; transform: translateX(-50%);
      bottom: calc(14px + env(safe-area-inset-bottom, 0px));
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; border-radius: 12px;
      background: rgba(9,12,20,.96);
      border: 1px solid rgba(90,230,255,.32);
      color: #dff6ff; font: 12.5px/1.4 -apple-system, "PingFang SC", sans-serif;
      pointer-events: auto; z-index: 2147483647;
      box-shadow: 0 10px 28px rgba(0,0,0,.6);
      white-space: nowrap;
    }
    .hf-pickbar button { pointer-events: auto; border: 1px solid rgba(120,150,190,.35);
      background: rgba(255,255,255,.06); color: #dff6ff; padding: 5px 10px; border-radius: 8px;
      font: inherit; cursor: pointer; }
    .hf-pickbar button.go { background: linear-gradient(135deg, #38f0d8, #7c5cff);
      color: #06121a; font-weight: 700; border: none; }
    .hf-pickbar button.go:disabled { opacity: .45; }
    .hf-pickbar .cnt { color: #6cf5c9; }

    .hf-toast {
      position: fixed; left: 50%; bottom: 26px;
      transform: translateX(-50%) translateY(8px);
      pointer-events: none;
      background: rgba(9,12,20,.96);
      border: 1px solid rgba(90,230,255,.3);
      color: #dff6ff; padding: 7px 13px; border-radius: 9px;
      font: 12px/1.5 -apple-system, "Segoe UI", "PingFang SC", sans-serif;
      opacity: 0; transition: .18s;
      box-shadow: 0 8px 24px rgba(0,0,0,.55);
      max-width: 78vw; text-align: center;
    }
    .hf-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

    /* 手机窄屏再压一点 */
    @media (max-width: 480px) {
      .hf-card { font-size: 12.5px; padding: 7px 9px 8px; border-radius: 11px; }
      .hf-btn { font-size: 10px; padding: 2px 6px; }
      .hf-ball { width: 38px; height: 38px; }
    }
  `;

  function toast(text, ms = 1800) {
    const r = ensureShadow();
    if (!toastEl || !r.contains(toastEl)) {
      toastEl = document.createElement('div');
      toastEl.className = 'hf-toast';
      r.appendChild(toastEl);
    }
    toastEl.textContent = text;
    requestAnimationFrame(() => toastEl.classList.add('show'));
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  /* ================= 选中翻译浮窗 ================= */
  function closePopup() {
    if (popup && popup.parentNode) popup.parentNode.removeChild(popup);
    popup = null;
  }

  function placePopup(el, rect) {
    const pad = 8;
    const w = Math.min(340, window.innerWidth - pad * 2);
    el.style.width = w + 'px';
    let left = Math.min(Math.max(pad, rect.left), window.innerWidth - w - pad);
    let top = rect.bottom + 10;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    requestAnimationFrame(() => {
      const h = el.offsetHeight;
      if (top + h > window.innerHeight - pad) {
        el.style.top = Math.max(pad, rect.top - h - 10) + 'px';
      }
      el.classList.add('show');
    });
  }

  function renderPopup(rect, srcText) {
    const r = ensureShadow();
    closePopup();
    popup = document.createElement('div');
    popup.className = 'hf-card';
    popup.innerHTML = `
      <div class="hf-head">
        <span class="hf-dot"></span>
        <span class="hf-title">HaloFlow</span>
        <button class="hf-btn" data-act="both">双语</button>
        <button class="hf-btn" data-act="tgt">译文</button>
        <button class="hf-btn" data-act="src">原文</button>
        <button class="hf-btn" data-act="close">✕</button>
      </div>
      <div class="hf-body"></div>`;
    const body = popup.querySelector('.hf-body');

    const draw = (translation) => {
      const m = popup ? state.mode : 'tgt';
      popup.querySelectorAll('.hf-btn[data-act]').forEach((b) => {
        if (['both', 'tgt', 'src'].includes(b.dataset.act)) {
          b.classList.toggle('active', b.dataset.act === m);
        }
      });
      body.innerHTML = '';
      if (m === 'src' || m === 'both') {
        const s = document.createElement('div');
        s.className = 'hf-src';
        s.textContent = srcText;
        body.appendChild(s);
      }
      if (m === 'tgt' || m === 'both') {
        if (translation === null) {
          const d = document.createElement('div');
          d.className = 'hf-loading';
          d.innerHTML = '<span class="hf-spin"></span><span>翻译中…</span>';
          body.appendChild(d);
        } else if (translation instanceof Error) {
          const d = document.createElement('div');
          d.className = 'hf-err';
          d.textContent = '出错了：' + translation.message;
          body.appendChild(d);
        } else {
          const d = document.createElement('div');
          d.className = 'hf-dst';
          d.textContent = translation;
          body.appendChild(d);
        }
      }
    };

    draw(null);
    r.appendChild(popup);
    placePopup(popup, rect);

    popup.addEventListener('click', (e) => {
      const b = e.target.closest('.hf-btn');
      if (!b) return;
      if (b.dataset.act === 'close') return closePopup();
      if (['both', 'tgt', 'src'].includes(b.dataset.act)) {
        state.mode = b.dataset.act;
        draw(translationCache.get(srcText) ?? null);
      }
    });

    chrome.runtime.sendMessage({ type: 'translate', texts: [srcText] }, (res) => {
      if (!popup) return;
      if (chrome.runtime.lastError) return draw(new Error(chrome.runtime.lastError.message));
      if (!res || !res.ok) return draw(new Error(res?.error || '未知错误'));
      const t = res.translations[0] || '';
      translationCache.set(srcText, t);
      draw(t);
    });
  }

  document.addEventListener('mouseup', (e) => {
    if (popup && popup.contains(e.target)) return;
    if (hostEl && e.composedPath && e.composedPath().includes(hostEl)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = (sel?.toString() || '').trim();
      if (!text || text.length < 2 || text.length > 4000) return;
      if (!/[\p{L}]/u.test(text)) return;
      if (/^[\u4e00-\u9fa5\s\p{P}]+$/u.test(text)) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;
      renderPopup(rect, text);
    }, 10);
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (!popup) return;
    if (e.composedPath && e.composedPath().includes(hostEl)) return;
    closePopup();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePopup();
      hideMenu();
    }
  });

  /* ================= 收集块 ================= */
  // kind: 'pure' 只含文本节点（可安全替换） / 'mixed' 含子元素
  function acceptText(t, minLen) {
    if (t.length < minLen || t.length > 1200) return false;
    if (!/[\p{L}]/u.test(t)) return false;
    if (/^[\u4e00-\u9fa5\s\p{P}\d]+$/u.test(t)) return false;
    const cjkCount = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
    const kanaCount = (t.match(/[\u3040-\u30ff]/g) || []).length;
    // 有假名就是日语：汉字再多也不能当成"已经是中文"跳过
    if (kanaCount === 0 && cjkCount / t.length > 0.4) return false;
    // 只管"像代码/样式"的文本；分号不能一刀切 ——
    // 正常英文段落里有 "task; individuals ..." 这种，一刀切会把整段丢掉
    if (/[{}]|=>|::|#[0-9a-f]{3,8}\b|fill:/i.test(t)) return false;
    if ((t.match(/;/g) || []).length >= 2 && t.length < 160) return false;
    return true;
  }

  // 横排导航条：整条当一个块翻，译文会掉到下一行被 overflow:hidden 裁掉，
  // 这种情况要放过去，让里面的 a / button 单个翻
  function isRowNav(el) {
    try {
      const kids = el.children;
      if (kids.length < 2) return false;
      let linkish = 0;
      for (let i = 0; i < kids.length; i++) {
        const t = kids[i].tagName;
        if (t === 'A' || t === 'BUTTON') linkish++;
      }
      if (linkish < 2 || linkish / kids.length < 0.5) return false;
      const cs = getComputedStyle(el);
      if (cs.whiteSpace === 'nowrap') return true;
      if (/flex/.test(cs.display) && cs.flexDirection === 'row') return true;
    } catch (_) {}
    return false;
  }

  // 卡片网格：容器里放着好几张大块（图+文），这种不能整块当一个段落翻，
  // 否则 6 张卡片的标题会被拼成一段全部塞进第一张卡里（哈利波特首页就是这么炸的）
  function looksLikeCards(el) {
    try {
      const kids = el.children;
      if (kids.length < 2) return false;
      let big = 0;
      for (let i = 0; i < kids.length; i++) {
        const r = kids[i].getBoundingClientRect();
        if (r.width >= 100 && r.height >= 60) big++;
        if (big >= 2) return true;
      }
    } catch (_) {}
    return false;
  }

  function isVisible(el) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (cs.opacity === '0') return false;
    // offsetParent 在 display:contents / 某些 transform 容器里会误判成"不可见"，
    // 直接看真实尺寸更靠谱（漏翻比多翻难受多了）
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    return true;
  }

  /* ================= 收集 ================= */
  const diag = {};
  const rejected = {};   // { why: [text, ...] } 按原因分组，每类最多 8 条
  function bump(k) { diag[k] = (diag[k] || 0) + 1; }
  function reject(k, t) {
    bump(k);
    const arr = rejected[k] || (rejected[k] = []);
    if (arr.length >= 8) return;
    const str = String(t || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (str) arr.push(str);
  }
  function resetRejected() { for (const k in rejected) delete rejected[k]; }
  function resetDiag() { for (const k in diag) delete diag[k]; }
  const DIAG_LABEL = {
    blockChild: '容器', notLeaf: '非叶子', skipSel: '跳过区', skipTag: '标签',
    hidden: '隐藏', rejectText: '文本判定', style: '样式块', aria: 'aria',
    done: '已翻', noNodes: '无文本节点',
    looseReject: '宽松-文本', looseHidden: '宽松-隐藏'
  };
  function diagText() {
    const parts = [];
    for (const k in diag) {
      if (k === 'looseTried') continue;
      if (!DIAG_LABEL[k]) continue;
      parts.push(DIAG_LABEL[k] + diag[k]);
    }
    return parts.slice(0, 6).join(' ');
  }

  // 页面里可能有 web component 的 shadow DOM，普通 querySelectorAll 穿不进去
  function allRoots() {
    const roots = [document];
    const walk = (root) => {
      let els;
      try { els = root.querySelectorAll('*'); } catch (_) { return; }
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (el.id === 'haloflow-host') continue;
        if (el.shadowRoot) { roots.push(el.shadowRoot); walk(el.shadowRoot); }
      }
    };
    try { walk(document); } catch (_) {}
    return roots;
  }

  function collectStrict() {
    const out = [];
    const seen = new Set();
    const blockEls = new Set();
    const attrSeen = new WeakMap();
    const roots = allRoots();

    for (const root of roots) {
      // ---- ① 块级段落 ----
      root.querySelectorAll(BLOCK_SELECTOR).forEach((el) => {
        if (seen.has(el)) return;
        if (!BLOCK_TAGS.has(el.tagName)) return;
        if (hasBlockChild(el)) { bump('blockChild'); return; }
      if (isRowNav(el)) { bump('rowNav'); return; }   // 导航条交给里面的链接
      if (looksLikeCards(el)) { bump('cards'); return; }  // 卡片网格交给里面的卡片
        try { if (el.closest(SKIP_SELECTOR)) { bump('skipSel'); return; } } catch (_) { return; }
        if (SKIP_TAGS.has(el.tagName)) { bump('skipTag'); return; }
        if (el.closest('.haloflow-trans')) return;
        if (!isLeafLike(el)) { bump('notLeaf'); return; }
        // 注意：不能只看 data-haloflow-done —— React 重渲染会把文本刷回原文，
        // 但自定义属性会残留，导致永远不再翻译。这里比对"译文是否还在"。
        const prevOut = el.getAttribute('data-haloflow-out');
        if (prevOut && (el.innerText || '').trim() === prevOut) { bump('done'); return; }
        if (el.hasAttribute('data-haloflow-done')) {
          el.removeAttribute('data-haloflow-done');
          el.removeAttribute('data-haloflow-tr');
          el.removeAttribute('data-haloflow-inline');
          el.removeAttribute('data-haloflow-out');
        }
        if (el.getAttribute('aria-hidden') === 'true') { bump('aria'); return; }
        if (!isVisible(el)) { reject('hidden', (el.textContent || el.innerText || '').slice(0, 40)); return; }

        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!acceptText(t, 3)) { reject('rejectText', t); return; }
        if (el.querySelector('svg style, style, script')) { bump('style'); return; }

        const nodes = textNodesOf(el);
        if (!nodes.length) { bump('noNodes'); return; }
        seen.add(el);
        blockEls.add(el);
        out.push({ el, text: t, kind: nodes.length === 1 ? 'pure' : 'mixed', nodes });
      });

      // ---- ② 导航链接 / 按钮文字 ----
      root.querySelectorAll('a, button, [role="button"]').forEach((el) => {
        if (seen.has(el)) return;
        if (SKIP_TAGS.has(el.tagName)) return;
        try { if (el.closest(SKIP_SELECTOR)) return; } catch (_) { return; }
        if (el.closest('.haloflow-trans')) return;
        const prevOut2 = el.getAttribute('data-haloflow-out');
        if (prevOut2 && (el.innerText || '').trim() === prevOut2) return;
        if (el.hasAttribute('data-haloflow-done')) {
          el.removeAttribute('data-haloflow-done');
          el.removeAttribute('data-haloflow-tr');
          el.removeAttribute('data-haloflow-inline');
          el.removeAttribute('data-haloflow-out');
        }
        if (el.getAttribute('aria-hidden') === 'true') return;
        if (hasBlockChild(el)) return;
        if (!isVisible(el)) return;

        // 祖先已经是翻译块 → 由祖先负责，避免重复翻
        let p = el.parentElement;
        while (p) {
          if (blockEls.has(p)) return;
          p = p.parentElement;
        }

        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!acceptText(t, 2) || t.length > 120) return;

        const nodes = textNodesOf(el);
        if (!nodes.length) return;
        seen.add(el);
        out.push({ el, text: t, kind: 'action', nodes });
      });

      // ---- ③ 属性文本（title / alt / placeholder / aria-label）----
      ['title', 'alt', 'placeholder', 'aria-label'].forEach((attr) => {
        root.querySelectorAll('[' + attr + ']').forEach((el) => {
          let set = attrSeen.get(el);
          if (!set) { set = new Set(); attrSeen.set(el, set); }
          if (set.has(attr)) return;
          set.add(attr);
          try { if (el.closest(SKIP_SELECTOR)) return; } catch (_) { return; }
          if (!isVisible(el)) return;
          const raw = (el.getAttribute(attr) || '').trim();
          if (raw.length < 2 || raw.length > 200) return;
          if (!acceptText(raw, 2)) return;
          const prev = el.getAttribute('data-haloflow-attr-' + attr);
          if (prev && prev === raw) return;      // 已翻译过
          out.push({ el, text: raw, kind: 'attr', attr, nodes: [] });
        });
      });
    }
    return out;
  }

  // 兜底：严格规则一段都没收上来时，退化成「按文本节点」逐条翻。
  // 这样即使页面全是 div>span 的怪结构、或者整页在 shadow DOM 里，也不会 0 段。
  function collectLoose(ignoreNoTranslate) {
    const out = [];
    const roots = allRoots();
    // 站点常给整页挂 translate="no"（那是拦浏览器自带翻译的），
    // 用户主动点「翻译本页」时应该在最后兜底忽略它
    const SKIP_QUIET = '[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], #haloflow-host';
    const skipSel = ignoreNoTranslate ? SKIP_QUIET : SKIP_SELECTOR;
    const LIMIT = 800;
    for (const root of roots) {
      let w;
      try { w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null); } catch (_) { continue; }
      let n;
      while ((n = w.nextNode()) && out.length < LIMIT) {
        const p = n.parentElement;
        if (!p) continue;
        if (SKIP_TAGS.has(p.tagName)) continue;
        try {
          if (p.closest(skipSel)) continue;
          if (p.closest('[data-haloflow-done]')) continue;   // 已翻过的别再收一遍
        } catch (_) { continue; }
        if (p.closest('.haloflow-trans')) continue;
        const raw = n.nodeValue || '';
        if (!raw.trim()) continue;
        const t = raw.replace(/\s+/g, ' ').trim();
        if (t.length < 2) continue;
        if (!acceptText(t, 2)) { bump('looseReject'); continue; }
        const cs = getComputedStyle(p);
        if (cs.display === 'none' || cs.visibility === 'hidden') { bump('looseHidden'); continue; }
        out.push({ el: p, text: t, kind: 'pure', nodes: [n] });
      }
    }
    return out;
  }

  // 补充收集：严格模式已经收到一些段落，但页面上还有可见英文文本没被覆盖
  // （典型：div 里塞了十几个 span 的卡片、被 isLeafLike 判死的容器）
  function collectSupplement(base) {
    const covered = new Set(base.map((b) => b.el));
    const out = [];
    const roots = allRoots();
    for (const root of roots) {
      let w;
      try { w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null); } catch (_) { continue; }
      let n;
      while ((n = w.nextNode()) && out.length < 400) {
        const p = n.parentElement;
        if (!p) continue;
        let hit = false, q = p;
        while (q) { if (covered.has(q)) { hit = true; break; } q = q.parentElement; }
        if (hit) continue;
        if (SKIP_TAGS.has(p.tagName)) continue;
        try { if (p.closest(SKIP_SELECTOR)) continue; } catch (_) { continue; }
        if (p.closest('.haloflow-trans')) continue;
        const raw = n.nodeValue || '';
        if (!raw.trim()) continue;
        const t = raw.replace(/\s+/g, ' ').trim();
        if (t.length < 4) continue;
        if (!acceptText(t, 4)) continue;
        const cs = getComputedStyle(p);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (p.offsetParent === null && cs.position !== 'fixed') continue;
        covered.add(p);
        out.push({ el: p, text: t, kind: 'pure', nodes: [n] });
      }
    }
    return out;
  }

  // 弹层（菜单 / 对话框 / 下拉）单独补一刀：
  // 站点常给 UI 元素加 translate="no" / .notranslate，但那本来是拦浏览器自带翻译的；
  // 用户主动点开菜单就是想看，所以这里不管那些标记，逐个文本节点收。
  function collectOverlays(base) {
    const out = [];
    const used = new Set();
    base.forEach((b) => (b.nodes || []).forEach((n) => used.add(n)));
    const boxes = document.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"], [role="tooltip"], dialog, [popover]');
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (!box || box.closest('#haloflow-host')) continue;
      let w;
      try { w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, null); } catch (_) { continue; }
      let n;
      while ((n = w.nextNode())) {
        if (used.has(n)) continue;
        const p = n.parentElement;
        if (!p) continue;
        if (SKIP_TAGS.has(p.tagName)) continue;
        try { if (p.closest('[contenteditable="true"], #haloflow-host')) continue; } catch (_) {}
        const raw = n.nodeValue || '';
        if (!raw.trim()) continue;
        const t = raw.replace(/\s+/g, ' ').trim();
        if (t.length < 2) continue;
        if (!acceptText(t, 2)) continue;
        const cs = getComputedStyle(p);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = p.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        used.add(n);
        out.push({ el: p, text: t, kind: 'pure', nodes: [n], overlay: true });
      }
    }
    return out;
  }

  function collectBlocks() {
    resetDiag();
    resetRejected();
    let out = collectStrict();
    // 弹层补充（菜单/对话框里常带 notranslate，用户点开就是想看）
    const overlayBlocks = collectOverlays(out);
    if (overlayBlocks.length) {
      diag.overlay = overlayBlocks.length;
      out = out.concat(overlayBlocks);
    }
    if (!out.length) {
      diag.looseTried = 1;
      out = collectLoose();
      if (!out.length) {
        // 整页被 translate="no" 拦了 → 忽略它再试一次
        diag.noTranslate = 1;
        out = collectLoose(true);
      }
    } else {
      // 严格模式只要漏了一部分（比如 div 里塞满 span 的卡片），就补一轮，
      // 否则会出现「整页只翻了 2 段」这种哑巴现象
      const extra = collectSupplement(out);
      if (extra.length) {
        diag.supplement = extra.length;
        out = out.concat(extra);
      }
    }

    // ---- ④ 优先级：可见的从上到下 → 下方由近及远 → 已滚过的最后 ----
    const vh = window.innerHeight;
    const withP = out.map((b) => {
      let r;
      try { r = b.el.getBoundingClientRect(); } catch (_) { r = { top: 0, bottom: 0 }; }
      let tier, d;
      if (r.bottom > 0 && r.top < vh) { tier = 0; d = r.top; }
      else if (r.top >= vh) { tier = 1; d = r.top - vh; }
      else { tier = 2; d = -r.bottom; }
      return { b, tier, d };
    });
    withP.sort((a, b) => (a.tier - b.tier) || (a.d - b.d));
    return withP.map((x) => x.b);
  }

  // 排查用：__haloflowDiag() 能看到「为什么 0 段」
  window.__haloflowDiag = () => {
    const list = collectBlocks();
    return {
      total: list.length,
      loose: !!diag.looseTried,
      diag: Object.assign({}, diag),
      sample: list.slice(0, 5).map((b) => b.text.slice(0, 60)),
      rejected: Object.assign({}, rejected),
      mode: (typeof cfg === 'object' && cfg.translateMode) || ''
    };
  };

  function textNodesOf(el) {
    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue && n.nodeValue.trim().length) nodes.push(n);
    }
    return nodes;
  }

  /* ---- 流式翻译：走长连接，逐段回传 ---- */
  const activePorts = new Set();

  function streamBatch(texts, onChunk) {
    return new Promise((resolve, reject) => {
      let port;
      try {
        port = chrome.runtime.connect({ name: 'haloflow-stream' });
      } catch (e) {
        return reject(e);
      }
      activePorts.add(port);
      let settled = false;

      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        activePorts.delete(port);
        try { port.disconnect(); } catch (_) {}
        fn(arg);
      };

      port.onMessage.addListener((msg) => {
        if (!msg) return;
        if (msg.type === 'chunk') {
          try { onChunk(msg.index, msg.text); } catch (_) {}
        } else if (msg.type === 'done') {
          finish(resolve);
        } else if (msg.type === 'error') {
          finish(reject, new Error(msg.error || '流式请求失败'));
        }
      });
      port.onDisconnect.addListener(() => {
        activePorts.delete(port);
        finish(resolve);      // 断开时按完成处理，避免卡死
      });
      port.postMessage({ type: 'translate', texts });
    });
  }

  function abortStreams() {
    activePorts.forEach((p) => { try { p.disconnect(); } catch (_) {} });
    activePorts.clear();
  }

  // 超长文本按句子切开分别翻，避免一次输出太长被截断
  function splitLongText(t, maxLen) {
    const out = [];
    let rest = String(t || '');
    while (rest.length > maxLen) {
      let cut = -1;
      for (let i = maxLen; i > maxLen * 0.5; i--) {
        if (/[.!?;。！？；]/.test(rest.charAt(i - 1))) { cut = i; break; }
      }
      if (cut < 0) cut = maxLen;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    if (rest.trim()) out.push(rest);
    return out;
  }

  // 按总字符数分批：长段落单独成批，免得模型输出被截断、整批尾巴丢掉
  function chunkByChars(list, maxChars) {
    const out = [];
    let cur = [], n = 0;
    for (const b of list) {
      const len = (b.text || '').length;
      if (cur.length && n + len > maxChars) { out.push(cur); cur = []; n = 0; }
      cur.push(b);
      n += len;
    }
    if (cur.length) out.push(cur);
    return out;
  }

  function chunk(list, size) {
    const res = [];
    for (let i = 0; i < list.length; i += size) res.push(list.slice(i, i + size));
    return res;
  }

  const bilingualEls = new Set();

  /* ---- 每块末尾的灰色 loading 小圈 ---- */
  // 只有「加粗短标签 + 值」这种结构才算字段（SCP 的 Item #: / Object Class:）
  function isLabelField(nodes, block) {
    try {
      if (!nodes || !nodes.length) return false;
      if ((block.text || '').length > 240) return false;
      const first = (nodes[0].nodeValue || '').trim();
      if (first.length > 32) return false;
      if (!/[:：]$/.test(first)) return false;
      const p = nodes[0].parentElement;
      if (!p) return false;
      if (!/^(STRONG|B|BIG|TH)$/.test(p.tagName)) return false;
      // 标签后面的值太长 → 这是「标签 + 正文」的段落，不是字段，
      // 否则只换标签、正文留原文，最后就是「中文译文 + 日文原文」混在一起
      let restLen = 0;
      for (let i = 1; i < nodes.length; i++) restLen += (nodes[i].nodeValue || '').length;
      if (restLen > 80) return false;
      return true;
    } catch (_) {}
    return false;
  }

  function addSpinner(block) {
    if (block._spin || block.el.hasAttribute('data-haloflow-tr')) return;
    // 兜底模式下多个文本节点共用一个父元素，别叠出一堆圈
    try { if (block.el.querySelector(':scope > .haloflow-spin')) return; } catch (_) {}
    const sp = document.createElement('span');
    sp.className = 'haloflow-spin';
    sp.setAttribute('aria-hidden', 'true');
    sp.contentEditable = 'false';
    block.el.appendChild(sp);
    block._spin = sp;
  }

  // 收尾兜底：不管哪条路径结束，页面上不该再挂着圈
  function clearAllSpinners() {
    try {
      document.querySelectorAll('.haloflow-spin').forEach((n) => { try { n.remove(); } catch (_) {} });
    } catch (_) {}
  }

  function dropSpinner(block) {
    if (block._spin) {
      block._spin.remove();
      block._spin = null;
    }
  }

  /* ---- 一行里多个链接加起来超宽时，缩小整行字号 ---- */
  const fittedParents = new Set();

  function fitRow(parent) {
    try {
      if (!parent || parent === document.body || parent === document.documentElement) return;
      if (parent.children.length > 24) return;
      const before = parent.getBoundingClientRect();
      if (before.height > 120) return;                 // 只处理导航/工具条这类矮行
      const cs = getComputedStyle(parent);
      const base = parseFloat(cs.fontSize) || 16;
      let guard = 0;
      while (parent.scrollWidth > parent.clientWidth + 1 && guard < 10) {
        const cur = parseFloat(getComputedStyle(parent).fontSize) || base;
        if (cur <= base * 0.7) break;
        parent.style.fontSize = (cur * 0.94).toFixed(2) + 'px';
        fittedParents.add(parent);
        guard++;
      }
    } catch (_) {}
  }

  /* ---- 按钮/链接文字过长时自动缩字号，避免溢出框 ---- */
  function fitText(el) {
    try {
      const cs = getComputedStyle(el);
      const base = parseFloat(cs.fontSize) || 16;
      const parent = el.parentElement;
      const limit = (parent ? parent.getBoundingClientRect().width : window.innerWidth) || window.innerWidth;
      if (!limit) return;
      let guard = 0;
      while (el.getBoundingClientRect().width > limit * 0.98 && guard < 14) {
        const cur = parseFloat(getComputedStyle(el).fontSize) || base;
        if (cur <= base * 0.6) break;
        el.style.fontSize = (cur * 0.93).toFixed(2) + 'px';
        guard++;
      }
    } catch (_) {}
  }

  // 把译文落到元素上：
  //   replace + 单文本节点 → 直接改文本，完全保留原格式
  //   其余情况            → 用 data 属性 + ::after 伪元素追加，不改变 DOM 结构（不会破坏 grid/flex）
  const replacedAttrs = new Map();   // el -> { attr: [原值...] }

  // 译文该并排到右边（横排导航 / 按钮 / 单行 nowrap），还是正常换到下一行？
  function wantsInline(el, kind) {
    try {
      const t = (el.innerText || '').trim();
      if (t.length > 60) return false;
      const cs = getComputedStyle(el);
      if (cs.whiteSpace === 'nowrap') return true;
      const p = el.parentElement;
      if (p) {
        const ps = getComputedStyle(p);
        if (ps.whiteSpace === 'nowrap') return true;
        if (/flex/.test(ps.display) && ps.flexDirection === 'row') return true;
      }
      if (kind === 'action') {
        const r = el.getBoundingClientRect();
        if (r.height && r.height <= 48) return true;
      }
      const r2 = el.getBoundingClientRect();
      if (r2.height && r2.height <= 34 && t.length <= 24) return true;
    } catch (_) {}
    return false;
  }

  // 常见配错：DeepSeek 官方没有 deepseek-flash 这个模型
  function fixedModel(m, base) {
    const model = String(m || '').trim();
    // 用户填什么就用什么（DeepSeek V4 的正式模型名就是 deepseek-flash / deepseek-v4-pro），
    // 只在留空时给一个默认值
    return model || 'deepseek-flash';
  }

  function applyTranslation(block, tr, mode) {
    const { el, nodes } = block;

    if (block.kind === 'attr') {
      const key = 'data-haloflow-attr-' + block.attr;
      if (!el.getAttribute(key)) {
        let rec = replacedAttrs.get(el);
        if (!rec) { rec = {}; replacedAttrs.set(el, rec); }
        if (!(block.attr in rec)) rec[block.attr] = el.getAttribute(block.attr);
      }
      el.setAttribute(block.attr, tr);
      el.setAttribute(key, tr);
      return;
    }

    if (mode === 'replace') {
      // 关键：永远不碰元素节点（img / svg / a / span 都原样保留），
      // 只改文本节点的内容。这样图片绝不会被"挤成文字"。
      if (nodes.length === 1) {
        if (!replacedEls.has(el)) replacedEls.set(el, { single: nodes[0], text: nodes[0].nodeValue });
        nodes[0].nodeValue = tr;
      } else if (isLabelField(nodes, block)) {
        // 真·字段（<strong>Item #:</strong> SCP-055）：只换加粗标签，后面的值原样留着。
        // 注意：标题那种 "True or False: <span>xx</span> edition" 不算字段，
        // 否则会翻一半留一半，变成中英混杂。
        if (!replacedEls.has(el)) replacedEls.set(el, { nodes: nodes.map((n) => n.nodeValue) });
        nodes[0].nodeValue = tr;
        // 译文里已经带上了后面的值（"项目编号：SCP-055"）就把原值清掉，
        // 否则会变成 "项目编号：SCP-055 SCP-055"
        const trNorm = String(tr).replace(/\s+/g, ' ').trim();
        for (let i = 1; i < nodes.length; i++) {
          const v = (nodes[i].nodeValue || '').replace(/\s+/g, ' ').trim();
          if (v && trNorm.includes(v)) nodes[i].nodeValue = '';
        }
      } else {
        if (!replacedEls.has(el)) replacedEls.set(el, { nodes: nodes.map((n) => n.nodeValue) });
        nodes[0].nodeValue = tr;
        for (let i = 1; i < nodes.length; i++) nodes[i].nodeValue = '';
      }
      el.setAttribute('data-haloflow-done', '1');
      el.setAttribute('data-haloflow-out', (el.innerText || '').trim());
      if (block.kind === 'action') {
        el.setAttribute('data-haloflow-action', '1');
        if (tr.length <= 12) el.style.whiteSpace = 'nowrap';
        fitText(el);
      }
      return;
    }

    // 双语模式：伪元素追加，不动 DOM
    if (wantsInline(el, block.kind)) el.setAttribute('data-haloflow-inline', '1');
    else el.removeAttribute('data-haloflow-inline');
    el.setAttribute('data-haloflow-tr', tr);
    el.setAttribute('data-haloflow-done', '1');
    bilingualEls.add(el);
  }

  function markBusy(on) {
    if (!ballEl) return;
    ballEl.classList.toggle('busy', on);
  }

  /* ================= 跨 frame ================= */
  // 很多站在 iframe 里塞商品 / 评论模块，主文档点"翻译本页"时要把它们也带上
  const isTopFrame = (() => { try { return window.top === window.self; } catch (_) { return false; } })();
  let fromParent = false;

  function broadcastFrames(msg) {
    if (!isTopFrame) return;
    try {
      document.querySelectorAll('iframe, frame').forEach((f) => {
        try { f.contentWindow.postMessage(msg, '*'); } catch (_) {}
      });
    } catch (_) {}
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || !d.haloflow) return;
    if (d.haloflow === 'translate') {
      fromParent = true;
      Promise.resolve(translatePage(true)).then(() => { fromParent = false; }, () => { fromParent = false; });
    }
    if (d.haloflow === 'restore') { try { restorePage(true); } catch (_) {} }
  });

  let translatingSince = 0;
  let lastProgressAt = 0;
  async function translatePage(silent) {
    // 卡死兜底：超过 90 秒还没结束就强制复位
    if (state.translating && Date.now() - Math.max(translatingSince, lastProgressAt) > 90000) {
      runId++;
      abortStreams();
      state.translating = false;
    }
    if (state.translating) return silent || toast('正在翻译中，稍等喵…');
    translatingSince = Date.now();
    lastProgressAt = Date.now();
    await loadCache();
    const myRun = ++runId;
    const mode = cfg.translateMode === 'replace' ? 'replace' : 'both';
    // 没填 key 就直接说清楚，别发一堆注定 401 的请求（以前会显示「共 0 段」）
    if (!cfg.apiKey) {
      return toast('还没填 API Key 喵：点头像/扩展 → 设置，填好再点翻译', 4200);
    }

    let blocks = collectBlocks();
    if (!blocks.length) {
      // SPA 可能还在渲染，等一拍再收一次
      await sleep(700);
      blocks = collectBlocks();
    }
    if (!blocks.length) {
      const stuck = document.querySelectorAll('[data-haloflow-done]').length;
      if (stuck) {
        document.querySelectorAll('[data-haloflow-done]').forEach((el) => {
          el.removeAttribute('data-haloflow-done');
          el.removeAttribute('data-haloflow-tr');
          el.removeAttribute('data-haloflow-inline');
          el.removeAttribute('data-haloflow-out');
        });
        return silent || toast(`发现 ${stuck} 个残留标记，已清理，请再点一次翻译喵`, 2600);
      }
      const dt = diagText();
      return silent || toast(`这一页没找到可翻的段落喵${dt ? '（' + dt + '）' : ''}`, 3200);
    }

    state.lastMode = mode;
    state.translating = true;
    markBusy(true);
    devLog('info', 'start ' + blocks.length + ' blocks, mode=' + mode);
    if (!fromParent) broadcastFrames({ haloflow: 'translate' });
    // 按长度分组：短文本合大批快速返回，长文本小批慢慢流
    // 并发策略：自动按页面规模算，手动用用户设定值
    const autoConc = blocks.length > 120 ? 6 : blocks.length > 60 ? 5 : blocks.length > 30 ? 3 : 2;
    const concMode = cfg.concurrencyMode === 'manual' ? 'manual' : 'auto';
    const maxConc = concMode === 'manual'
      ? Math.max(1, Math.min(8, Number(cfg.maxConcurrency || 2)))
      : autoConc;
    const SHORT_LEN = 80;
    // 短文本合更大批、并发压到最低：让同一时间只有一个请求在用相同前缀，
    // 后续请求更容易命中 DeepSeek 的上下文缓存
    // 批次自适应：平均段落越长，批次越小（长文本生成慢，大批会拖垮首字）
    const totalLen = blocks.reduce((n, b) => n + b.text.length, 0);
    const avgLen = totalLen / Math.max(1, blocks.length);
    const autoBatch = avgLen > 250 ? 6 : avgLen > 120 ? 10 : avgLen > 60 ? 16 : 24;
    const capBatch = Math.max(8, Math.min(60, Number(cfg.pageChunkSize || 24) || 24));
    const SHORT_BATCH = Math.min(autoBatch, capBatch);
    const LONG_BATCH = Math.max(4, Math.min(8, Math.round(SHORT_BATCH * 0.6)));

    const shortBlocks = blocks.filter((b) => b.text.length <= SHORT_LEN);
    const longBlocks = blocks.filter((b) => b.text.length > SHORT_LEN);

    const shortConc = Math.max(1, Math.floor(maxConc / 2));
    const longConc = Math.max(1, maxConc - shortConc);

    // 首批小批：先发 6 段，让用户 1-2 秒内看到中文，剩下的再按大批走。
    // 这对 TTFT 较长的模型（GLM / GPT 系）感知提升最大。
    const FIRST_BATCH = 5;
    let shortGroups;
    if (shortBlocks.length > FIRST_BATCH * 2) {
      shortGroups = [shortBlocks.slice(0, FIRST_BATCH)]
        .concat(chunkByChars(shortBlocks.slice(FIRST_BATCH), 1200));
    } else {
      shortGroups = chunkByChars(shortBlocks, 1200);
    }
    const longGroups = chunkByChars(longBlocks, 1500);   // 长段落按字符数分，别挤在一批

    let done = 0, failed = 0, lastError = '';
    if (!silent) toast(`开始翻译 ${blocks.length} 段（短 ${shortBlocks.length} / 长 ${longBlocks.length}）…`, 1200);
    blocks.slice(0, 40).forEach(addSpinner);

    const totalBlocks = blocks.length;

    async function runQueue(groups, conc) {
      let cursor = 0;
      const worker = async () => {
        while (cursor < groups.length) {
          if (myRun !== runId) return;
          const g = groups[cursor++];

          // ① 先吃缓存
          const todo = [];
          const huge = [];
          for (const b of g) {
            const hit = pageCache.get(b.text);
            if (hit) {
              dropSpinner(b);
              applyTranslation(b, hit, mode);
              done++; lastProgressAt = Date.now();
            } else if ((b.text || '').length > 520) {
              huge.push(b);   // 超长段落单独拆开翻
            } else {
              todo.push(b);
            }
          }
          for (const b of huge) {
            const parts = splitLongText(b.text, 520);
            let merged = '';
            try {
              for (const part of parts) {
                if (myRun !== runId) break;
                let got = '';
                await streamBatch([part], (i, t) => { if (t) got = t; });
                merged += got;
              }
              if (merged.trim()) {
                dropSpinner(b);
                pageCache.set(b.text, merged);
                applyTranslation(b, merged, mode);
                done++; lastProgressAt = Date.now();
              } else {
                failed++;
                lastError = '长段没有翻出来';
                dropSpinner(b);
              }
            } catch (e) {
              failed++;
              lastError = String((e && e.message) || e || '长段失败');
              dropSpinner(b);
            }
          }
          if (!todo.length) {
            if (!silent && done + failed < totalBlocks) toast(`翻译中 ${done + failed}/${totalBlocks}…`, 400);
            continue;
          }

          // ② 流式（失败自动重试，最多 3 次，指数退避）
          let streamed = 0;
          let attempt = 0;
          let lastErr = null;
          let remaining = todo;
          let okThisRound = 0;
          while (attempt < 3) {
            try {
              const base = remaining;
              okThisRound = 0;
              await streamBatch(base.map((b) => b.text), (i, tr) => {
                if (myRun !== runId) return;
                const b = base[i];
                if (!b || !tr) return;
                okThisRound++;
                dropSpinner(b);
                pageCache.set(b.text, tr);
                applyTranslation(b, tr, mode);
                streamed++;
                done++; lastProgressAt = Date.now();
                if (!silent) toast(`翻译中 ${done + failed}/${totalBlocks}…`, 300);
              });
              lastErr = null;
              break;
            } catch (e) {
              lastErr = e;
              lastError = String((e && e.message) || e || '');
              devLog('err', lastError.slice(0, 160));
              // 模型名 / Key / 参数这类硬错误，重试也是白烧 token
              if (/^HTTP (400|401|403|404|422)/.test(String((e && e.message) || ''))) {
                failed += remaining.length;
                remaining.forEach(dropSpinner);
                break;
              }
              // 已经成功的不再重复请求，只补剩下的
              if (okThisRound > 0) remaining = remaining.slice(okThisRound);
              attempt++;
              if (attempt < 3) {
                if (!silent) toast(`重试第 ${attempt} 次（${String(e.message || e).slice(0, 30)}）…`, 1200);
                await new Promise((r) => setTimeout(r, 700 * attempt * attempt));
              }
            }
          }
          if (myRun !== runId) return;

          try {
            if (!lastErr) { saveCache(); }
            else { throw lastErr; }
          } catch (e) {
            // 回退一次性请求
            const rest = todo.slice(streamed);
            if (rest.length) {
              try {
                const res = await new Promise((resolve) =>
                  chrome.runtime.sendMessage({ type: 'translate', texts: rest.map((b) => b.text) }, resolve)
                );
                if (res && res.ok) {
                  rest.forEach((b, i) => {
                    const tr = res.translations[i];
                    dropSpinner(b);
                    if (tr) {
                      pageCache.set(b.text, tr);
                      applyTranslation(b, tr, mode);
                    }
                  });
                  done += rest.length;
                  saveCache();
                } else {
                  failed += rest.length;
                  rest.forEach(dropSpinner);
                }
              } catch (_) {
                failed += rest.length;
                rest.forEach(dropSpinner);
              }
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(conc, groups.length || 1) }, () => worker()));
    }

    // 两条队列并行：短文本先冒出来，长文本在后头慢慢流
    await Promise.all([
      runQueue(shortGroups, shortConc),
      runQueue(longGroups, longConc)
    ]);

    if (myRun !== runId) { state.translating = false; blocks.forEach(dropSpinner); clearAllSpinners(); return; }
    state.translating = false;
    state.pageTranslated = true;
    state.autoFollow = true;
    markBusy(false);
    blocks.forEach(dropSpinner);

    // 导航条/工具条整行溢出处理（去重）
    const parents = new Set();
    blocks.forEach((b) => {
      if (b.kind === 'action' && b.el.parentElement) parents.add(b.el.parentElement);
    });
    parents.forEach(fitRow);
    clearAllSpinners();
    if (!silent) {
      if (!done && !failed) toast('一段都没翻成喵：检查 API 地址 / Key / 模型名', 4200);
      else if (!done) toast(`全部失败（${failed} 段）：${String(lastError).slice(0, 70)}`, 5200);
      else if (failed) toast(`完成，${failed} 段失败喵${lastError ? '：' + String(lastError).slice(0, 40) : ''}`, 3200);
      else toast(`全部完成，共 ${done} 段喵`);
    }
  }

  function restorePage(silent) {
    runId++;                    // 让正在运行的翻译批次立刻作废
    abortStreams();             // 断开在途的流式连接，省 token
    state.translating = false;
    broadcastFrames({ haloflow: 'restore' });
    document.querySelectorAll('.haloflow-trans').forEach((n) => n.remove());
    document.querySelectorAll('.haloflow-spin').forEach((n) => n.remove());
    bilingualEls.forEach((el) => {
      if (el && el.isConnected) {
        el.removeAttribute('data-haloflow-tr');
        el.removeAttribute('data-haloflow-done');
        el.removeAttribute('data-haloflow-out');
      }
    });
    bilingualEls.clear();
    replacedEls.forEach((saved, el) => {
      if (!el || !el.isConnected) return;
      if (saved.single) {
        saved.single.nodeValue = saved.text;
      } else if (saved.nodes) {
        const cur = textNodesOf(el);
        saved.nodes.forEach((v, i) => { if (cur[i]) cur[i].nodeValue = v; });
      } else if (saved.html !== undefined) {
        el.innerHTML = saved.html;
      }
      el.removeAttribute('data-haloflow-done');
      el.removeAttribute('data-haloflow-out');
      el.removeAttribute('data-haloflow-action');
      if (el.style && el.style.fontSize) el.style.fontSize = '';
      if (el.style && el.style.whiteSpace) el.style.whiteSpace = '';
    });
    replacedAttrs.forEach((rec, el) => {
      if (!el || !el.isConnected) return;
      Object.keys(rec).forEach((attr) => {
        if (rec[attr] === null) el.removeAttribute(attr);
        else el.setAttribute(attr, rec[attr]);
        el.removeAttribute('data-haloflow-attr-' + attr);
      });
    });
    replacedAttrs.clear();

    fittedParents.forEach((p) => {
      if (p && p.style && p.style.fontSize) p.style.fontSize = '';
    });
    fittedParents.clear();
    replacedEls.clear();
    state.pageTranslated = false;
    state.autoFollow = false;
    markBusy(false);
    if (!silent) toast('已恢复原文喵');
  }

  /* ================= 诊断 ================= */
  const DEV_LOGS = [];
  function devLog(level, msg) {
    try {
      DEV_LOGS.push({ t: Date.now(), l: level, m: String(msg).slice(0, 300) });
      if (DEV_LOGS.length > 400) DEV_LOGS.shift();
    } catch (_) {}
  }

  function buildDiagReport() {
    let collect = null;
    try { collect = window.__haloflowDiag ? window.__haloflowDiag() : null; } catch (_) {}
    let ver = '?';
    try { ver = chrome.runtime.getManifest().version; } catch (_) {}
    return {
      app: 'haloflow-ext',
      version: ver,
      ts: new Date().toISOString(),
      url: location.href,
      ua: navigator.userAgent,
      cfg: {
        baseUrl: cfg.baseUrl || '',
        model: cfg.model || '',
        mode: cfg.translateMode || '',
        fwd: cfg.forwardMode || '',
        keyLen: (cfg.apiKey || '').length
      },
      cacheSize: (typeof pageCache !== 'undefined' && pageCache) ? pageCache.size : -1,
      collect: collect,
      logs: DEV_LOGS.slice(-200)
    };
  }

  function reportToText(r) {
    const lines = [];
    lines.push('HaloFlow 诊断报告（扩展）');
    lines.push('版本 ' + r.version + '  ' + r.ts);
    lines.push('页面 ' + r.url);
    lines.push('UA   ' + r.ua);
    lines.push('配置 base=' + r.cfg.baseUrl + ' model=' + r.cfg.model + ' mode=' + r.cfg.mode +
      ' fwd=' + r.cfg.fwd + ' keyLen=' + r.cfg.keyLen);
    lines.push('缓存 ' + r.cacheSize + ' 条');
    if (r.collect) {
      lines.push('可翻段落 ' + r.collect.total + '  过滤 ' + JSON.stringify(r.collect.diag || {}));
      const s = r.collect.sample || [];
      if (s.length) lines.push('样本 ' + JSON.stringify(s.slice(0, 3)));
      const rej = r.collect.rejected || {};
      lines.push('--- 被跳过的文本 ---');
      const keys = Object.keys(rej);
      if (!keys.length) lines.push('（没有记录）');
      keys.forEach((why) => {
        const total = (r.collect.diag && r.collect.diag[why]) || rej[why].length;
        lines.push('[' + why + ' ×' + total + ']');
        rej[why].forEach((t) => lines.push('    ' + t));
      });
    } else {
      lines.push('收集信息不可用');
    }
    if (r.logs && r.logs.length) {
      lines.push('--- 日志（' + r.logs.length + '）---');
      r.logs.slice(-60).forEach((l) => lines.push('[' + l.l + '] ' + l.m));
    }
    return lines.join('\n');
  }

  function sendDiag(obj) {
    // 走后台转发（内容脚本直接 fetch 会被跨域挡）
    return postJSON('https://relay.example.com/log', obj);
  }

  let diagEl = null;
  function showDiag() {
    const r = ensureShadow();
    if (diagEl) { diagEl.remove(); diagEl = null; }
    const report = buildDiagReport();
    diagEl = document.createElement('div');
    diagEl.className = 'hf-diag';
    diagEl.innerHTML = `
      <div class="hd">诊断报告 · v${report.version}</div>
      <pre class="body"></pre>
      <div class="row">
        <button class="copy">复制</button>
        <button class="send">发到中转站</button>
        <button class="close">关闭</button>
      </div>`;
    diagEl.querySelector('.body').textContent = reportToText(report);
    r.appendChild(diagEl);
    diagEl.querySelector('.close').addEventListener('click', () => { diagEl.remove(); diagEl = null; });
    diagEl.querySelector('.copy').addEventListener('click', () => {
      const txt = reportToText(report);
      try {
        const ta = document.createElement('textarea');
        ta.value = txt; diagEl.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
        toast('已复制');
      } catch (_) { toast('复制失败，手动长按选中'); }
    });
    diagEl.querySelector('.send').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = '发送中…';
      try {
        await sendDiag(report);
        btn.textContent = '已发送 ✓';
        toast('诊断已发到中转站');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '发送失败，重试';
        toast('发送失败：' + String(err.message || err).slice(0, 40));
      }
    });
  }

  /* ================= 悬浮球 ================= */
  const BALL_SIZE_M = 42;

  function ballPosition() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const size = vw <= 480 ? 38 : BALL_SIZE_M;
    const x = cfg.ballSide === 'left' ? 6 : vw - size - 6;
    const y = Math.min(Math.max(8, vh * (cfg.ballY || 0.62) - size / 2), vh - size - 8);
    return { x, y, size };
  }

  async function patchConfig(patch) {
    try {
      const s = await chrome.storage.local.get('config');
      const next = { ...(s.config || {}), ...patch };
      await chrome.storage.local.set({ config: next });
      cfg = { ...cfg, ...patch };
    } catch (_) {
      cfg = { ...cfg, ...patch };
    }
  }

  function saveBall(x, y) {
    const side = x + BALL_SIZE_M / 2 < window.innerWidth / 2 ? 'left' : 'right';
    const by = Math.min(0.95, Math.max(0.05, (y + BALL_SIZE_M / 2) / window.innerHeight));
    patchConfig({ ballSide: side, ballY: by });
  }

  function hideMenu() {
    if (!menuEl) return;
    menuEl.classList.remove('show');
    // 只靠 opacity 隐藏的话，透明的菜单仍然能点到按钮，这里直接 display:none
    menuEl.style.display = 'none';
    menuEl.style.pointerEvents = 'none';
  }

  /* ================= 图片翻译（实验性） ================= */
  const SYS_VISION =
    '你是图像文字识别与翻译引擎。找出图中所有需要翻译的文字（正文、标题、按钮、对白），' +
    '忽略纯装饰性文字、水印和无法辨认的内容。\n' +
    '严格输出 JSON 数组，不要 markdown、不要解释：\n' +
    '[{"box":[x1,y1,x2,y2],"text":"原文","tr":"译文"}]\n' +
    'box 用 0-1000 的相对坐标（左上角为原点，x 向右 y 向下），刚好框住这段文字。' +
    '译文要自然、符合中文习惯；数字、编号、专有名词保持原样。';

  let pickMode = false;
  let pickBar = null;
  const pickedImgs = new Set();

  function imgVisible(img) {
    try {
      const r = img.getBoundingClientRect();
      if (r.width < 80 || r.height < 80) return false;
      const cs = getComputedStyle(img);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      return true;
    } catch (_) { return false; }
  }

  function refreshPickBar() {
    if (!pickBar) return;
    const n = pickedImgs.size;
    pickBar.querySelector('.cnt').textContent = `已选 ${n} 张`;
    pickBar.querySelector('.go').disabled = n === 0;
  }

  function onPickClick(e) {
    if (!pickMode) return;
    e.preventDefault();
    e.stopPropagation();
    const img = e.currentTarget;
    if (pickedImgs.has(img)) {
      pickedImgs.delete(img);
      img.style.outline = '3px solid rgba(78,161,255,.9)';
    } else {
      pickedImgs.add(img);
      img.style.outline = '3px solid #ffd23f';
      img.style.outlineOffset = '-3px';
    }
    refreshPickBar();
  }

  function startImagePick() {
    if (pickMode) return;
    const imgs = [...document.querySelectorAll('img')].filter(imgVisible);
    if (!imgs.length) return toast('这一页没有可选的大图');
    pickMode = true;
    pickedImgs.clear();
    imgs.forEach((img) => {
      img.dataset.hfPick = '1';
      img.style.outline = '3px solid rgba(78,161,255,.9)';
      img.style.outlineOffset = '-3px';
      img.style.cursor = 'pointer';
      img.addEventListener('click', onPickClick, true);
    });
    const r = ensureShadow();
    pickBar = document.createElement('div');
    pickBar.className = 'hf-pickbar';
    pickBar.innerHTML = `
      <span>点图片选择</span>
      <span class="cnt">已选 0 张</span>
      <button class="cancel">取消</button>
      <button class="go" disabled>翻译</button>`;
    r.appendChild(pickBar);
    pickBar.querySelector('.cancel').addEventListener('click', () => endImagePick(false));
    pickBar.querySelector('.go').addEventListener('click', () => endImagePick(true));
    toast(`页面上有 ${imgs.length} 张图，点一下选中喵`, 2200);
  }

  function endImagePick(go) {
    const list = [...pickedImgs];
    pickMode = false;
    document.querySelectorAll('img[data-hf-pick]').forEach((img) => {
      img.style.outline = '';
      img.style.cursor = '';
      img.removeAttribute('data-hf-pick');
      img.removeEventListener('click', onPickClick, true);
    });
    if (pickBar) { pickBar.remove(); pickBar = null; }
    pickedImgs.clear();
    if (go && list.length) translateImages(list);
  }

  function postJSON(url, body) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: 'vision', url, body, key: cfg.apiKey }, (res) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (!res) return reject(new Error('后台没有响应'));
          if (!res.ok) {
            let m = '';
            try { const j = JSON.parse(res.text || ''); m = (j.error && j.error.message) || ''; } catch (_) {}
            return reject(new Error('HTTP ' + res.status + ' ' + m));
          }
          try { resolve(JSON.parse(res.text || '{}')); } catch (_) { reject(new Error('返回不是 JSON')); }
        });
      } catch (e) { reject(e); }
    });
  }

  async function visionOnce(img) {
    const src = img.currentSrc || img.src || '';
    if (!src) throw new Error('这张图没有地址');
    const base = (cfg.baseUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('先填 Base URL');
    const url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
    const j = await postJSON(url, {
      model: fixedModel(cfg.model, cfg.baseUrl),
      messages: [
        { role: 'system', content: SYS_VISION },
        { role: 'user', content: [
          { type: 'text', text: '识别并翻译这张图片里的文字，输出 JSON。' },
          { type: 'image_url', image_url: { url: src } }
        ] }
      ],
      max_tokens: 2048,
      temperature: 0.2
    });
    const raw = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!raw) throw new Error('模型没有返回内容（这个模型可能不支持图片）');
    return parseItems(raw);
  }

  function parseItems(raw) {
    let s = String(raw || '').trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const a = s.indexOf('['), b = s.lastIndexOf(']');
    if (a < 0 || b < a) throw new Error('模型没有返回 JSON 数组');
    const arr = JSON.parse(s.slice(a, b + 1));
    if (!Array.isArray(arr)) throw new Error('返回的不是数组');
    return arr.filter((x) => x && Array.isArray(x.box) && x.box.length === 4 && x.tr);
  }

  function wrapLines(ctx, text, maxW) {
    const out = [];
    let line = '';
    for (const ch of String(text)) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = ch; }
      else line = test;
    }
    if (line) out.push(line);
    return out;
  }

  function drawBox(ctx, it, W, H, noSample) {
    const [nx1, ny1, nx2, ny2] = it.box.map(Number);
    const x = nx1 / 1000 * W, y = ny1 / 1000 * H;
    const w = Math.max(10, (nx2 - nx1) / 1000 * W);
    const h = Math.max(10, (ny2 - ny1) / 1000 * H);
    let bg = '#ffffff', fg = '#111111';
    if (!noSample) {
      try {
        const d = ctx.getImageData(Math.max(0, Math.round(x + 1)), Math.max(0, Math.round(y + 1)), 1, 1).data;
        bg = `rgb(${d[0]},${d[1]},${d[2]})`;
        const lum = (d[0] * 299 + d[1] * 587 + d[2] * 114) / 1000;
        fg = lum > 150 ? '#111111' : '#ffffff';
      } catch (_) {}
    }
    ctx.fillStyle = bg;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    const txt = String(it.tr || '').trim();
    if (!txt) return;
    let size = Math.max(11, Math.min(h * 0.8, 48));
    ctx.font = `600 ${size}px -apple-system, "PingFang SC", "Noto Sans CJK SC", sans-serif`;
    let lines = wrapLines(ctx, txt, w);
    while (size > 9 && lines.length * size * 1.25 > h + 2) {
      size -= 1;
      ctx.font = `600 ${size}px -apple-system, "PingFang SC", "Noto Sans CJK SC", sans-serif`;
      lines = wrapLines(ctx, txt, w);
    }
    ctx.fillStyle = fg;
    ctx.textBaseline = 'top';
    const lh = size * 1.22;
    let ty = y + Math.max(0, (h - lines.length * lh) / 2);
    for (const ln of lines) {
      ctx.fillText(ln, x + Math.max(0, (w - ctx.measureText(ln).width) / 2), ty);
      ty += lh;
    }
  }

  async function translateImages(list) {
    const r = ensureShadow();
    const bar = document.createElement('div');
    bar.className = 'hf-pickbar';
    bar.innerHTML = `<span class="msg">准备中…</span>`;
    r.appendChild(bar);
    let ok = 0, fail = 0;
    for (let i = 0; i < list.length; i++) {
      const img = list[i];
      bar.querySelector('.msg').textContent = `翻译中 ${i + 1}/${list.length}…`;
      try {
        const items = await visionOnce(img);
        if (items.length) await renderImage(img, items);
        ok++;
      } catch (e) {
        fail++;
        toast('这张失败：' + String(e.message || e).slice(0, 30), 2000);
      }
    }
    bar.remove();
    toast(fail ? `完成 ${ok} 张，失败 ${fail} 张` : `图片翻译完成，共 ${ok} 张`);
  }

  async function renderImage(img, items) {
    const W = img.naturalWidth || img.width;
    const H = img.naturalHeight || img.height;
    if (!W || !H) throw new Error('图片还没加载完');
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    let noSample = false;
    try { ctx.drawImage(img, 0, 0, W, H); } catch (_) { noSample = true; }
    if (noSample) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); }
    items.forEach((it) => drawBox(ctx, it, W, H, noSample));
    let url;
    try {
      url = cv.toDataURL('image/jpeg', 0.92);
    } catch (_) {
      const cv2 = document.createElement('canvas');
      cv2.width = W; cv2.height = H;
      const c2 = cv2.getContext('2d');
      c2.fillStyle = '#ffffff'; c2.fillRect(0, 0, W, H);
      items.forEach((it) => drawBox(c2, it, W, H, true));
      url = cv2.toDataURL('image/jpeg', 0.92);
    }
    if (!img.dataset.hfOrigSrc) img.dataset.hfOrigSrc = img.src;
    img.src = url;
  }

  function buildMenu() {
    const r = ensureShadow();
    if (menuEl && menuEl.dataset.exp !== String(!!cfg.expImg)) { menuEl.remove(); menuEl = null; }
    if (menuEl && r.contains(menuEl)) return menuEl;
    menuEl = document.createElement('div');
    menuEl.className = 'hf-menu';
    menuEl.innerHTML = `
      <button data-m="translate">翻译本页</button>
      <button data-m="toggleMode" id="hfModeBtn">模式：双语</button>
      <button data-m="restore">恢复原文</button>
      ${cfg.expImg ? '<button data-m="img">图片翻译</button>' : ''}
      <button data-m="diag">诊断</button>
      <button data-m="settings">设置</button>`;
    r.appendChild(menuEl);
    menuEl.dataset.exp = String(!!cfg.expImg);
    menuEl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const m = b.dataset.m;
      if (m === 'translate') { translatePage(); hideMenu(); }
      if (m === 'restore') { restorePage(); hideMenu(); }
      if (m === 'settings') { chrome.runtime.sendMessage({ type: 'openOptions' }); hideMenu(); }
      if (m === 'img') { hideMenu(); startImagePick(); }
      if (m === 'diag') { hideMenu(); showDiag(); }
      if (m === 'toggleMode') {
        const next = cfg.translateMode === 'replace' ? 'both' : 'replace';
        patchConfig({ translateMode: next });
        b.textContent = '模式：' + (next === 'replace' ? '替换' : '双语');
        toast(next === 'replace' ? '已切到替换模式' : '已切到双语模式', 1200);
      }
    });
    return menuEl;
  }

  function showMenu() {
    const r = ensureShadow();
    const m = buildMenu();
    const { x, y, size } = ballPosition();
    m.querySelector('#hfModeBtn').textContent = '模式：' + (cfg.translateMode === 'replace' ? '替换' : '双语');
    const mw = 100, mh = 150;
    let left = cfg.ballSide === 'right' ? x - mw - 8 : x + size + 8;
    left = Math.min(Math.max(6, left), window.innerWidth - mw - 6);
    let top = Math.min(Math.max(6, y), window.innerHeight - mh - 6);
    m.style.left = left + 'px';
    m.style.top = top + 'px';
    m.style.display = 'flex';
    m.style.pointerEvents = 'auto';
    m.classList.add('show');
  }

  function createBall() {
    const r = ensureShadow();
    if (ballEl && r.contains(ballEl)) return;

    ballEl = document.createElement('div');
    ballEl.className = 'hf-ball';
    ballEl.innerHTML = '<div class="ring"></div>';
    r.appendChild(ballEl);

    const { x, y, size } = ballPosition();
    ballEl.style.left = x + 'px';
    ballEl.style.top = y + 'px';
    ballEl.style.width = size + 'px';
    ballEl.style.height = size + 'px';

    let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;

    ballEl.addEventListener('pointerdown', (e) => {
      dragging = true; moved = false;
      sx = e.clientX; sy = e.clientY;
      ox = parseFloat(ballEl.style.left); oy = parseFloat(ballEl.style.top);
      ballEl.classList.add('dragging');
      ballEl.setPointerCapture(e.pointerId);
    });

    ballEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
      const sz = ballEl.offsetWidth;
      const nx = Math.min(Math.max(2, ox + dx), window.innerWidth - sz - 2);
      const ny = Math.min(Math.max(2, oy + dy), window.innerHeight - sz - 2);
      ballEl.style.left = nx + 'px';
      ballEl.style.top = ny + 'px';
    });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      ballEl.classList.remove('dragging');
      const sz = ballEl.offsetWidth;
      const curX = parseFloat(ballEl.style.left);
      const curY = parseFloat(ballEl.style.top);
      // 吸边
      const snapLeft = curX + sz / 2 < window.innerWidth / 2;
      const targetX = snapLeft ? 6 : window.innerWidth - sz - 6;
      ballEl.style.left = targetX + 'px';
      saveBall(targetX, curY);

      if (!moved) {
        if (menuEl && menuEl.classList.contains('show')) hideMenu();
        else showMenu();
      } else {
        hideMenu();
      }
    };
    ballEl.addEventListener('pointerup', endDrag);
    ballEl.addEventListener('pointercancel', endDrag);
  }

  function removeBall() {
    hideMenu();
    if (ballEl && ballEl.parentNode) ballEl.parentNode.removeChild(ballEl);
    ballEl = null;
  }

  /* ================= 配置同步 ================= */
  function applyConfig(next) {
    cfg = { ...cfg, ...(next || {}) };
    if (isTopFrame && cfg.showBall) createBall();
    else removeBall();
  }

  chrome.storage.local.get('config').then((s) => {
    if (s && s.config) applyConfig(s.config);
    else createBall();
  }).catch(() => createBall());

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.config) applyConfig(changes.config.newValue || {});
  });

  /* ================= 消息 ================= */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'translatePage') { translatePage(); sendResponse({ ok: true }); return true; }
    if (msg?.type === 'restorePage') { restorePage(); sendResponse({ ok: true }); return true; }
    if (msg?.type === 'diagPage') {
      try {
        const d = window.__haloflowDiag ? window.__haloflowDiag() : null;
        sendResponse({ ok: true, data: d });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
      return true;
    }
    if (msg?.type === 'status') {
      sendResponse({ ok: true, pageTranslated: state.pageTranslated, translating: state.translating });
      return true;
    }
    if (msg?.type === 'setMode') {
      const next = msg.mode === 'replace' ? 'replace' : 'both';
      cfg.translateMode = next;
      sendResponse({ ok: true });
      // 注意：不能用 cfg 前后比对 —— popup 先发 setConfig 会经 storage.onChanged
      // 提前把 cfg 改掉，导致 prev === next 永远不触发。这里比对"上次实际翻译用的模式"
      const changed = state.lastMode && state.lastMode !== next;
      if (changed && (state.pageTranslated || state.translating)) {
        // 正在翻译也强制中止：先清掉在途请求和已写的内容，再按新模式重来
        runId++;
        abortStreams();
        state.translating = false;
        restorePage(true);
        setTimeout(() => translatePage(false), 320);
      }
      return true;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 't' || e.key === 'T')) { e.preventDefault(); translatePage(); }
    if (e.altKey && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); restorePage(); }
  });

  /* ---- 监听 DOM 新增内容，整页翻译后自动补翻 ---- */
  let moTimer = null;
  const observer = new MutationObserver((muts) => {
    if (!state.pageTranslated || state.translating || !state.autoFollow) return;
    let hasNew = false;

    for (const m of muts) {
      // ① 新增元素节点
      if (m.type === 'childList') {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.id === 'haloflow-host') continue;
          if (n.closest && n.closest('#haloflow-host')) continue;
          if (n.classList && n.classList.contains('haloflow-spin')) continue;
          hasNew = true;
          break;
        }
        if (hasNew) break;
      }
      // ② 文本内容被改写（SPA 切板块最常见的方式）
      if (!hasNew && m.type === 'characterData') {
        const node = m.target;
        const el = node && node.parentElement;
        if (!el) continue;
        if (el.closest('#haloflow-host')) continue;

        const doneEl = el.closest('[data-haloflow-done]');
        if (doneEl) {
          // 有标记不代表没被覆盖：React 重渲染会把译文刷回原文，
          // 只有"当前文本仍等于我们写入的译文"才算正常，否则必须重翻
          const expected = doneEl.getAttribute('data-haloflow-out');
          const now = (doneEl.innerText || '').trim();
          if (expected && now === expected) continue;
        }

        const t = (node.nodeValue || '').trim();
        if (t.length < 2) continue;
        hasNew = true;
      }
      if (hasNew) break;
    }

    if (!hasNew) return;
    clearTimeout(moTimer);
    moTimer = setTimeout(() => {
      if (!state.translating && state.pageTranslated && state.autoFollow) translatePage(true);
    }, 900);
  });
  try {
    observer.observe(document.body || document.documentElement, {
      childList: true, subtree: true, characterData: true
    });
  } catch (_) {}

  /* ---- SPA 路由变化跟随 ---- */
  let lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    if (!state.autoFollow) return;
    clearTimeout(moTimer);
    state.pageTranslated = false;
    setTimeout(() => {
      if (!state.translating) translatePage(true);
    }, 900);
  }, 1000);

  window.addEventListener('resize', () => {
    if (!ballEl) return;
    const { x, y, size } = ballPosition();
    ballEl.style.left = x + 'px';
    ballEl.style.top = y + 'px';
    ballEl.style.width = size + 'px';
    ballEl.style.height = size + 'px';
    hideMenu();
  });
})();
