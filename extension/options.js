const $ = (s) => document.querySelector(s);
const PROVIDERS = [
  ['deepseek', 'DeepSeek'],
  ['openai', 'OpenAI'],
  ['moonshot', 'Moonshot'],
  ['siliconflow', '硅基流动'],
  ['relay', '自建中转'],
  ['ollama', 'Ollama'],
  ['custom', '自定义']
];

const FALLBACK = {
  provider: 'deepseek',
  forwardMode: 'auto',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-flash',
  targetLang: '简体中文',
  systemPrompt: '你是一个专业的网页翻译引擎，把用户给出的文本翻译成{target}。要求：① 保持原文语气与术语；② 不要解释、不要添加原文没有的内容；③ 严格输出 JSON 数组，长度与输入完全一致，不要用 markdown 代码块包裹。',
  pageChunkSize: 14,
  temperature: 0.2,
  translateMode: 'replace',
  showBall: true,
  reasoningEffort: 'off',
  concurrencyMode: 'auto',
  maxConcurrency: 2
};

let presets = {};
let curProvider = 'deepseek';
let curFwd = 'auto';
let curConcMode = 'auto';

function toast(msg, kind = '') {
  const el = $('#saveHint');
  el.textContent = msg;
  el.className = 'save-hint ' + kind;
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.textContent = '改动会自动保存';
    el.className = 'save-hint';
  }, 2600);
}

let curMode = 'both';
let curBall = true;
let curEffort = 'off';

function paintToggles() {
  document.querySelectorAll('#concChips .chip').forEach((c) =>
    c.classList.toggle('on', c.dataset.conc === curConcMode));
  document.querySelectorAll('#forwardChips .chip').forEach((c) =>
    c.classList.toggle('on', c.dataset.fwd === curFwd));
  document.querySelectorAll('#effortChips .chip').forEach((c) =>
    c.classList.toggle('on', c.dataset.effort === curEffort));
  document.querySelectorAll('#modeChips .chip').forEach((c) =>
    c.classList.toggle('on', c.dataset.mode === curMode));
  document.querySelectorAll('#ballChips .chip').forEach((c) =>
    c.classList.toggle('on', (c.dataset.ball === '1') === curBall));
}

function readForm() {
  const patch = {
    provider: curProvider,
    translateMode: curMode,
    showBall: curBall,
    reasoningEffort: curEffort,
    forwardMode: curFwd,
    concurrencyMode: curConcMode,
    maxConcurrency: Number(document.getElementById('maxConcurrency').value) || 4,
    baseUrl: $('#baseUrl').value.trim(),
    apiKey: $('#apiKey').value.trim(),
    model: $('#model').value.trim(),
    targetLang: $('#targetLang').value.trim() || '简体中文',
    systemPrompt: $('#systemPrompt').value,
    pageChunkSize: Number($('#pageChunkSize').value) || 12,
    temperature: Number($('#temperature').value) || 0.2,
    expImg: !!(document.getElementById('expImg') && document.getElementById('expImg').checked)
  };
  const nm = ($('#pname') && $('#pname').value.trim()) || '';
  if (nm) patch.name = nm;   // 留空就不动原方案名，别把名字刷没
  return patch;
}

function fillForm(cfg) {
  if ($('#pname')) $('#pname').value = cfg.name || '';
  const ex = document.getElementById('expImg');
  if (ex) ex.checked = !!cfg.expImg;
  $('#baseUrl').value = cfg.baseUrl || '';
  $('#apiKey').value = cfg.apiKey || '';
  $('#model').value = cfg.model || '';
  $('#targetLang').value = cfg.targetLang || '简体中文';
  $('#systemPrompt').value = cfg.systemPrompt || '';
  $('#pageChunkSize').value = cfg.pageChunkSize ?? 14;
  $('#maxConcurrency').value = cfg.maxConcurrency ?? 4;
  $('#temperature').value = cfg.temperature ?? 0.2;
  curProvider = cfg.provider || 'deepseek';
  curMode = cfg.translateMode === 'both' ? 'both' : 'replace';
  curBall = cfg.showBall !== false;
  curEffort = ['low', 'high', 'max'].includes(cfg.reasoningEffort) ? cfg.reasoningEffort : 'off';
  curFwd = ['auto', 'relay', 'direct'].includes(cfg.forwardMode) ? cfg.forwardMode : 'auto';
  curConcMode = cfg.concurrencyMode === 'manual' ? 'manual' : 'auto';
  const wrap = document.getElementById('manualConcWrap');
  if (wrap) wrap.style.display = curConcMode === 'manual' ? '' : 'none';
  renderChips();
  paintToggles();
}

function renderChips() {
  const box = $('#chips');
  if (!box) return;   // 简化版设置页没有 chips
  box.innerHTML = '';
  PROVIDERS.forEach(([id, label]) => {
    const b = document.createElement('div');
    b.className = 'chip' + (id === curProvider ? ' on' : '');
    b.textContent = label;
    b.dataset.id = id;
    b.addEventListener('click', () => {
      curProvider = id;
      const p = presets[id];
      if (p) {
        if (p.baseUrl) $('#baseUrl').value = p.baseUrl;
        if (p.model) $('#model').value = p.model;
      }
      $('#badgeProvider').textContent = label;
      // 中转模式下提示可以填口令
      const keyInput = $('#apiKey');
      if (id === 'relay') {
        keyInput.placeholder = '中转口令（HALO_TOKEN），或直接填 sk-...';
        keyInput.title = '自建中转：填中转口令即可，也可以填自己的 sk-';
      } else {
        keyInput.placeholder = 'sk-...';
        keyInput.title = '';
      }
      renderChips();
      save(true);
    });
    box.appendChild(b);
  });
  const found = PROVIDERS.find(([id]) => id === curProvider);
  const badge = $('#badgeProvider');
  if (badge) badge.textContent = found ? found[1] : curProvider;
}

let saveTimer = null;
function save(silent = false) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const patch = readForm();
    const res = await new Promise((r) => chrome.runtime.sendMessage({ type: 'setConfig', patch }, r));
    if (res?.ok) {
      // 改了方案名就顺手刷新上面的方案卡片
      if (patch.name) {
        const cur = profiles.find((p) => p.id === activeProfileId);
        if (cur && cur.name !== patch.name) { cur.name = patch.name; renderProfiles(); }
      }
      if (!silent) toast('已保存 ✓', 'ok');
      else toast('已保存 ✓', 'ok');
    } else {
      toast('保存失败：' + (res?.error || '未知'), 'err');
    }
  }, silent ? 0 : 450);
}

let profiles = [];
let activeProfileId = 'p1';

function renderProfiles() {
  const box = document.getElementById('profiles');
  if (!box) return;
  box.innerHTML = '';
  profiles.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'profile-tab' + (p.id === activeProfileId ? ' on' : '');
    const host = (p.baseUrl || '').replace(/^https?:\/\//, '').split('/')[0] || '未配置';
    const mdl = p.model || 'deepseek-flash';
    el.innerHTML = `${p.name}<small>${host} · ${mdl}</small>`;
    el.addEventListener('click', async () => {
      if (p.id === activeProfileId) return;
      const res = await new Promise((r) => chrome.runtime.sendMessage({ type: 'setProfile', id: p.id }, r));
      if (res && res.ok) {
        activeProfileId = p.id;
        fillForm(res.config);
        renderProfiles();
        toast('已切换到 ' + p.name, 'ok');
      }
    });
    box.appendChild(el);
  });
}

async function init() {
  // 先把三个方案骨架画出来（file:// 预览或读取失败时也能看到）
  profiles = [
    { id: 'p1', name: '默认方案', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', apiKey: '', forwardMode: 'auto' },
    { id: 'p2', name: '方案 2', baseUrl: '', model: '', apiKey: '', forwardMode: 'auto' },
    { id: 'p3', name: '方案 3', baseUrl: '', model: '', apiKey: '', forwardMode: 'auto' }
  ];
  renderProfiles();

  // 先填一份默认值，避免异步读取期间表单一���空白
  fillForm(FALLBACK);
  try {
    const res = await new Promise((r) => chrome.runtime.sendMessage({ type: 'getConfig' }, r));
    if (res?.ok) {
      presets = res.presets || {};
      profiles = res.config.profiles || [];
      activeProfileId = res.config.activeProfile || (profiles[0] && profiles[0].id) || 'p1';
      fillForm(res.config);
      renderProfiles();
      return;
    }
  } catch (_) { /* file:// 预览时没有 runtime */ }
  toast('读不到扩展配置（预览模式？）', 'err');
}

document.querySelectorAll('input, textarea').forEach((el) => {
  el.addEventListener('input', () => save(false));
});

document.getElementById('concChips').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  curConcMode = c.dataset.conc;
  const wrap = document.getElementById('manualConcWrap');
  if (wrap) wrap.style.display = curConcMode === 'manual' ? '' : 'none';
  paintToggles();
  save(true);
});

document.getElementById('forwardChips').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  curFwd = c.dataset.fwd;
  paintToggles();
  save(true);
});

document.getElementById('modeChips').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  curMode = c.dataset.mode;
  paintToggles();
  save(true);
});

document.getElementById('effortChips').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  curEffort = c.dataset.effort;
  paintToggles();
  save(true);
});

document.getElementById('ballChips').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  curBall = c.dataset.ball === '1';
  paintToggles();
  save(true);
});

$('#btnEye').addEventListener('click', () => {
  const inp = $('#apiKey');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  $('#btnEye').textContent = show ? '隐藏' : '显示';
});

$('#btnSave').addEventListener('click', () => save(false));

async function refreshCacheStats() {
  const res = await new Promise((r) => chrome.runtime.sendMessage({ type: 'cacheStats' }, r));
  const n = res?.ok ? res.count : 0;
  document.getElementById('cacheBadge').textContent = n + ' 条';
  return n;
}

document.getElementById('btnClearCache').addEventListener('click', async () => {
  const out = document.getElementById('cacheOut');
  const res = await new Promise((r) => chrome.runtime.sendMessage({ type: 'clearCache' }, r));
  out.className = 'test-out ok';
  out.textContent = res?.ok ? '已清除 ✓' : '清除失败';
  refreshCacheStats();
});

refreshCacheStats();

$('#btnTest').addEventListener('click', async () => {
  const out = $('#testOut');
  const btn = $('#btnTest');
  const cfg = readForm();
  if (!cfg.apiKey && !/localhost|127\.0\.0\.1/.test(cfg.baseUrl)) {
    out.className = 'test-out err';
    out.textContent = '先填 API Key 喵';
    return;
  }
  btn.disabled = true;
  out.className = 'test-out';
  out.textContent = '请求中…';
  const res = await new Promise((r) =>
    chrome.runtime.sendMessage({ type: 'test', config: cfg }, r)
  );
  btn.disabled = false;
  if (res?.ok) {
    out.className = 'test-out ok';
    out.textContent = '连接成功 ✓ 示例：' + res.sample;
  } else {
    out.className = 'test-out err';
    out.textContent = '失败：' + (res?.error || '未知错误');
  }
});

/* ---------- 侧滑/后退：关闭设置页，而不是退回上一个标签（可能是中转站） ---------- */
(function guardBack() {
  try {
    history.pushState({ hfOptions: 1 }, '');
  } catch (_) {}
  window.addEventListener('popstate', () => {
    // 先尝试关闭自己；关不掉就再推一层，避免真的后退离开
    window.close();
    setTimeout(() => {
      try {
        history.pushState({ hfOptions: 1 }, '');
        toast('已拦截后退；要回到网页请点左下角「返回网页」', 'ok');
      } catch (_) {}
    }, 60);
  });
})();

function leaveOptions() {
  // 由脚本打开的标签页可以直接关闭；否则回退到打开它的页面
  window.close();
  setTimeout(() => {
    try {
      if (history.length > 1) history.back();
      else window.open('', '_self') && window.close();
    } catch (_) {}
  }, 80);
}

const backBtn = document.getElementById('btnBack');
if (backBtn) backBtn.addEventListener('click', leaveOptions);

/* ---------- 配置备份：整包导出 / 导入 ---------- */
(function ioSetup() {
  const exp = document.getElementById('btnExport');
  const imp = document.getElementById('btnImport');
  const file = document.getElementById('importFile');
  if (!exp || !imp || !file) return;

  exp.addEventListener('click', async () => {
    const res = await new Promise((r) => chrome.runtime.sendMessage({ type: 'getConfig' }, r));
    if (!res?.ok) return toast('读取配置失败', 'err');
    const cfg = res.config;
    const data = {
      app: 'haloflow', v: 2,
      profiles: cfg.profiles, activeProfile: cfg.activeProfile, ui: cfg.ui
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'haloflow-config.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('已导出 haloflow-config.json', 'ok');
  });

  imp.addEventListener('click', () => file.click());

  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch (e) { return toast('JSON 解析失败：' + String(e.message).slice(0, 40), 'err'); }
    const list = Array.isArray(data) ? data : (data && data.profiles);
    if (!Array.isArray(list) || !list.length) return toast('文件里没有 profiles 字段', 'err');
    const clean = list.slice(0, 3).map((p, i) => ({
      ...p,
      id: p.id || ('p' + (i + 1)),
      name: p.name || ('方案 ' + (i + 1))
    }));
    const active = data.activeProfile && clean.some((p) => p.id === data.activeProfile) ? data.activeProfile : clean[0].id;
    const res = await new Promise((r) => chrome.runtime.sendMessage({ type: 'setConfig', patch: { profiles: clean, activeProfile: active } }, r));
    if (!res?.ok) return toast('导入失败：' + (res?.error || '未知'), 'err');
    profiles = res.config.profiles || clean;
    activeProfileId = res.config.activeProfile || active;
    fillForm(res.config);
    renderProfiles();
    toast('已导入 ' + clean.length + ' 套方案', 'ok');
    file.value = '';
  });
})();

/* ---------- 实验性：图片翻译开关 + 模型检测 ---------- */
(function expSetup() {
  const box = document.getElementById('expImg');
  if (box) {
    box.addEventListener('change', () => {
      save(true);
      toast(box.checked ? '图片翻译已开启' : '图片翻译已关闭', 'ok');
    });
  }
  const diagBtn = document.getElementById('btnDiag');
  const diagOut = document.getElementById('diagOut');
  if (diagBtn && diagOut) {
    diagBtn.addEventListener('click', async () => {
      diagOut.style.display = 'block';
      diagOut.textContent = '诊断中…（会去找最近访问的网页标签）';
      const res = await new Promise((r) => chrome.runtime.sendMessage({ type: 'diag' }, r));
      if (!res || !res.ok) {
        diagOut.textContent = '失败：' + ((res && res.error) || '未知错误') + '\n目标页面：' + ((res && res.url) || '—');
        return;
      }
      const d = res.data || {};
      const lines = [];
      lines.push('目标页面: ' + (res.url || '—'));
      lines.push('可翻段落: ' + (d.total === undefined ? '—' : d.total));
      lines.push('过滤统计: ' + JSON.stringify(d.diag || {}));
      lines.push('命中样本: ' + JSON.stringify((d.sample || []).slice(0, 3)));
      lines.push('--- 被跳过的文本（前 20 条）---');
      const rej = d.rejected || [];
      if (rej.length) rej.forEach((x) => lines.push('[' + x.why + '] ' + x.text));
      else lines.push('（没有记录：要么全都收进来了，要么这页已经翻过）');
      diagOut.textContent = lines.join('\n');
    });
  }

  const btn = document.getElementById('btnModels');
  const out = document.getElementById('modelsOut');
  if (!btn || !out) return;
  btn.addEventListener('click', async () => {
    out.textContent = '拉取中…';
    const cfgNow = { baseUrl: $('#baseUrl').value.trim(), apiKey: $('#apiKey').value.trim() };
    const res = await new Promise((r) => chrome.runtime.sendMessage({ type: 'models', base: cfgNow.baseUrl, key: cfgNow.apiKey }, r));
    if (!res || !res.ok) { out.textContent = '失败：HTTP ' + (res && res.status); return; }
    let list = [];
    try {
      const j = JSON.parse(res.text || '{}');
      const arr = j.data || j.models || [];
      list = arr.map((m) => (typeof m === 'string' ? m : (m.id || m.name))).filter(Boolean);
    } catch (_) {}
    const vision = list.filter((m) => /vision|(^|[-_.])vl([-_.]|$)|4o|omni|multimodal|glm-4v|internvl|qwen.*vl/i.test(m));
    out.textContent = `共 ${list.length} 个 · 疑似支持图片：${vision.length ? vision.slice(0, 5).join('、') : '没找到'}`;
  });
})();

init();
