// ==UserScript==
// @name         HaloFlow 双语翻译
// @namespace    haloflow
// @version      2.1.9
// @description  AI 双语翻译：划词浮窗 + 整页替换/双语 + 悬浮球 + 三套方案（油猴完全体）
// @author       HaloFlow
// @homepageURL  https://relay.example.com/panel
// @updateURL    https://relay.example.com/haloflow.user.js
// @downloadURL  https://relay.example.com/haloflow.user.js
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      relay.example.com
// @connect      api.deepseek.com
// @connect      open.bigmodel.cn
// @connect      api.moonshot.cn
// @connect      api.openai.com
// @connect      api.siliconflow.cn
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  if (window.__haloflowUS) return;
  window.__haloflowUS = true;

  /* ================= 默认配置 ================= */
  const SYS_PROMPT =
    '你是专业的网页翻译引擎，负责把 JSON 数组里的每条文本翻译成{target}。\n\n' +
    '要求：\n' +
    '1）忠实原文：不增删信息，不添加解释或评论；数字、单位、代码、变量名、URL、邮箱、占位符保持原样。\n' +
    '2）表达自然：符合{target}的语言习惯，避免逐字硬译；长句按语义拆分，保持逻辑连贯与指代清晰。\n' +
    '3）术语一致：同一概念在全文中使用同一译法；原文没有明确对应译法时优先意译，不生造词。\n' +
    '4）语气贴合：保留原文的正式、口语、技术、营销等语体特征。\n' +
    '5）格式严格：输出 JSON 字符串数组，条数与输入完全一致且顺序对应；不要 markdown 代码块，不要任何额外文字。';

  function profileTemplate(id, name, o) {
    return Object.assign({
      id, name,
      baseUrl: '', model: 'deepseek-flash', apiKey: '', forwardMode: 'direct',
      targetLang: '简体中文', systemPrompt: SYS_PROMPT,
      pageChunkSize: 24, temperature: 0.2,
      translateMode: 'replace', concurrencyMode: 'auto', maxConcurrency: 4,
      reasoningEffort: 'off'
    }, o || {});
  }

  const DEFAULT_PROFILES = [
    profileTemplate('p1', '默认方案', { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', forwardMode: 'direct' }),
    profileTemplate('p2', '方案 2', {}),
    profileTemplate('p3', '方案 3', {})
  ];
  const DEFAULT_UI = { showBall: true, ballSide: 'right', ballY: 0.62, expImg: false };

  // 想用自己的中转就改这里（留空则只走直连）
  const RELAY_BASE = '';

  /* ================= 配置读写 ================= */
  let store = GM_getValue('haloflow_v2', null);
  if (!store || !Array.isArray(store.profiles) || !store.profiles.length) {
    // 从 1.x 的旧配置迁移（旧 key 是 haloflow_config，直接丢弃会丢配置）
    const legacy = GM_getValue('haloflow_config', null);
    let p1 = DEFAULT_PROFILES[0];
    let ui = Object.assign({}, DEFAULT_UI);
    if (legacy && typeof legacy === 'object') {
      const migrated = {};
      ['baseUrl', 'apiKey', 'model', 'forwardMode', 'targetLang', 'systemPrompt',
       'translateMode', 'temperature', 'pageChunkSize', 'maxConcurrency', 'reasoningEffort']
        .forEach((k) => { if (legacy[k] !== undefined) migrated[k] = legacy[k]; });
      p1 = Object.assign(profileTemplate('p1', '默认方案', migrated), migrated);
      ['showBall', 'ballSide', 'ballY'].forEach((k) => {
        if (legacy[k] !== undefined) ui[k] = legacy[k];
      });
    }
    store = {
      profiles: [p1, DEFAULT_PROFILES[1], DEFAULT_PROFILES[2]],
      activeProfile: 'p1',
      ui
    };
    GM_setValue('haloflow_v2', store);
  }
  // 补齐字段
  store.profiles = store.profiles.map((p, i) => Object.assign(profileTemplate(p.id || ('p' + (i + 1)), p.name || ('方案 ' + (i + 1))), p));
  store.ui = Object.assign({}, DEFAULT_UI, store.ui || {});

  function saveStore() { GM_setValue('haloflow_v2', store); }
  function activeProfile() {
    return store.profiles.find((p) => p.id === store.activeProfile) || store.profiles[0];
  }
  function cfg() { return activeProfile(); }
  function patchProfile(patch) {
    const p = activeProfile();
    Object.assign(p, patch);
    saveStore();
  }

  /* ================= 常量 ================= */
  const SKIP_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','CODE','PRE','KBD','SAMP',
    'TEXTAREA','INPUT','SELECT','OPTION','SVG','CANVAS','IFRAME']);
  const INLINE_TAGS = new Set(['A','SPAN','B','I','EM','STRONG','CODE','SMALL','MARK','ABBR',
    'TIME','SUP','SUB','BR','CITE','Q','S','U','VAR','KBD','SAMP','DFN','BDI','BDO','WBR','IMG','PICTURE','SVG','FONT']);
  const BLOCK_TAGS = new Set(['P','LI','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','TD','TH',
    'FIGCAPTION','DD','DT','SUMMARY','DIV','CAPTION','LABEL','ARTICLE','SECTION']);
  const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, figcaption, dd, dt, summary, div, caption, label';
  const SKIP_SELECTOR = '[translate="no"], .notranslate, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], #haloflow-host';

  /* ================= 样式 ================= */
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .hf-card { position: fixed; pointer-events: auto; max-width: min(340px, calc(100vw - 24px));
      max-height: min(300px, 46vh); overflow: auto; padding: 8px 10px 9px; border-radius: 12px;
      border: 1px solid transparent;
      background: linear-gradient(rgba(9,12,20,.96), rgba(9,12,20,.96)) padding-box,
                  linear-gradient(135deg, rgba(56,240,216,.75), rgba(124,92,255,.55) 55%, rgba(255,92,200,.45)) border-box;
      box-shadow: 0 12px 32px rgba(0,0,0,.6), 0 0 22px rgba(56,240,216,.10);
      backdrop-filter: blur(10px); color: #e8f4ff;
      font: 13px/1.55 -apple-system, "Segoe UI", "PingFang SC", sans-serif;
      opacity: 0; transform: translateY(5px) scale(.985); transition: opacity .15s ease, transform .15s ease; }
    .hf-card.show { opacity: 1; transform: translateY(0) scale(1); }
    .hf-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    .hf-dot { width: 5px; height: 5px; border-radius: 50%; background: #38f0d8; box-shadow: 0 0 7px #38f0d8; }
    .hf-title { font-size: 9px; letter-spacing: .16em; text-transform: uppercase; color: #6d90ac; flex: 1; }
    .hf-btn { border: 1px solid rgba(120,150,190,.3); background: rgba(255,255,255,.035);
      color: #a8c6de; border-radius: 6px; padding: 2px 7px; font-size: 10.5px; line-height: 1.5;
      cursor: pointer; white-space: nowrap; }
    .hf-src { color: #8ea6bc; font-size: 12px; border-left: 2px solid rgba(124,92,255,.6); padding-left: 7px; margin-bottom: 6px; }
    .hf-dst { color: #f2fbff; }
    .hf-loading { color: #7fa8c8; font-size: 12px; }
    .hf-err { color: #ff9bb0; font-size: 12px; }

    .hf-ball { position: fixed; width: 42px; height: 42px; border-radius: 50%; pointer-events: auto;
      cursor: pointer; display: grid; place-items: center; border: 1.5px solid transparent;
      background: linear-gradient(rgba(8,11,18,.82), rgba(8,11,18,.82)) padding-box,
                  linear-gradient(140deg, #38f0d8, #7c5cff 55%, #ff5cc8) border-box;
      box-shadow: 0 4px 16px rgba(0,0,0,.55), 0 0 14px rgba(56,240,216,.35);
      transition: transform .18s cubic-bezier(.3,1.4,.5,1); touch-action: none; user-select: none;
      -webkit-tap-highlight-color: transparent; }
    .hf-ball:active { transform: scale(.92); }
    .hf-ball.dragging { transition: none; }
    .hf-ball .ring { width: 17px; height: 17px; border-radius: 50%; border: 2px solid rgba(56,240,216,.9);
      border-right-color: rgba(124,92,255,.9); border-bottom-color: rgba(255,92,200,.7);
      animation: hfspinslow 4s linear infinite; }
    @keyframes hfspinslow { to { transform: rotate(360deg); } }
    .hf-ball.busy .ring { animation-duration: .9s; border-top-color: #fff; }

    .hf-menu { position: fixed; pointer-events: auto; display: flex; flex-direction: column; gap: 6px;
      padding: 7px; border-radius: 12px; border: 1px solid transparent;
      background: linear-gradient(rgba(9,12,20,.96), rgba(9,12,20,.96)) padding-box,
                  linear-gradient(135deg, rgba(56,240,216,.7), rgba(124,92,255,.55)) border-box;
      box-shadow: 0 12px 30px rgba(0,0,0,.6); opacity: 0; transform: scale(.9);
      transition: opacity .14s, transform .14s; }
    .hf-menu.show { opacity: 1; transform: scale(1); }
    .hf-menu button { pointer-events: auto; min-width: 100px; padding: 7px 11px; border-radius: 8px;
      cursor: pointer; border: 1px solid rgba(120,150,190,.24); background: rgba(255,255,255,.04);
      color: #c6dcee; font-size: 12px; font-family: inherit; text-align: left; }

    .haloflow-spin {
      box-sizing: border-box !important;
      display: inline-block !important;
      flex: 0 0 auto !important;
      align-self: center !important;
      width: 10px !important; height: 10px !important;
      min-width: 10px !important; min-height: 10px !important;
      max-width: 10px !important; max-height: 10px !important;
      aspect-ratio: 1 / 1 !important;
      margin: 0 0 0 5px !important; padding: 0 !important;
      border: 1.6px solid rgba(128,128,128,.28) !important;
      border-top-color: rgba(128,128,128,.8) !important;
      border-radius: 50% !important;
      background: none !important;
      animation: hfspin .8s linear infinite !important;
      vertical-align: middle; pointer-events: none !important;
    }
    @keyframes hfspin { to { transform: rotate(360deg); } }

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

    .hf-toast { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%) translateY(8px);
      pointer-events: none; background: rgba(9,12,20,.96); border: 1px solid rgba(90,230,255,.3);
      color: #dff6ff; padding: 7px 13px; border-radius: 9px;
      font: 12px/1.5 -apple-system, "PingFang SC", sans-serif; opacity: 0; transition: .18s;
      box-shadow: 0 8px 24px rgba(0,0,0,.55); max-width: 78vw; text-align: center; }
    .hf-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

    .hf-panel {
      position: fixed; inset: 0; z-index: 2147483647; pointer-events: auto;
      background: rgba(3,4,9,.72); backdrop-filter: blur(6px);
      display: flex; align-items: center; justify-content: center;
      padding: 10px;
      padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
    }
    .hf-box {
      width: min(560px, 100%);
      max-height: 88vh;                          /* 老浏览器兜底 */
      max-height: calc(100dvh - 20px - env(safe-area-inset-bottom, 0px));
      overflow-y: auto; -webkit-overflow-scrolling: touch;
      overscroll-behavior: contain;
      background: linear-gradient(rgba(12,16,26,.98), rgba(12,16,26,.98)) padding-box,
                  linear-gradient(135deg, rgba(56,240,216,.6), rgba(124,92,255,.5)) border-box;
      border: 1px solid transparent; border-radius: 16px; padding: 16px;
      box-shadow: 0 30px 80px rgba(0,0,0,.7);
      font: 13px/1.6 -apple-system, "PingFang SC", sans-serif; color: #e8f4ff; }
    .hf-box h3 { font-size: 15px; margin-bottom: 12px; color: #dffcff; }
    .hf-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
    .hf-tab { flex: 1 1 0; min-width: 96px; padding: 9px 10px; border-radius: 11px; cursor: pointer;
      background: rgba(255,255,255,.035); border: 1px solid rgba(120,160,210,.18);
      color: #9db4c8; font-size: 12px; text-align: center; }
    .hf-tab.on { background: linear-gradient(100deg, rgba(56,240,216,.16), rgba(124,92,255,.2));
      border-color: rgba(56,240,216,.55); color: #eafffb; font-weight: 600; }
    .hf-tab small { display: block; font-size: 9px; color: #6d8aa2; margin-top: 2px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .hf-tab.on small { color: #9be9df; }
    .hf-field { margin-bottom: 11px; }
    .hf-field label { display: block; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase;
      color: #93aec6; margin-bottom: 4px; }
    .hf-field input, .hf-field textarea, .hf-field select { width: 100%; padding: 8px 10px;
      background: rgba(6,9,16,.72); border: 1px solid rgba(120,160,210,.18); border-radius: 9px;
      color: #e8f4ff; font-family: inherit; font-size: 13px; outline: none; }
    .hf-field textarea { min-height: 80px; resize: vertical; }
    .hf-box textarea#f-io { width: 100%; box-sizing: border-box; min-height: 84px; max-height: 150px;
      margin: 8px 0 4px; padding: 8px 10px; border-radius: 10px; resize: vertical;
      background: rgba(255,255,255,.05); border: 1px solid rgba(120,160,210,.25); color: #dcefff;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .hf-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .hf-keyrow { display: flex; gap: 8px; }
    .hf-keyrow input { flex: 1 1 auto; min-width: 0; }
    .hf-keyrow button {
      flex: 0 0 auto; padding: 0 14px; border-radius: 9px; cursor: pointer;
      border: 1px solid rgba(120,160,210,.24); background: rgba(255,255,255,.05);
      color: #a9c2d8; font-family: inherit; font-size: 12px; white-space: nowrap;
    }
    .hf-hint { font-size: 10.5px; color: #6d8aa2; margin-top: 3px; }
    .hf-actions {
      position: sticky; bottom: -16px;
      display: flex; gap: 10px; flex-wrap: nowrap;
      margin: 14px -16px -16px;
      padding: 10px 16px calc(12px + env(safe-area-inset-bottom, 0px));
      background: linear-gradient(to top, rgba(12,16,26,.99) 55%, rgba(12,16,26,.85) 80%, rgba(12,16,26,0));
    }
    .hf-actions button { flex: 1 1 0; min-width: 0; padding: 10px; border-radius: 10px; cursor: pointer;
      font-family: inherit; font-size: 13px; border: 1px solid rgba(120,150,190,.28);
      background: rgba(255,255,255,.04); color: #c6dcee; white-space: nowrap; }
    .hf-actions button.primary { border: none; color: #04141a; font-weight: 600;
      background: linear-gradient(100deg, #38f0d8, #62d0ff 45%, #a58bff); }
    .hf-extra { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .hf-extra button { flex: 1 1 110px; min-width: 0; padding: 8px; border-radius: 9px; cursor: pointer;
      white-space: nowrap;
      font-family: inherit; font-size: 12px; border: 1px dashed rgba(120,160,210,.25);
      background: rgba(255,255,255,.02); color: #9db4c8; }
    .hf-status { font-size: 11.5px; color: #6d8aa2; margin-top: 8px; min-height: 16px; }
  `;

  /* ================= Shadow ================= */
  let hostEl = null, shadow = null;
  /* ================= 页面内全局样式 =================
     双语译文和 loading 圈是插在页面 DOM 里的，不在 shadow 里，
     所以必须单独往页面 <head> 注入一份，否则等于没样式。 */
  const GLOBAL_CSS = `
    [data-haloflow-tr] {
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
    }
    [data-haloflow-tr]::after {
      content: attr(data-haloflow-tr);
      display: block;
      position: relative;
      z-index: 0;
      margin: 0.22em 0 0;
      padding-left: 0.5em;
      border-left: 2px solid currentColor;
      font-size: 0.86em;
      line-height: 1.5;
      font-style: normal;
      font-weight: inherit;
      letter-spacing: inherit;
      text-align: inherit;
      white-space: normal;
      opacity: 0.62;
    }
    h1[data-haloflow-tr]::after,
    h2[data-haloflow-tr]::after,
    h3[data-haloflow-tr]::after,
    h4[data-haloflow-tr]::after {
      opacity: 0.68;
      font-size: 0.66em;
      margin-top: 0.34em;
      border-left: none;
      padding-left: 0;
      letter-spacing: 0.02em;
    }
    td[data-haloflow-tr]::after,
    th[data-haloflow-tr]::after {
      font-size: 0.82em;
      margin-top: 0.15em;
      border-left-width: 1px;
      padding-left: 0.4em;
    }
    .haloflow-trans {
      margin: 0.25em 0 0;
      padding-left: 0.5em;
      border-left: 2px solid currentColor;
      font-size: 0.86em;
      line-height: 1.5;
      opacity: 0.6;
    }
    .haloflow-spin {
      box-sizing: border-box !important;
      display: inline-block !important;
      flex: 0 0 auto !important;
      align-self: center !important;
      width: 10px !important;
      height: 10px !important;
      min-width: 10px !important;
      min-height: 10px !important;
      max-width: 10px !important;
      max-height: 10px !important;
      aspect-ratio: 1 / 1 !important;
      margin: 0 0 0 6px !important;
      padding: 0 !important;
      border: 1.6px solid rgba(128, 128, 128, 0.28) !important;
      border-top-color: rgba(128, 128, 128, 0.78) !important;
      border-radius: 50% !important;
      background: none !important;
      animation: haloflow-spin 0.8s linear infinite !important;
      vertical-align: middle;
      pointer-events: none !important;
    }
    @keyframes haloflow-spin {
      to { transform: rotate(360deg); }
    }
    [data-haloflow-action] {
      overflow-wrap: break-word;
      word-break: break-word;
      max-width: 100%;
    }
    /* 横排导航 / 按钮：译文并排放在英文右边，掉到下一行会被父容器裁掉 */
    [data-haloflow-tr][data-haloflow-inline]::after {
      display: inline;
      margin: 0 0 0 .38em;
      padding-left: 0;
      border-left: none;
      font-size: 0.78em;
      line-height: inherit;
      white-space: nowrap;
      opacity: 0.72;
    }
  `;

  function injectGlobalCSS() {
    if (document.getElementById('haloflow-global-css')) return;
    try {
      const st = document.createElement('style');
      st.id = 'haloflow-global-css';
      st.textContent = GLOBAL_CSS;
      (document.head || document.documentElement).appendChild(st);
    } catch (_) {}
  }

  function ensureShadow() {
    if (shadow && document.documentElement.contains(hostEl)) return shadow;
    hostEl = document.createElement('div');
    hostEl.id = 'haloflow-host';
    hostEl.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
    (document.body || document.documentElement).appendChild(hostEl);
    shadow = hostEl.attachShadow({ mode: 'open' });
    const st = document.createElement('style');
    st.textContent = CSS;
    shadow.appendChild(st);
    return shadow;
  }
  injectGlobalCSS();

  let toastEl = null;
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

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ================= 请求层 ================= */
  function endpointsOf() {
    const c = cfg();
    const direct = (c.baseUrl || '').replace(/\/+$/, '');
    const mode = c.forwardMode || 'auto';
    const list = [];
    if (mode !== 'direct') list.push({ base: RELAY_BASE, viaRelay: true, directBase: direct });
    if (mode !== 'relay') list.push({ base: direct, viaRelay: false, directBase: direct });
    if (!list.length) list.push({ base: direct, viaRelay: false, directBase: direct });
    return list.filter((e) => e.base);
  }

  // 常见配错：DeepSeek 官方没有 deepseek-flash 这个模型，直连会报 Model Not Exist
  function fixedModel(m, base) {
    const model = String(m || '').trim();
    // 用户填什么就用什么（DeepSeek V4 的正式模型名就是 deepseek-flash / deepseek-v4-pro），
    // 只在留空时给一个默认值
    return model || 'deepseek-flash';
  }

  function buildBody(texts) {
    const c = cfg();
    const sys = (c.systemPrompt || SYS_PROMPT).replace('{target}', c.targetLang || '简体中文');
    const body = {
      model: fixedModel(c.model, c.baseUrl),
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: JSON.stringify(texts) }
      ],
      stream: true
    };
    const effort = c.reasoningEffort || 'off';
    // DeepSeek V4 默认开思考，会把输出预算吃光导致正文为空 —— 明确关掉
    const isDS = /deepseek/i.test(body.model || '');
    if (effort === 'off') {
      body.temperature = Number(c.temperature ?? 0.2);
      if (isDS) body.thinking = { type: 'disabled' };
    } else {
      body.thinking = { type: 'enabled' };
      body.reasoning_effort = effort;
    }
    // 输出预算：以前不传 max_tokens，长段落 + 思考模型容易把正文挤掉，
    // 表现就是"这一整段没翻"
    const totalChars = texts.reduce((n, t) => n + String(t).length, 0);
    body.max_tokens = Math.min(8192, Math.max(2048, 1024 + Math.ceil(totalChars * 1.6)));
    return body;
  }

  function makeParser(onItem) {
    let started = false, inStr = false, esc = false, cur = '', idx = 0;
    return {
      push(chunk) {
        for (let i = 0; i < chunk.length; i++) {
          const ch = chunk[i];
          if (!started) { if (ch === '[') started = true; continue; }
          if (esc) { cur += ch; esc = false; continue; }
          if (ch === '\\') { esc = true; continue; }
          if (ch === '"') {
            if (inStr) { inStr = false; onItem(idx++, cur); cur = ''; }
            else inStr = true;
            continue;
          }
          if (inStr) cur += ch;
        }
      }
    };
  }

  // 最近一次流式请求的元信息（用来给"空内容"一个准确的说法）
  let lastStreamMeta = { reasoning: false, finish: '' };

  // 在途请求（切换模式/恢复原文时统一 abort，别白烧 token）
  const activeReqs = new Set();
  function abortAllReqs() {
    activeReqs.forEach((r) => { try { r && r.abort && r.abort(); } catch (_) {} });
    activeReqs.clear();
  }

  // 单次请求，失败抛错（重试在外层）
  function requestOnce(texts, onItem, ctrl, meta) {
    const eps = endpointsOf();
    let epIdx = 0;

    return new Promise((resolve, reject) => {
      let emitted = false;
      let settled = false;
      let idleTimer = 0;
      const ok = () => { if (settled) return; settled = true; clearTimeout(idleTimer); resolve(); };
      const bad = (e) => { if (settled) return; settled = true; clearTimeout(idleTimer); reject(e); };
      // 空闲超时（不是总时长）：只要还有新数据进来就一直等，
      // 连续 75 秒一个字节都没有才算挂——长文档慢慢输出不会被误杀
      const kick = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => bad(new Error('请求超时（75 秒没有新数据）')), 75000);
      };
      kick();

      const next = (err) => {
        // 4xx 是请求本身的问题（模型名/Key/参数），换端点也没用，别白试
        if (err && /^HTTP (400|401|403|404|422)/.test(String(err.message || ''))) return bad(err);
        epIdx++;
        if (epIdx >= eps.length || emitted) return bad(err || new Error('请求失败'));
        go();
      };

      function go() {
        if (meta) { meta.reasoning = false; meta.finish = ''; }
        const ep = eps[epIdx];
        const url = ep.base.match(/\/chat\/completions$/) ? ep.base : ep.base + '/chat/completions';
        const headers = {
          'Content-Type': 'application/json',
          ...(cfg().apiKey ? { Authorization: 'Bearer ' + cfg().apiKey } : {}),
          ...(ep.viaRelay && ep.directBase ? { 'X-Halo-Upstream': ep.directBase } : {})
        };

        let seen = 0, buf = '';
        const parser = makeParser((i, t) => { emitted = true; onItem(i, t); });

        // 统一解析入口：onprogress 和 onload 都走这里。
        // 手机上的 Tampermonkey 有时根本不给 onprogress，内容全在 onload 的
        // responseText 里 —— 只解析 progress 就会「一个字都没有」。
        const feed = (res) => {
          const full = (res && res.responseText) || '';
          if (!full || full.length <= seen) return;
          kick();
          buf += full.slice(seen);
          seen = full.length;
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const p = line.slice(5).trim();
            if (!p || p === '[DONE]') continue;
            try {
              const j = JSON.parse(p);
              const ch = j && j.choices && j.choices[0];
              if (ch) {
                if (meta && ch.finish_reason) meta.finish = ch.finish_reason;
                if (meta && ch.delta && ch.delta.reasoning_content) meta.reasoning = true;
                const d = ch.delta && ch.delta.content;
                if (d) parser.push(d);
              }
            } catch (_) {}
          }
        };

        // 非流式兜底：整个响应就是一包 JSON（有些中转/代理这么回）
        const feedWhole = (res) => {
          if (emitted) return;
          const full = (res && res.responseText) || '';
          if (!full.trim().startsWith('{')) return;
          try {
            const j = JSON.parse(full);
            const ch = j && j.choices && j.choices[0];
            const c = ch && ((ch.message && ch.message.content) || (ch.delta && ch.delta.content));
            if (c) parser.push(c);
          } catch (_) {}
        };

        const req = GM_xmlhttpRequest({
          method: 'POST',
          url,
          headers,
          data: JSON.stringify(buildBody(texts)),
          timeout: 90000,
          onprogress: feed,
          onload: (res) => {
            activeReqs.delete(req);
            if (meta) meta.text = String((res && res.responseText) || '').slice(-4000);
            feed(res);        // 兜底：没有 onprogress 时内容都在这里
            feedWhole(res);   // 兜底：整包 JSON 的返回
            const st = res && typeof res.status === 'number' ? res.status : 200;
            // HTTP 错误以前被当成功 → 一个字都没翻，最后显示「共 0 段」
            if (st && (st < 200 || st >= 300)) {
              let msg = '';
              try {
                const j = JSON.parse(res.responseText || '');
                msg = (j.error && (j.error.message || j.error.code)) || j.message || '';
              } catch (_) { msg = String(res.responseText || '').slice(0, 100); }
              return next(new Error('HTTP ' + st + (msg ? ' ' + String(msg).slice(0, 160) : '')));
            }
            ok();
          },
          onerror: () => { activeReqs.delete(req); next(new Error('网络错误')); },
          ontimeout: () => { activeReqs.delete(req); next(new Error('请求超时')); },
          onabort: () => { activeReqs.delete(req); bad(new Error('已中断')); }
        });

        if (req) activeReqs.add(req);
      }

      go();
    });
  }

  /* ================= DOM 工具 ================= */
  function textNodesOf(el) {
    const nodes = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = w.nextNode())) if (n.nodeValue && n.nodeValue.trim().length) nodes.push(n);
    return nodes;
  }
  function acceptText(t, minLen) {
    if (t.length < minLen || t.length > 1200) return false;
    if (!/[\p{L}]/u.test(t)) return false;
    if (/^[\u4e00-\u9fa5\s\p{P}\d]+$/u.test(t)) return false;
    const cjk = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
    const kana = (t.match(/[\u3040-\u30ff]/g) || []).length;
    // 有假名就是日语：汉字再多也不能当成"已经是中文"跳过
    if (kana === 0 && cjk / t.length > 0.4) return false;
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
  function hasBlockChild(el) {
    const kids = el.children;
    for (let i = 0; i < kids.length; i++) if (BLOCK_TAGS.has(kids[i].tagName)) return true;
    return false;
  }
  function isLeafLike(el) {
    const kids = el.children;
    if (kids.length > 8) return false;
    for (let i = 0; i < kids.length; i++) if (!INLINE_TAGS.has(kids[i].tagName)) return false;
    return true;
  }

  /* ================= 状态 ================= */
  const state = { translating: false, pageTranslated: false, autoFollow: false, pending: false };
  let runId = 0;
  const replacedEls = new Map();
  const bilingualEls = new Set();
  let cache = new Map(Object.entries(GM_getValue('haloflow_cache', {}) || {}));

  function saveCache() {
    const entries = [...cache.entries()].slice(-1200);
    cache = new Map(entries);
    GM_setValue('haloflow_cache', Object.fromEntries(entries));
  }

  /* ================= 收集 ================= */
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
    const attrSeen = new WeakMap();
    const roots = allRoots();

    for (const root of roots) {
      root.querySelectorAll(BLOCK_SELECTOR).forEach((el) => {
        if (seen.has(el)) return;
        if (!BLOCK_TAGS.has(el.tagName)) return;
        if (hasBlockChild(el)) { bump('blockChild'); return; }
      if (isRowNav(el)) { bump('rowNav'); return; }   // 导航条交给里面的链接
      if (looksLikeCards(el)) { bump('cards'); return; }  // 卡片网格交给里面的卡片
        try { if (el.closest(SKIP_SELECTOR)) { bump('skipSel'); return; } } catch (_) { return; }
        if (SKIP_TAGS.has(el.tagName)) { bump('skipTag'); return; }
        if (!isLeafLike(el)) { bump('notLeaf'); return; }
        // 有 done 标记但译文已经没了（上次失败/被页面重渲染）→ 清标记重新翻
        const prevOut = el.getAttribute('data-haloflow-out');
        if (prevOut && (el.innerText || '').trim() === prevOut) { bump('done'); return; }
        if (el.hasAttribute('data-haloflow-done')) {
          el.removeAttribute('data-haloflow-done');
          el.removeAttribute('data-haloflow-tr');
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
        out.push({ el, text: t, kind: nodes.length === 1 ? 'pure' : 'mixed', nodes });
      });

      root.querySelectorAll('a, button, [role="button"]').forEach((el) => {
        if (seen.has(el)) return;
        if (SKIP_TAGS.has(el.tagName)) return;
        try { if (el.closest(SKIP_SELECTOR)) return; } catch (_) { return; }
        const prevOut2 = el.getAttribute('data-haloflow-out');
        if (prevOut2 && (el.innerText || '').trim() === prevOut2) return;
        if (el.hasAttribute('data-haloflow-done')) {
          el.removeAttribute('data-haloflow-done');
          el.removeAttribute('data-haloflow-tr');
          el.removeAttribute('data-haloflow-out');
        }
        if (hasBlockChild(el)) return;
        if (!isVisible(el)) return;
        let p = el.parentElement;
        while (p) { if (seen.has(p)) return; p = p.parentElement; }
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!acceptText(t, 2) || t.length > 120) return;
        const nodes = textNodesOf(el);
        if (!nodes.length) return;
        seen.add(el);
        out.push({ el, text: t, kind: 'action', nodes });
      });

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
          if (el.getAttribute('data-haloflow-attr-' + attr) === raw) return;
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
        // 已经有块翻过这里 → 不重复
        let hit = false, q = p;
        while (q) { if (covered.has(q)) { hit = true; break; } q = q.parentElement; }
        if (hit) continue;
        if (SKIP_TAGS.has(p.tagName)) continue;
        try { if (p.closest(SKIP_SELECTOR)) continue; } catch (_) { continue; }
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

  // 排查用：控制台执行 __haloflowDiag() 能看到「为什么 0 段」
  window.__haloflowDiag = () => {
    const list = collectBlocks();
    const c = cfg();
    return {
      total: list.length,
      loose: !!diag.looseTried,
      diag: Object.assign({}, diag),
      sample: list.slice(0, 5).map((b) => b.text.slice(0, 60)),
      rejected: Object.assign({}, rejected),
      mode: c.translateMode,
      baseUrl: c.baseUrl,
      model: c.model,
      hasKey: !!c.apiKey,
      keyLen: (c.apiKey || '').length
    };
  };

  /* ================= 写回 ================= */
  // 译文该并排到右边（横排导航 / 按钮 / 单行 nowrap），还是正常换到下一行？
  function wantsInline(el, kind) {
    try {
      const t = (el.innerText || '').trim();
      if (t.length > 60) return false;           // 长段落老老实实换行
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
      // 又矮又短的单行小条目（导航 li / 标签 / 面包屑）：并排才不会被裁
      const r2 = el.getBoundingClientRect();
      if (r2.height && r2.height <= 34 && t.length <= 24) return true;
    } catch (_) {}
    return false;
  }

  function applyTranslation(block, tr, mode) {
    const { el, nodes } = block;

    if (block.kind === 'attr') {
      const key = 'data-haloflow-attr-' + block.attr;
      const srcKey = 'data-haloflow-attr-src-' + block.attr;
      if (!el.hasAttribute(srcKey)) el.setAttribute(srcKey, el.getAttribute(block.attr) || '');
      el.setAttribute(block.attr, tr);
      el.setAttribute(key, tr);
      return;
    }

    if (mode === 'replace') {
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
      return;
    }

    if (wantsInline(el, block.kind)) el.setAttribute('data-haloflow-inline', '1');
    else el.removeAttribute('data-haloflow-inline');
    el.setAttribute('data-haloflow-tr', tr);
    el.setAttribute('data-haloflow-done', '1');
    bilingualEls.add(el);
  }

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

  function addSpinner(b) {
    if (b._spin || b.el.hasAttribute('data-haloflow-tr') || b.kind === 'attr') return;
    // 兜底模式下多个文本节点共用一个父元素，别叠出一堆圈；
    // 但要把已经存在的那个记下来，否则后面 drop 不掉（这就是「圈卡住」的根因）
    try {
      const exist = b.el.querySelector(':scope > .haloflow-spin');
      if (exist) { b._spin = exist; return; }
    } catch (_) {}
    const sp = document.createElement('span');
    sp.className = 'haloflow-spin';
    sp.setAttribute('aria-hidden', 'true');
    b.el.appendChild(sp);
    b._spin = sp;
  }
  // 收尾兜底：不管哪条路径结束，页面上不该再挂着圈
  function clearAllSpinners() {
    try {
      document.querySelectorAll('.haloflow-spin').forEach((n) => { try { n.remove(); } catch (_) {} });
    } catch (_) {}
  }

  function dropSpinner(b) {
    if (b._spin) { try { b._spin.remove(); } catch (_) {} b._spin = null; }
    // 兜底：不管这个圈是哪一轮加的，只要挂在这个元素上就收掉
    try {
      const rest = b.el.querySelectorAll(':scope > .haloflow-spin');
      for (let i = 0; i < rest.length; i++) rest[i].remove();
    } catch (_) {}
  }

  /* ================= 跨 frame ================= */
  // 很多站在 iframe 里塞商品/评论模块，主文档点"翻译本页"时要把它们也带上
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

  /* ================= 整页翻译 ================= */
  let translatingSince = 0;
  let lastProgressAt = 0;
  async function translatePage(silent) {
    // 卡死兜底：不是按总时长，而是「多久没有新进展」。
    // 大页面正常跑 2 分钟很正常，按总时长会把好活杀掉。
    if (state.translating) {
      const idle = Date.now() - Math.max(translatingSince, lastProgressAt);
      if (idle > 90000) {
        runId++;
        abortAllReqs();
        state.translating = false;
        setBusy(false);
      } else {
        return silent || toast('正在翻译中…');
      }
    }
    translatingSince = Date.now();
    lastProgressAt = Date.now();
    const myRun = ++runId;
    const c = cfg();
    const mode = c.translateMode === 'both' ? 'both' : 'replace';
    // 没填 key 就直接说清楚，别发一堆注定 401 的请求（以前会显示「共 0 段」）
    if (!c.apiKey) {
      return toast('还没填 API Key 喵：点悬浮球 → 设置，填好再点翻译', 4200);
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
        // 标记残留但收集不到，说明状态卡住了，直接清一次再试
        document.querySelectorAll('[data-haloflow-done]').forEach((el) => {
          el.removeAttribute('data-haloflow-done');
          el.removeAttribute('data-haloflow-tr');
          el.removeAttribute('data-haloflow-out');
        });
        return silent || toast(`发现 ${stuck} 个残留标记，已清理，请再点一次翻译`, 2600);
      }
      const dt = diagText();
      return silent || toast(`这一页没找到可翻的段落${dt ? '（' + dt + '）' : ''}`, 3200);
    }

    // 上一轮被打断时可能留下没人收的圈，先扫干净（不然越滚越多，看着像卡死）
    {
      const mine = new Set(blocks.map((b) => b.el));
      document.querySelectorAll('.haloflow-spin').forEach((n) => {
        const p = n.parentElement;
        if (!p || !mine.has(p)) { try { n.remove(); } catch (_) {} }
      });
    }

    state.translating = true;
    setBusy(true);
    devLog('info', 'start ' + blocks.length + ' blocks, mode=' + mode);
    if (!fromParent) broadcastFrames({ haloflow: 'translate' });
    blocks.slice(0, 40).forEach(addSpinner);
    if (!silent) toast(`开始翻译 ${blocks.length} 段…`, 1200);

    // 长短分组
    const short = blocks.filter((b) => b.text.length <= 80);
    const long = blocks.filter((b) => b.text.length > 80);

    // 批次自适应
    const totalLen = blocks.reduce((n, b) => n + b.text.length, 0);
    const avgLen = totalLen / Math.max(1, blocks.length);
    const autoBatch = avgLen > 250 ? 6 : avgLen > 120 ? 10 : avgLen > 60 ? 16 : 24;
    const batch = Math.min(autoBatch, Number(c.pageChunkSize || 24) || 24);
    const longBatch = Math.max(4, Math.min(8, Math.round(batch * 0.6)));

    // 并发
    const autoConc = blocks.length > 120 ? 6 : blocks.length > 60 ? 5 : blocks.length > 30 ? 3 : 2;
    const conc = c.concurrencyMode === 'manual'
      ? Math.max(1, Math.min(8, Number(c.maxConcurrency || 2)))
      : autoConc;
    const shortConc = Math.max(1, Math.floor(conc / 2));
    const longConc = Math.max(1, conc - shortConc);

    // 首屏小批
    const FIRST = 5;
    // 短文本也按字符数分批：24 条挤一批容易输出超长被截断
    const shortGroups = short.length > FIRST * 2
      ? [short.slice(0, FIRST)].concat(chunkByChars(short.slice(FIRST), 1200))
      : chunkByChars(short, 1200);
    const longGroups = chunkByChars(long, 1500);   // 长段落按字符数分，别挤在一批

    let done = 0, failed = 0, lastError = '';

    async function runQueue(groups, concurrency) {
      let cursor = 0;
      async function worker() {
        while (cursor < groups.length) {
          if (myRun !== runId) return;
          const g = groups[cursor++];

          const todo = [];
          const huge = [];
          for (const b of g) {
            const hit = cache.get(b.text);
            if (hit) { dropSpinner(b); applyTranslation(b, hit, mode); done++; lastProgressAt = Date.now(); }
            else if ((b.text || '').length > 520) huge.push(b);   // 超长段落单独拆开翻
            else todo.push(b);
          }
          for (const b of huge) {
            const parts = splitLongText(b.text, 520);
            let merged = '';
            try {
              for (const part of parts) {
                if (myRun !== runId) break;
                let got = '';
                await requestOnce([part], (i, t) => { if (t) got = t; });
                merged += got;
              }
              if (merged.trim()) {
                dropSpinner(b);
                cache.set(b.text, merged);
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
          if (!todo.length) continue;

          let remaining = todo, attempt = 0, okThisRound = 0;
          while (attempt < 3) {
            try {
              const base = remaining;
              okThisRound = 0;
              const meta = {};
              await requestOnce(base.map((b) => b.text), (i, tr) => {
                if (myRun !== runId) return;
                const b = base[i];
                if (!b || !tr) return;
                dropSpinner(b);
                cache.set(b.text, tr);
                applyTranslation(b, tr, mode);
                okThisRound++; done++; lastProgressAt = Date.now();
                if (!silent) toast(`翻译中 ${done + failed}/${blocks.length}…`, 300);
              }, null, meta);
              saveCache();
              if (!okThisRound) {
                const raw = meta.text || '';
                const why = /"finish_reason"\s*:\s*"length"/.test(raw)
                  ? '输出被截断（max_tokens 不够，试试调小每批段数）'
                  : /reasoning_content/.test(raw)
                    ? '模型只吐了思考过程（把思考深度设为「关闭」）'
                    : '模型返回了空内容';
                throw new Error(why);
              }
              break;
            } catch (e) {
              if (myRun !== runId) return;
              devLog('err', String((e && e.message) || e).slice(0, 160));
              // 模型名 / Key / 参数这类硬错误，重试也是白烧 token，直接记账
              if (/^HTTP (400|401|403|404|422)/.test(String((e && e.message) || ''))) {
                failed += remaining.length;
                const cur = cfg();
                lastError = String((e && e.message) || e) + '（模型 ' + fixedModel(cur.model, cur.baseUrl) + '）';
                remaining.forEach(dropSpinner);
                break;
              }
              attempt++;
              if (okThisRound > 0) remaining = remaining.slice(okThisRound);
              if (attempt < 3) {
                if (!silent) toast(`重试 ${attempt}（${String(e.message || e).slice(0, 24)}）…`, 1200);
                await sleep(700 * attempt * attempt);
              } else {
                failed += remaining.length;
                lastError = String((e && e.message) || e || '未知错误');
                remaining.forEach(dropSpinner);
              }
            }
          }
          if (myRun !== runId) return;
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, groups.length || 1) }, () => worker()));
    }

    await Promise.all([
      runQueue(shortGroups, shortConc),
      runQueue(longGroups, longConc)
    ]);

    if (myRun !== runId) {
      // 被新一轮顶掉了：一定要收拾自己的圈，否则页面会卡一圈灰点
      blocks.forEach(dropSpinner);
      clearAllSpinners();
      state.translating = false;
      setBusy(false);
      return;
    }
    state.translating = false;
    setBusy(false);
    state.pageTranslated = true;
    state.autoFollow = true;
    blocks.forEach(dropSpinner);
    clearAllSpinners();
    // 翻译期间又蹭出新内容 → 收尾后再补一轮
    if (state.pending) {
      state.pending = false;
      setTimeout(() => { if (!state.translating) translatePage(true); }, 250);
    }
    if (!silent) {
      if (!done && !failed) toast('一段都没翻成：检查 API 地址 / Key / 模型名', 4200);
      else if (!done) toast(`全部失败（${failed} 段）：${lastError.slice(0, 120)}`, 6000);
      else if (failed) toast(`完成，${failed} 段失败${lastError ? '：' + lastError.slice(0, 80) : ''}`, 4000);
      else toast(`全部完成，共 ${done} 段`);
    }
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

  function chunkList(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  function restorePage(silent) {
    runId++;
    abortAllReqs();
    state.translating = false;
    setBusy(false);
    broadcastFrames({ haloflow: 'restore' });
    bilingualEls.forEach((el) => {
      if (el && el.isConnected) {
        el.removeAttribute('data-haloflow-tr');
        el.removeAttribute('data-haloflow-done');
        el.removeAttribute('data-haloflow-inline');
      }
    });
    bilingualEls.clear();

    replacedEls.forEach((saved, el) => {
      if (!el || !el.isConnected) return;
      if (saved.single) saved.single.nodeValue = saved.text;
      else if (saved.nodes) {
        const cur = textNodesOf(el);
        saved.nodes.forEach((v, i) => { if (cur[i]) cur[i].nodeValue = v; });
      }
      el.removeAttribute('data-haloflow-done');
      el.removeAttribute('data-haloflow-out');
    });
    replacedEls.clear();

    ['title', 'alt', 'placeholder', 'aria-label'].forEach((attr) => {
      document.querySelectorAll('[data-haloflow-attr-src-' + attr + ']').forEach((el) => {
        const orig = el.getAttribute('data-haloflow-attr-src-' + attr);
        if (orig !== null) el.setAttribute(attr, orig);
        el.removeAttribute('data-haloflow-attr-' + attr);
        el.removeAttribute('data-haloflow-attr-src-' + attr);
      });
    });

    state.pageTranslated = false;
    state.autoFollow = false;
    if (!silent) toast('已恢复原文');
  }

  /* ================= 划词浮窗 ================= */
  let popup = null;
  function closePopup() {
    if (popup && popup.parentNode) popup.parentNode.removeChild(popup);
    popup = null;
  }

  function showPopup(rect, srcText) {
    const r = ensureShadow();
    closePopup();
    popup = document.createElement('div');
    popup.className = 'hf-card';
    popup.innerHTML = `
      <div class="hf-head">
        <span class="hf-dot"></span>
        <span class="hf-title">HaloFlow</span>
        <button class="hf-btn" data-act="close">✕</button>
      </div>
      <div class="hf-src"></div>
      <div class="hf-dst hf-loading">翻译中…</div>`;
    popup.querySelector('.hf-src').textContent = srcText;

    const pad = 8;
    const w = Math.min(340, window.innerWidth - pad * 2);
    popup.style.width = w + 'px';
    popup.style.left = Math.min(Math.max(pad, rect.left), window.innerWidth - w - pad) + 'px';
    popup.style.top = (rect.bottom + 10) + 'px';
    r.appendChild(popup);
    requestAnimationFrame(() => popup.classList.add('show'));
    popup.querySelector('[data-act="close"]').addEventListener('click', closePopup);

    const dst = popup.querySelector('.hf-dst');
    const hit = cache.get(srcText);
    if (hit) { dst.className = 'hf-dst'; dst.textContent = hit; return; }

    requestOnce([srcText], (i, t) => {
      if (i === 0 && t) {
        dst.className = 'hf-dst';
        dst.textContent = t;
        cache.set(srcText, t);
        saveCache();
      }
    }).catch((e) => { dst.className = 'hf-err'; dst.textContent = '出错了：' + e.message; });
  }

  document.addEventListener('mouseup', (e) => {
    if (popup && popup.contains(e.target)) return;
    if (hostEl && e.composedPath && e.composedPath().includes(hostEl)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = (sel && sel.toString() || '').trim();
      if (!text || text.length < 2 || text.length > 4000) return;
      if (!/[\p{L}]/u.test(text)) return;
      if (/^[\u4e00-\u9fa5\s\p{P}]+$/u.test(text)) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;
      showPopup(rect, text);
    }, 10);
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (!popup) return;
    if (e.composedPath && e.composedPath().includes(hostEl)) return;
    closePopup();
  }, true);

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

  function postJSON(url, body, extraHeaders) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {}),
        data: JSON.stringify(body),
        timeout: 120000,
        onload: (res) => {
          const st = (res && typeof res.status === 'number') ? res.status : 200;
          if (st && (st < 200 || st >= 300)) {
            let m = '';
            try { const j = JSON.parse(res.responseText || ''); m = (j.error && j.error.message) || j.message || ''; } catch (_) { m = String(res.responseText || '').slice(0, 80); }
            return reject(new Error('HTTP ' + st + ' ' + m));
          }
          try { resolve(JSON.parse(res.responseText || '{}')); } catch (_) { reject(new Error('返回不是 JSON')); }
        },
        onerror: () => reject(new Error('网络错误')),
        ontimeout: () => reject(new Error('超时'))
      });
    });
  }

  function getModels(base, key) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: base + '/models',
        headers: key ? { Authorization: 'Bearer ' + key } : {},
        timeout: 20000,
        onload: (res) => {
          const st = (res && res.status) || 0;
          if (st && (st < 200 || st >= 300)) return reject(new Error('HTTP ' + st));
          try {
            const j = JSON.parse(res.responseText || '{}');
            const arr = j.data || j.models || [];
            resolve(arr.map((m) => (typeof m === 'string' ? m : (m.id || m.name))).filter(Boolean));
          } catch (_) { reject(new Error('返回不是 JSON')); }
        },
        onerror: () => reject(new Error('网络错误')),
        ontimeout: () => reject(new Error('超时'))
      });
    });
  }

  function visionEndpoints() {
    const c = cfg();
    const direct = (c.baseUrl || '').replace(/\/+$/, '');
    const mode = c.forwardMode || 'auto';
    const list = [];
    if (mode !== 'direct') list.push({ base: RELAY_BASE, upstream: direct });
    if (mode !== 'relay') list.push({ base: direct, upstream: '' });
    return list.filter((e) => e.base).map((e) => ({
      url: /\/chat\/completions$/.test(e.base) ? e.base : e.base + '/chat/completions',
      upstream: e.upstream
    }));
  }

  async function visionOnce(img) {
    const c = cfg();
    let src = img.currentSrc || img.src || '';
    if (!src) throw new Error('这张图没有地址');
    let lastErr = null;
    for (const ep of visionEndpoints()) {
      try {
        const headers = {};
        if (c.apiKey) headers.Authorization = 'Bearer ' + c.apiKey;
        if (ep.upstream) headers['X-Halo-Upstream'] = ep.upstream;
        const j = await postJSON(ep.url, {
          model: fixedModel(c.model, c.baseUrl),
          messages: [
            { role: 'system', content: SYS_VISION },
            { role: 'user', content: [
              { type: 'text', text: '识别并翻译这张图片里的文字，输出 JSON。' },
              { type: 'image_url', image_url: { url: src } }
            ] }
          ],
          max_tokens: 2048,
          temperature: 0.2
        }, headers);
        const raw = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!raw) throw new Error('模型没有返回内容（这个模型可能不支持图片）');
        return parseItems(raw);
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('请求失败');
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
      // 跨域图片被污染 → 退化成「白底 + 译文」
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

  /* ================= 诊断（悬浮球里一键出报告） ================= */
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
    const c = cfg();
    return {
      app: 'haloflow-userscript',
      version: (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '?',
      ts: new Date().toISOString(),
      url: location.href,
      ua: navigator.userAgent,
      cfg: {
        baseUrl: c.baseUrl || '',
        model: c.model || '',
        mode: c.translateMode || '',
        fwd: c.forwardMode || '',
        keyLen: (c.apiKey || '').length
      },
      cacheSize: (typeof cache !== 'undefined' && cache) ? cache.size : -1,
      collect: collect,
      logs: DEV_LOGS.slice(-200)
    };
  }

  function reportToText(r) {
    const lines = [];
    lines.push('HaloFlow 诊断报告');
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
      lines.push('收集信息不可用（页面还没执行过收集）');
    }
    if (r.logs && r.logs.length) {
      lines.push('--- 日志（' + r.logs.length + '）---');
      r.logs.slice(-60).forEach((l) => lines.push('[' + l.l + '] ' + l.m));
    }
    return lines.join('\n');
  }

  function sendDiag(obj) {
    return new Promise((resolve, reject) => {
      const base = RELAY_BASE.replace(/\/v1\/?$/, '');
      GM_xmlhttpRequest({
        method: 'POST',
        url: base + '/log',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(obj),
        timeout: 25000,
        onload: (r) => {
          const st = (r && r.status) || 0;
          if (st >= 200 && st < 300) resolve(String(r.responseText || '').slice(0, 200));
          else reject(new Error('HTTP ' + st));
        },
        onerror: () => reject(new Error('网络错误')),
        ontimeout: () => reject(new Error('超时'))
      });
    });
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
        toast('已复制，粘给我就行');
      } catch (_) { toast('复制失败，手动长按选中'); }
    });
    diagEl.querySelector('.send').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = '发送中…';
      try {
        await sendDiag(report);
        btn.textContent = '已发送 ✓';
        toast('诊断已发到中转站，告诉我一声我就去读');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '发送失败，重试';
        toast('发送失败：' + String(err.message || err).slice(0, 40));
      }
    });
  }

  /* ================= 悬浮球 ================= */
  let ballEl = null, menuEl = null;

  function ballPos() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const size = vw <= 480 ? 38 : 42;
    const x = store.ui.ballSide === 'left' ? 6 : vw - size - 6;
    const y = Math.min(Math.max(8, vh * (store.ui.ballY || 0.62) - size / 2), vh - size - 8);
    return { x, y, size };
  }
  function hideMenu() {
    if (!menuEl) return;
    menuEl.classList.remove('show');
    // 避免"看不见但点得到"：直接 display:none
    menuEl.style.display = 'none';
    menuEl.style.pointerEvents = 'none';
  }

  function showMenu() {
    const r = ensureShadow();
    if (menuEl && menuEl.dataset.exp !== String(!!store.ui.expImg)) { menuEl.remove(); menuEl = null; }
    if (menuEl && menuEl.dataset) menuEl.dataset.exp = String(!!store.ui.expImg);
    if (!menuEl || !r.contains(menuEl)) {
      menuEl = document.createElement('div');
      menuEl.className = 'hf-menu';
      menuEl.innerHTML = `
        <button data-m="translate">翻译本页</button>
        <button data-m="mode">模式：替换</button>
        <button data-m="restore">恢复原文</button>
        ${store.ui.expImg ? '<button data-m="img">图片翻译</button>' : ''}
        <button data-m="diag">诊断</button>
        <button data-m="settings">设置</button>`;
      r.appendChild(menuEl);
      menuEl.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const m = b.dataset.m;
        if (m === 'translate') { translatePage(); hideMenu(); }
        if (m === 'restore') { restorePage(); hideMenu(); }
        if (m === 'settings') { openPanel(); hideMenu(); }
        if (m === 'img') { hideMenu(); startImagePick(); }
        if (m === 'diag') { hideMenu(); showDiag(); }
        if (m === 'mode') {
          const next = cfg().translateMode === 'both' ? 'replace' : 'both';
          patchProfile({ translateMode: next });
          b.textContent = '模式：' + (next === 'both' ? '双语' : '替换');
          if (state.pageTranslated || state.translating) {
            runId++;
            abortAllReqs();
            state.translating = false;
            setBusy(false);
            restorePage(true);
            setTimeout(() => translatePage(true), 320);
            toast(next === 'both' ? '已切到双语，正在重翻…' : '已切到替换，正在重翻…', 1200);
          } else {
            toast(next === 'both' ? '已切到双语' : '已切到替换');
          }
        }
      });
    }
    menuEl.querySelector('[data-m="mode"]').textContent =
      '模式：' + (cfg().translateMode === 'both' ? '双语' : '替换');
    const { x, y, size } = ballPos();
    const mw = 110, mh = 160;
    let left = store.ui.ballSide === 'right' ? x - mw - 8 : x + size + 8;
    left = Math.min(Math.max(6, left), window.innerWidth - mw - 6);
    const top = Math.min(Math.max(6, y), window.innerHeight - mh - 6);
    menuEl.style.left = left + 'px';
    menuEl.style.top = top + 'px';
    menuEl.style.display = 'flex';
    menuEl.style.pointerEvents = 'auto';
    menuEl.classList.add('show');
  }

  function createBall() {
    const r = ensureShadow();
    if (ballEl) ballEl.remove();
    ballEl = document.createElement('div');
    ballEl.className = 'hf-ball';
    ballEl.innerHTML = '<div class="ring"></div>';
    r.appendChild(ballEl);

    const { x, y, size } = ballPos();
    ballEl.style.cssText += `left:${x}px;top:${y}px;width:${size}px;height:${size}px;`;

    let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    ballEl.addEventListener('pointerdown', (e) => {
      dragging = true; moved = false;
      sx = e.clientX; sy = e.clientY;
      ox = parseFloat(ballEl.style.left); oy = parseFloat(ballEl.style.top);
      ballEl.classList.add('dragging');
      try { ballEl.setPointerCapture(e.pointerId); } catch (_) {}
    });
    ballEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
      const sz = ballEl.offsetWidth;
      ballEl.style.left = Math.min(Math.max(2, ox + dx), window.innerWidth - sz - 2) + 'px';
      ballEl.style.top = Math.min(Math.max(2, oy + dy), window.innerHeight - sz - 2) + 'px';
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      ballEl.classList.remove('dragging');
      const sz = ballEl.offsetWidth;
      const curX = parseFloat(ballEl.style.left), curY = parseFloat(ballEl.style.top);
      const snapLeft = curX + sz / 2 < window.innerWidth / 2;
      const tx = snapLeft ? 6 : window.innerWidth - sz - 6;
      ballEl.style.left = tx + 'px';
      store.ui.ballSide = snapLeft ? 'left' : 'right';
      store.ui.ballY = Math.min(0.95, Math.max(0.05, (curY + sz / 2) / window.innerHeight));
      saveStore();
      if (!moved) { (menuEl && menuEl.classList.contains('show')) ? hideMenu() : showMenu(); }
      else hideMenu();
    };
    ballEl.addEventListener('pointerup', end);
    ballEl.addEventListener('pointercancel', end);
  }
  // 翻译中让悬浮球转起来（以前只有 CSS，没有加 class，所以看不出来）
  function setBusy(on) {
    try { if (ballEl) ballEl.classList.toggle('busy', !!on); } catch (_) {}
  }

  function removeBall() {
    hideMenu();
    if (menuEl && menuEl.parentNode) { menuEl.remove(); menuEl = null; }
    if (ballEl) { ballEl.remove(); ballEl = null; }
  }

  /* ================= 设置面板 ================= */
  let panelEl = null;
  let panelBackGuard = false;

  function closePanel() {
    if (panelEl) { panelEl.remove(); panelEl = null; }
    if (panelBackGuard) {
      panelBackGuard = false;
      try { history.back(); } catch (_) {}
    }
  }

  window.addEventListener('popstate', () => {
    if (panelEl) {
      panelBackGuard = false;
      panelEl.remove();
      panelEl = null;
    }
  });

  function openPanel() {
    const r = ensureShadow();
    if (panelEl) panelEl.remove();
    try { history.pushState({ hfPanel: 1 }, ''); panelBackGuard = true; } catch (_) {}
    panelEl = document.createElement('div');
    panelEl.className = 'hf-panel';
    panelEl.innerHTML = `
      <div class="hf-box">
        <h3>HaloFlow 设置</h3>
        <div class="hf-tabs" id="tabs"></div>
        <div class="hf-field" style="margin-top:10px"><label>方案名</label>
          <input id="f-pname" type="text" placeholder="给这套配置起个名字" />
        </div>

        <div class="hf-field"><label>Base URL</label><input id="f-base" type="text" /></div>
        <div class="hf-field"><label>API Key</label>
          <div class="hf-keyrow">
            <input id="f-key" type="password" autocomplete="off" spellcheck="false" />
            <button id="f-eye" type="button">显示</button>
          </div>
        </div>
        <div class="hf-field"><label>模型</label>
          <input id="f-model" type="text" list="m-list" />
          <datalist id="m-list">
            <option value="deepseek-flash"></option>
            <option value="deepseek-v4-pro"></option>
            <option value="glm-5.3-flash"></option>
            <option value="glm-4-flash"></option>
          </datalist>
        </div>
        <div class="hf-field"><label>请求转发</label>
          <select id="f-fwd">
            <option value="auto">自动（优先 opi）</option>
            <option value="relay">仅中转</option>
            <option value="direct">本地直连</option>
          </select>
        </div>
        <div class="hf-row">
          <div class="hf-field"><label>目标语言</label><input id="f-lang" type="text" /></div>
          <div class="hf-field"><label>整页模式</label>
            <select id="f-mode"><option value="replace">直接替换</option><option value="both">双语追加</option></select>
          </div>
        </div>
        <div class="hf-row">
          <div class="hf-field"><label>每批段数</label><input id="f-batch" type="number" min="8" max="60" /></div>
          <div class="hf-field"><label>思考深度</label>
            <select id="f-effort">
              <option value="off">关闭</option><option value="low">低</option>
              <option value="high">高</option><option value="max">最高</option>
            </select>
          </div>
        </div>
        <div class="hf-row">
          <div class="hf-field"><label>并发策略</label>
            <select id="f-conc"><option value="auto">自动</option><option value="manual">手动</option></select>
          </div>
          <div class="hf-field"><label>手动并发（1–8）</label><input id="f-maxconc" type="number" min="1" max="8" /></div>
        </div>
        <div class="hf-field"><label>系统提示词（{target} 会被替换）</label>
          <textarea id="f-sys"></textarea>
        </div>

        <div class="hf-field">
          <label>实验性功能</label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#c6dcee;text-transform:none;letter-spacing:0;margin-top:2px">
            <input id="f-expimg" type="checkbox" style="width:auto;padding:0" /> 图片翻译（需要多模态模型）
          </label>
        </div>

        <div class="hf-extra">
          <button id="f-test">连接测试</button>
          <button id="f-models">检测可用模型</button>
          <button id="f-diag">诊断本页</button>
          <button id="f-clearcache">清除缓存</button>
          <button id="f-toggleball">悬浮球</button>
        </div>
        <div class="hf-extra">
          <button id="f-export">导出配置</button>
          <button id="f-import">导入配置</button>
        </div>
        <textarea id="f-io" spellcheck="false" placeholder="导出后配置会出现在这里；也可以把配置粘进来再点「导入配置」" style="display:none"></textarea>
        <div class="hf-status" id="f-status"></div>

        <div class="hf-actions">
          <button id="f-cancel">关闭</button>
          <button class="primary" id="f-save">保存</button>
        </div>
      </div>`;
    r.appendChild(panelEl);

    const $ = (s) => panelEl.querySelector(s);
    const status = (t, color) => { $('#f-status').textContent = t; $('#f-status').style.color = color || '#6d8aa2'; };

    function renderTabs() {
      const box = $('#tabs');
      box.innerHTML = '';
      store.profiles.forEach((p) => {
        const el = document.createElement('div');
        el.className = 'hf-tab' + (p.id === store.activeProfile ? ' on' : '');
        const host = (p.baseUrl || '').replace(/^https?:\/\//, '').split('/')[0] || '未配置';
        el.innerHTML = `${p.name}<small>${host} · ${p.model || '—'}</small>`;
        el.addEventListener('click', () => {
          store.activeProfile = p.id;
          saveStore();
          renderTabs();
          fillForm();
        });
        box.appendChild(el);
      });
    }

    function fillForm() {
      // 打开设置时从持久化存储重读一次，别只信内存里的
      try {
        const persisted = GM_getValue('haloflow_cache', null);
        if (persisted && typeof persisted === 'object') {
          const keys = Object.keys(persisted);
          if (keys.length > cache.size) cache = new Map(Object.entries(persisted));
        }
      } catch (_) {}
      const c = cfg();
      $('#f-pname').value = c.name || '';
      $('#f-base').value = c.baseUrl || '';
      $('#f-key').value = c.apiKey || '';
      $('#f-model').value = c.model || '';
      $('#f-fwd').value = c.forwardMode || 'auto';
      $('#f-lang').value = c.targetLang || '简体中文';
      $('#f-mode').value = c.translateMode || 'replace';
      $('#f-batch').value = c.pageChunkSize || 24;
      $('#f-effort').value = c.reasoningEffort || 'off';
      $('#f-conc').value = c.concurrencyMode || 'auto';
      $('#f-maxconc').value = c.maxConcurrency || 4;
      $('#f-sys').value = c.systemPrompt || SYS_PROMPT;
      const expBox = $('#f-expimg');
      if (expBox) expBox.checked = !!store.ui.expImg;
      status(`缓存 ${cache.size} 条 · 当前方案「${c.name}」`);
    }

    const eyeBtn = $('#f-eye');
    if (eyeBtn) {
      eyeBtn.addEventListener('click', () => {
        const inp = $('#f-key');
        const show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        eyeBtn.textContent = show ? '隐藏' : '显示';
      });
    }

    // 自动保存：任何输入改动 500ms 后写入当前方案，避免"改了没点保存就关掉"
    let autoSaveTimer = null;
    const collectForm = () => ({
      name: $('#f-pname').value.trim() || '方案',
      baseUrl: $('#f-base').value.trim(),
      apiKey: $('#f-key').value.trim(),
      model: $('#f-model').value.trim(),
      forwardMode: $('#f-fwd').value,
      targetLang: $('#f-lang').value.trim() || '简体中文',
      translateMode: $('#f-mode').value,
      pageChunkSize: Number($('#f-batch').value) || 24,
      reasoningEffort: $('#f-effort').value,
      concurrencyMode: $('#f-conc').value,
      maxConcurrency: Number($('#f-maxconc').value) || 4,
      systemPrompt: $('#f-sys').value
    });

    panelEl.querySelectorAll('input:not(#f-io):not(#f-expimg), textarea:not(#f-io), select:not(#f-io)').forEach((el) => {
      el.addEventListener('input', () => {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(() => {
          patchProfile(collectForm());
          if (el.id === 'f-pname') renderTabs();
          status('已自动保存 · ' + cfg().name, '#6cf5c9');
        }, 500);
      });
      el.addEventListener('change', () => {
        clearTimeout(autoSaveTimer);
        patchProfile(collectForm());
        if (el.id === 'f-pname') renderTabs();
        status('已自动保存 · ' + cfg().name, '#6cf5c9');
      });
    });

    // 导出 / 导入整套配置（换设备、备份、发给别人都用得上）
    const io = $('#f-io');
    $('#f-export').addEventListener('click', () => {
      io.style.display = 'block';
      io.value = JSON.stringify({
        app: 'haloflow', v: 2,
        profiles: store.profiles,
        activeProfile: store.activeProfile,
        ui: store.ui
      }, null, 2);
      try {
        io.focus(); io.select();
        const ok = document.execCommand && document.execCommand('copy');
        status(ok ? '配置已复制，粘贴到别处即可备份' : '配置已生成，长按文本框全选复制', '#6cf5c9');
      } catch (_) {
        status('配置已生成，长按文本框全选复制', '#6cf5c9');
      }
    });

    $('#f-import').addEventListener('click', () => {
      io.style.display = 'block';
      const txt = (io.value || '').trim();
      if (!txt) { try { io.focus(); } catch (_) {} return status('先把配置粘进下面的文本框，再点一次「导入配置」', '#ffcc66'); }
      let data;
      try { data = JSON.parse(txt); } catch (e) { return status('JSON 解析失败：' + String(e.message).slice(0, 40), '#ff7a7a'); }
      const list = Array.isArray(data) ? data : (data && data.profiles);
      if (!Array.isArray(list) || !list.length) return status('里面没有 profiles 字段', '#ff7a7a');
      store.profiles = list.slice(0, 3).map((p, i) =>
        Object.assign(profileTemplate(p.id || ('p' + (i + 1)), p.name || ('方案 ' + (i + 1))), p));
      if (data.activeProfile && store.profiles.some((p) => p.id === data.activeProfile)) store.activeProfile = data.activeProfile;
      else store.activeProfile = store.profiles[0].id;
      if (data.ui) store.ui = Object.assign({}, DEFAULT_UI, data.ui);
      saveStore();
      renderTabs();
      fillForm();
      if (store.ui.showBall) createBall(); else removeBall();
      status('已导入 ' + store.profiles.length + ' 套方案', '#6cf5c9');
    });

    $('#f-save').addEventListener('click', () => {
      patchProfile(collectForm());
      panelEl.remove();
      panelEl = null;
      if (panelBackGuard) { panelBackGuard = false; try { history.back(); } catch (_) {} }
      toast('已保存');
      if (store.ui.showBall) createBall();
    });

    $('#f-cancel').addEventListener('click', closePanel);

    $('#f-clearcache').addEventListener('click', () => {
      cache = new Map();
      GM_setValue('haloflow_cache', {});
      status('缓存已清空', '#6cf5c9');
    });

    $('#f-toggleball').addEventListener('click', () => {
      store.ui.showBall = !store.ui.showBall;
      saveStore();
      if (store.ui.showBall) createBall(); else removeBall();
      status(store.ui.showBall ? '悬浮球已显示' : '悬浮球已隐藏', '#6cf5c9');
    });

    const expBoxEl = $('#f-expimg');
    if (expBoxEl) {
      expBoxEl.addEventListener('change', () => {
        store.ui.expImg = !!expBoxEl.checked;
        saveStore();
        status(store.ui.expImg ? '图片翻译已开启：悬浮球菜单里会多一项' : '图片翻译已关闭', '#6cf5c9');
      });
    }

    $('#f-diag').addEventListener('click', () => {
      const d = window.__haloflowDiag ? window.__haloflowDiag() : { total: 0, diag: {}, rejected: [] };
      const lines = [];
      lines.push('可翻段落: ' + d.total);
      lines.push('过滤统计: ' + JSON.stringify(d.diag || {}));
      lines.push('命中样本: ' + JSON.stringify((d.sample || []).slice(0, 3)));
      lines.push('--- 被跳过的文本（前 20 条）---');
      (d.rejected || []).forEach((r) => lines.push('[' + r.why + '] ' + r.text));
      io.style.display = 'block';
      io.value = lines.join('\n');
      try { io.focus(); io.select(); } catch (_) {}
      status('诊断结果已填到下面文本框，全选复制发我', '#6cf5c9');
    });

    const modelsBtn = $('#f-models');
    if (modelsBtn) {
      modelsBtn.addEventListener('click', async () => {
        const c = cfg();
        const base = (c.baseUrl || '').replace(/\/+$/, '');
        if (!base) return status('先填 Base URL', '#ffcc66');
        status('正在拉取模型列表…', '#9db4c8');
        try {
          const list = await getModels(base, c.apiKey);
          const vision = list.filter((m) => /vision|(^|[-_.])vl([-_.]|$)|4o|omni|multimodal|glm-4v|internvl|qwen.*vl/i.test(m));
          status(`共 ${list.length} 个模型 · 疑似支持图片：${vision.length ? vision.slice(0, 6).join('、') : '没找到'}`, vision.length ? '#6cf5c9' : '#ffcc66');
        } catch (e) {
          status('拉取失败：' + String(e.message || e).slice(0, 60), '#ff9bb0');
        }
      });
    }

    $('#f-test').addEventListener('click', async () => {
      status('测试中…', '#9db4c8');
      try {
        const out = [];
        await requestOnce(['Hello, world.'], (i, t) => { if (i === 0 && t) out.push(t); });
        status('连接成功 ✓ ' + (out[0] || ''), '#6cf5c9');
      } catch (e) {
        status('失败：' + (e.message || e), '#ff9bb0');
      }
    });

    renderTabs();
    fillForm();
  }

  /* ================= 启动 ================= */
  GM_registerMenuCommand('⚙ HaloFlow 设置', openPanel);
  GM_registerMenuCommand('🌐 翻译当前页面 (Alt+T)', () => translatePage());
  GM_registerMenuCommand('↩ 恢复原文 (Alt+R)', () => restorePage());

  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 't' || e.key === 'T')) { e.preventDefault(); translatePage(); }
    if (e.altKey && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); restorePage(); }
  });

  let moTimer = null;
  const mo = new MutationObserver((muts) => {
    if (!state.pageTranslated || state.translating || !state.autoFollow) return;
    let hasNew = false;
    for (const m of muts) {
      if (m.type === 'childList') {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.closest && n.closest('#haloflow-host')) continue;
          hasNew = true; break;
        }
      }
      if (!hasNew && m.type === 'characterData') {
        const el = m.target && m.target.parentElement;
        if (!el || el.closest('#haloflow-host')) continue;
        const done = el.closest('[data-haloflow-done]');
        if (done) {
          const expect = done.getAttribute('data-haloflow-out');
          if (expect && (done.innerText || '').trim() === expect) continue;
        }
        hasNew = true;
      }
      if (hasNew) break;
    }
    if (!hasNew) return;
    clearTimeout(moTimer);
    moTimer = setTimeout(() => {
      if (!state.pageTranslated) return;
      if (state.translating) { state.pending = true; return; }   // 忙 → 记下来，收尾再翻
      translatePage(true);
    }, 900);
  });
  try { mo.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true }); } catch (_) {}

  if (isTopFrame && store.ui.showBall) createBall();
})();
