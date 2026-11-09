/**
 * HaloFlow · background service worker
 * 负责所有网络请求（content script 不直接 fetch，避免 CORS / 权限问题）
 */

const DEFAULTS = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-flash',
  targetLang: '简体中文',
  systemPrompt:
    '你是专业的网页翻译引擎，负责把 JSON 数组里的每条文本翻译成{target}。\n\n' +
    '要求：\n' +
    '1）忠实原文：不增删信息，不添加解释或评论；数字、单位、代码、变量名、URL、邮箱、占位符保持原样。\n' +
    '2）表达自然：符合{target}的语言习惯，避免逐字硬译；长句按语义拆分，保持逻辑连贯与指代清晰。\n' +
    '3）术语一致：同一概念在全文中使用同一译法；原文没有明确对应译法时优先意译，不生造词。\n' +
    '4）语气贴合：保留原文的正式、口语、技术、营销等语体特征。\n' +
    '5）格式严格：输出 JSON 字符串数组，条数与输入完全一致且顺序对应；不要 markdown 代码块，不要任何额外文字。',
  selectionAuto: true,
  translateMode: 'replace', // replace = 直接替换原文（默认）/ both = 双语追加
  showBall: true,
  ballSide: 'right',
  ballY: 0.62,
  pageChunkSize: 14,
  temperature: 0.2,
  concurrencyMode: 'auto',
  maxConcurrency: 2,
  reasoningEffort: 'off',  // off | high | max（DeepSeek thinking 模式）
  timeoutMs: 60000
};

const PROVIDER_PRESETS = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  moonshot: { baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  relay: { baseUrl: 'https://relay.example.com/v1', model: 'deepseek-flash' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' },
  custom: { baseUrl: '', model: '' }
};

function profileTemplate(id, name, overrides) {
  return Object.assign({
    id, name,
    baseUrl: '', model: '', apiKey: '', forwardMode: 'direct',
    targetLang: '简体中文',
    systemPrompt: DEFAULTS.systemPrompt,
    pageChunkSize: 24,
    temperature: 0.2,
    translateMode: 'replace',
    concurrencyMode: 'auto',
    maxConcurrency: 4,
    reasoningEffort: 'off',
    showBall: true
  }, overrides || {});
}

function defaultProfiles() {
  return [
    profileTemplate('p1', '默认方案', {
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-flash',
      forwardMode: 'direct'
    }),
    profileTemplate('p2', '方案 2', {}),
    profileTemplate('p3', '方案 3', {})
  ];
}

async function rawConfig() {
  const stored = await chrome.storage.local.get('config');
  const cfg = { ...DEFAULTS, ...(stored.config || {}) };
  if (!Array.isArray(cfg.profiles) || !cfg.profiles.length) {
    cfg.profiles = defaultProfiles();
    // 旧版字段迁移到第一个方案
    const migrated = {};
    PROFILE_FIELDS.forEach((k) => { if (cfg[k] !== undefined) migrated[k] = cfg[k]; });
    cfg.profiles[0] = Object.assign({}, cfg.profiles[0], migrated);
  }
  // 老版本方案补齐新增字段
  cfg.profiles = cfg.profiles.map((p, i) =>
    Object.assign(profileTemplate(p.id || ('p' + (i + 1)), p.name || ('方案 ' + (i + 1))), p));

  if (!cfg.activeProfile) cfg.activeProfile = cfg.profiles[0].id;
  return cfg;
}

async function getConfig() {
  const cfg = await rawConfig();
  const active = cfg.profiles.find((p) => p.id === cfg.activeProfile) || cfg.profiles[0];
  // 顶层字段 = 当前方案，调用方不用关心 profile
  return { ...cfg, ...active, profiles: cfg.profiles };
}

const PROFILE_FIELDS = [
  'name', 'baseUrl', 'model', 'apiKey', 'forwardMode',
  'targetLang', 'systemPrompt', 'pageChunkSize', 'temperature',
  'translateMode', 'concurrencyMode', 'maxConcurrency', 'reasoningEffort',
  'showBall'
];

async function setConfig(patch) {
  const cfg = await rawConfig();
  const next = { ...cfg };

  // 方案内的字段单独处理：只写进"当前方案"
  const pPatch = {};
  for (const k of PROFILE_FIELDS) {
    if (k in patch) { pPatch[k] = patch[k]; delete patch[k]; }
  }
  Object.assign(next, patch);

  if (Object.keys(pPatch).length) {
    const idx = next.profiles.findIndex((p) => p.id === next.activeProfile);
    if (idx >= 0) {
      next.profiles[idx] = { ...next.profiles[idx], ...pPatch };
      // 顶层同步，兼容旧调用
      Object.assign(next, pPatch);
    }
  }

  await chrome.storage.local.set({ config: next });
  return getConfig();
}

/* ---------- 文本工具 ---------- */

// 从模型输出里抠出 JSON 数组，容忍 ```json 包裹 / 前后噪声
function extractArray(raw) {
  if (typeof raw !== 'string') throw new Error('模型返回不是字符串');
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) throw new Error('模型没有返回 JSON 数组');
  const arr = JSON.parse(s.slice(start, end + 1));
  if (!Array.isArray(arr)) throw new Error('返回的不是数组');
  return arr.map((x) => (typeof x === 'string' ? x : String(x ?? '')));
}

/* ---------- 高考模式：单词卡 ---------- */

const DICT_SYSTEM =
  '你是高考英语词典引擎。用户会给你一个英文单词或短语，请输出严格 JSON（只输出 JSON，不要 markdown 代码块，不要任何解释）：\n' +
  '{"word":"原词","phonetic":"/音标/","senses":[{"pos":"n.","cn":"释义"}],"phrases":[{"en":"搭配","cn":"中文"}],"derivatives":[{"word":"派生词","pos":"adj.","cn":"中文"}],"examples":[{"en":"例句","cn":"译文"}]}\n\n' +
  '要求：\n' +
  '1）senses：1-3 条，按高考常用度排序；pos 用 n. / v. / adj. / adv. / prep. / conj. / pron. 这类缩写。\n' +
  '2）phrases：2-4 条高频词组或固定搭配，en 写英文，cn 写中文。\n' +
  '3）derivatives：2-4 条同根派生词，给出词性和中文意思。\n' +
  '4）examples：2 条贴近高考语境的例句，en 是英文，cn 是中文翻译。\n' +
  '5）中文用简体；音标不确定就留空字符串；没有的字段给空数组，不要编造。';

const asObj = (x) => (typeof x === 'string' ? { cn: x } : (x && typeof x === 'object' ? x : {}));
const asStr = (x) => (typeof x === 'string' ? x : (typeof x === 'number' ? String(x) : ''));

// 从模型输出里抠出 JSON 对象，容忍 ```json 包裹 / 前后噪声 / 字段缺失
function parseDict(raw) {
  if (typeof raw !== 'string') throw new Error('模型返回不是字符串');
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) throw new Error('模型没有返回 JSON 对象');
  let j;
  try {
    j = JSON.parse(s.slice(a, b + 1));
  } catch (_) {
    throw new Error('词典 JSON 解析失败');
  }
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    word: asStr(j.word),
    phonetic: asStr(j.phonetic),
    senses: list(j.senses).map((x) => { const o = asObj(x); return { pos: asStr(o.pos), cn: asStr(o.cn) }; }).filter((x) => x.cn),
    phrases: list(j.phrases).map((x) => { const o = asObj(x); return { en: asStr(o.en), cn: asStr(o.cn) }; }).filter((x) => x.en || x.cn),
    derivatives: list(j.derivatives).map((x) => { const o = asObj(x); return { word: asStr(o.word), pos: asStr(o.pos), cn: asStr(o.cn) }; }).filter((x) => x.word),
    examples: list(j.examples).map((x) => { const o = asObj(x); return { en: asStr(o.en), cn: asStr(o.cn) }; }).filter((x) => x.en)
  };
}

/* ---------- 端点解析：中转优先，可回退直连 ---------- */
const RELAY_BASE = 'https://relay.example.com/v1';

function endpointsOf(config) {
  const direct = (config.baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const mode = config.forwardMode || 'auto';
  const list = [];
  if (mode !== 'direct') list.push({ base: RELAY_BASE, viaRelay: true, directBase: direct });
  if (mode !== 'relay') list.push({ base: direct, viaRelay: false, directBase: direct });
  if (!list.length) list.push({ base: direct, viaRelay: false });
  return list;
}

/* ---------- API 调用 ---------- */

// 常见配错：DeepSeek 官方没有 deepseek-flash 这个模型
function fixedModel(m, base) {
  const model = String(m || '').trim();
  // 用户填什么就用什么（DeepSeek V4 的正式模型名就是 deepseek-flash / deepseek-v4-pro），
  // 只在留空时给一个默认值
  return model || 'deepseek-flash';
}

function buildBody(config, messages) {
  const body = {
    model: fixedModel(config.model, config.baseUrl),
    messages,
    stream: false
  };
  const effort = config.reasoningEffort || 'off';
  const isDS = /deepseek/i.test(body.model || '');
  if (effort === 'off') {
    body.temperature = Number(config.temperature ?? 0.2);
    // DeepSeek V4 默认开思考，会把输出预算吃光导致正文为空 —— 明确关掉
    if (isDS) body.thinking = { type: 'disabled' };
  } else {
    // thinking 模式下 temperature 不生效，省略
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = (effort === 'low' || effort === 'high' || effort === 'max') ? effort : 'low';
  }
  // 输出预算：不传 max_tokens 时，长段落 + 思考模型容易把正文挤掉，表现就是"这段没翻"
  const last = messages[messages.length - 1];
  const totalChars = last && typeof last.content === 'string' ? last.content.length : 0;
  body.max_tokens = Math.min(8192, Math.max(2048, 1024 + Math.ceil(totalChars * 1.2)));
  return body;
}

async function callChat(config, messages, timeoutMs, endpoint) {
  if (!config.apiKey && !/localhost|127\.0\.0\.1/.test(config.baseUrl)) {
    throw new Error('还没填 API Key，去设置页填一下喵');
  }
  const base = (endpoint && endpoint.base) || (config.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('Base URL 为空');
  const url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || DEFAULTS.timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: 'Bearer ' + config.apiKey } : {}),
        ...(endpoint && endpoint.viaRelay && endpoint.directBase ? { 'X-Halo-Upstream': endpoint.directBase } : {})
      },
      body: JSON.stringify(buildBody(config, messages)),
      signal: ctrl.signal
    });
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') throw new Error('请求超时（' + Math.round((timeoutMs || 60000) / 1000) + 's）');
    throw new Error('网络错误：' + (e.message || e));
  }
  clearTimeout(timer);

  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      detail = j?.error?.message || j?.message || detail;
    } catch (_) {}
    throw new Error(`HTTP ${res.status} · ${detail}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error('返回不是合法 JSON：' + text.slice(0, 200));
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('模型没有返回内容');
  return content;
}

async function translateBatch(config, texts) {
  const sys = (config.systemPrompt || DEFAULTS.systemPrompt).replace('{target}', config.targetLang || '简体中文');
  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content: JSON.stringify(texts) }
  ];
  const eps = endpointsOf(config);
  let lastErr;
  for (let attempt = 0; attempt < 2 * eps.length; attempt++) {
    const ep = eps[Math.floor(attempt / 2) % eps.length];
    try {
      const raw = await callChat(config, messages, config.timeoutMs, ep);
      const arr = extractArray(raw);
      // 长度对不上时补齐/截断，避免整页崩掉
      if (arr.length === texts.length) return arr;
      const fixed = texts.map((_, i) => arr[i] ?? '');
      if (arr.length < texts.length) throw new Error(`返回条数不足 ${arr.length}/${texts.length}`);
      return fixed;
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastErr;
}

async function dictLookup(config, text) {
  const messages = [
    { role: 'system', content: DICT_SYSTEM },
    { role: 'user', content: String(text || '').slice(0, 200) }
  ];
  const eps = endpointsOf(config);
  let lastErr;
  for (let attempt = 0; attempt < 2 * eps.length; attempt++) {
    const ep = eps[Math.floor(attempt / 2) % eps.length];
    try {
      const raw = await callChat(config, messages, Math.min(config.timeoutMs || 60000, 45000), ep);
      return parseDict(raw);
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
    }
  }
  throw lastErr || new Error('词典请求失败');
}

/* ---------- 流式翻译（SSE + 增量 JSON 数组解析） ---------- */

// 增量解析模型流式输出的 JSON 字符串数组：
// 只在遇到闭合引号时吐出一个元素，天然处理转义
function makeArrayStreamParser(onItem) {
  let started = false, inStr = false, esc = false, cur = '', idx = 0;
  return {
    push(chunk) {
      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk[i];
        if (!started) { if (ch === '[') started = true; continue; }
        if (esc) { cur += ch; esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') {
          if (inStr) {
            inStr = false;
            onItem(idx++, cur);
            cur = '';
          } else {
            inStr = true;
          }
          continue;
        }
        if (inStr) cur += ch;
      }
    }
  };
}

async function streamBatch(config, texts, onItem, signal, endpoint) {
  const base = (endpoint && endpoint.base) || (config.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('Base URL 为空');
  const url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
  const sys = (config.systemPrompt || DEFAULTS.systemPrompt).replace('{target}', config.targetLang || '简体中文');

  const body = buildBody(config, [
    { role: 'system', content: sys },
    { role: 'user', content: JSON.stringify(texts) }
  ]);
  body.stream = true;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: 'Bearer ' + config.apiKey } : {}),
      ...(endpoint && endpoint.viaRelay && endpoint.directBase ? { 'X-Halo-Upstream': endpoint.directBase } : {})
    },
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('HTTP ' + res.status + ' · ' + t.slice(0, 160));
  }
  if (!res.body) throw new Error('当前环境不支持流式响应');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = makeArrayStreamParser(onItem);
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const delta = j?.choices?.[0]?.delta?.content;
        if (delta) parser.push(delta);
      } catch (_) { /* 半包，忽略 */ }
    }
  }
}

// 长连接：逐段把译文推回 content script
chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== 'haloflow-stream') return;
  let closed = false;
  // 关键：Port 断开（用户点恢复 / 切换模式 / 关标签页）时，
  // 用 AbortController 真正掐断到 DeepSeek 的连接，别再白烧 token
  const ctrl = new AbortController();

  port.onDisconnect.addListener(() => {
    closed = true;
    try { ctrl.abort(); } catch (_) {}
  });

  port.onMessage.addListener(async (msg) => {
    if (!msg || msg.type !== 'translate') return;
    try {
      const config = await getConfig();
      const eps = endpointsOf(config);
      let emitted = false;
      let lastErr = null;
      let okDone = false;

      for (const ep of eps) {
        if (closed) return;
        try {
          await streamBatch(config, msg.texts, (index, text) => {
            emitted = true;
            if (!closed) {
              try { port.postMessage({ type: 'chunk', index, text }); } catch (_) {}
            }
          }, ctrl.signal, ep);
          // HTTP 200 但一个字都没吐（key 错 / 模型名错 / 内容被拒），别当成功，
          // 否则前端会显示「全部完成，共 0 段」
          if (!emitted) throw new Error('模型没吐出正文（检查：模型名对不对 / 是不是思考模型把输出预算吃完了）');
          okDone = true;
          break;
        } catch (err) {
          lastErr = err;
          // 已经开始吐内容就不换端点了，避免重复
          if (emitted) break;
        }
      }
      if (!okDone && lastErr) throw lastErr;
      if (!closed) port.postMessage({ type: 'done', count: msg.texts.length });
    } catch (e) {
      if (!closed) {
        const aborted = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
        if (!aborted) port.postMessage({ type: 'error', error: e.message || String(e) });
      }
    }
  });
});

/* ---------- 消息路由 ---------- */

// content script 也要读写 chrome.storage.session（翻译缓存），
// 默认只有扩展页面能访问，这里放开
try {
  if (chrome.storage && chrome.storage.session && chrome.storage.session.setAccessLevel) {
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
      .catch(() => {});
  }
} catch (_) {}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      const config = await getConfig();
      switch (msg?.type) {
        case 'ping':
          sendResponse({ ok: true });
          return;

        case 'translate': {
          const texts = Array.isArray(msg.texts) ? msg.texts : [msg.texts];
          const out = await translateBatch(config, texts);
          sendResponse({ ok: true, translations: out });
          return;
        }

        case 'dict': {
          const out = await dictLookup(config, msg.text);
          sendResponse({ ok: true, dict: out });
          return;
        }

        case 'diag': {
          // 设置页自己是扩展页面，没有注入 content script，
          // 所以找"最近访问过的网页标签"来诊断
          let tabs = [];
          try { tabs = await chrome.tabs.query({}); } catch (_) {}
          const pages = tabs
            .filter((t) => t && t.id && /^https?:/i.test(t.url || ''))
            .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
          const tab = pages[0];
          if (!tab) throw new Error('没找到网页标签页');
          let res = null;
          try {
            res = await chrome.tabs.sendMessage(tab.id, { type: 'diagPage' });
          } catch (e) {
            throw new Error('这个页面还没注入脚本，刷新一下网页再点诊断');
          }
          sendResponse({ ok: !!(res && res.ok), data: res && res.data, error: res && res.error, url: tab.url });
          return;
        }

        case 'models': {
          const base = (msg.base || config.baseUrl || '').replace(/\/+$/, '');
          if (!base) throw new Error('Base URL 为空');
          const r = await fetch(base + '/models', {
            headers: msg.key ? { Authorization: 'Bearer ' + msg.key } : {}
          });
          const text = await r.text();
          sendResponse({ ok: r.ok, status: r.status, text });
          return;
        }

        case 'vision': {
          const url = msg.url;
          if (!url) throw new Error('缺少 url');
          const headers = { 'Content-Type': 'application/json' };
          if (msg.key) headers.Authorization = 'Bearer ' + msg.key;
          const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(msg.body) });
          const text = await r.text();
          sendResponse({ ok: r.ok, status: r.status, text });
          return;
        }

        case 'test': {
          const out = await translateBatch({ ...config, ...(msg.config || {}) }, ['Hello, world.']);
          sendResponse({ ok: true, sample: out[0] });
          return;
        }

        case 'getConfig':
          sendResponse({ ok: true, config, presets: PROVIDER_PRESETS });
          return;

        case 'setConfig':
          sendResponse({ ok: true, config: await setConfig(msg.patch || {}) });
          return;

        case 'setProfile': {
          const cur = await rawConfig();
          if (cur.profiles.some((p) => p.id === msg.id)) {
            cur.activeProfile = msg.id;
            await chrome.storage.local.set({ config: cur });
          }
          sendResponse({ ok: true, config: await getConfig() });
          return;
        }

        case 'clearCache': {
          await chrome.storage.local.remove('haloflowCache');
          sendResponse({ ok: true, count: 0 });
          return;
        }

        case 'cacheStats': {
          const st = await chrome.storage.local.get('haloflowCache');
          const obj = (st && st.haloflowCache) || {};
          sendResponse({ ok: true, count: Object.keys(obj).length });
          return;
        }

        case 'openOptions':
          chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          return;

        default:
          sendResponse({ ok: false, error: 'unknown message: ' + msg?.type });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true; // 保持消息通道
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.get('config').then((s) => {
      if (!s.config) chrome.storage.local.set({ config: DEFAULTS });
    });
    // 首次安装不强制打开设置页，避免打扰
  }
});
