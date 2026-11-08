/**
 * HaloFlow DeepSeek 中转站（BFF）
 * - 只转发 /v1/chat/completions
 * - 完整透传 SSE 流式响应
 * - X-Halo-Token 鉴权 + 每 IP 限流
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3090);
const UPSTREAM = 'https://api.deepseek.com';

// 允许客户端指定上游（白名单，防止变成开放代理）
const ALLOW_UPSTREAM = [
  'https://api.deepseek.com',
  'https://open.bigmodel.cn',
  'https://api.moonshot.cn',
  'https://api.openai.com',
  'https://api.siliconflow.cn',
  'https://dashscope.aliyuncs.com',
  'https://api.anthropic.com'
];

function pickUpstream(req) {
  const raw = String(req.headers['x-halo-upstream'] || '').trim();
  if (!raw) return { base: UPSTREAM, ok: true };
  const hit = ALLOW_UPSTREAM.find((b) => raw === b || raw.startsWith(b + '/') || raw.startsWith(b));
  if (!hit) return { base: UPSTREAM, ok: false };
  return { base: raw.replace(/\/+$/, ''), ok: true };
}
const TOKEN = process.env.HALO_TOKEN || '';
const KEY = process.env.DEEPSEEK_KEY || '';
const RATE_LIMIT = Number(process.env.RATE_LIMIT || 90);   // 每分钟每 IP 次数

if (!KEY) {
  console.error('缺少 DEEPSEEK_KEY 环境变量');
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const STATS_FILE = path.join(__dirname, 'stats.json');

function loadStats() {
  try {
    const raw = fs.readFileSync(STATS_FILE, 'utf8');
    const d = JSON.parse(raw);
    if (d && typeof d === 'object') {
      stats.req = d.req || 0;
      stats.ok = d.ok || 0;
      stats.err = d.err || 0;
      stats.limited = d.limited || 0;
      stats.tokIn = d.tokIn || 0;
      stats.tokOut = d.tokOut || 0;
      stats.cacheHit = d.cacheHit || 0;
      stats.cacheMiss = d.cacheMiss || 0;
      stats.aborted = d.aborted || 0;
      stats.hours = d.hours || Object.create(null);
      (d.ips || []).forEach(([ip, n]) => stats.ips.set(ip, n));
      stats.start = d.start || Date.now();
    }
  } catch (_) {}
}

let saveTimer = null;
function saveStats() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(STATS_FILE, JSON.stringify({
        start: stats.start, req: stats.req, ok: stats.ok, err: stats.err,
        limited: stats.limited, tokIn: stats.tokIn, tokOut: stats.tokOut,
        cacheHit: stats.cacheHit, cacheMiss: stats.cacheMiss,
        aborted: stats.aborted || 0,
      cacheHit: stats.cacheHit, cacheMiss: stats.cacheMiss,
        hours: stats.hours,
        ips: [...stats.ips.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
      }));
    } catch (_) {}
  }, 1500);
}

const stats = {
  start: Date.now(),
  req: 0, ok: 0, err: 0, limited: 0,
  tokIn: 0, tokOut: 0,
  hours: Object.create(null),
  ips: new Map(),
  recent: [],
  cacheHit: 0,
  cacheMiss: 0
};

function hourKey(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours());
}

function bumpHour() {
  const k = hourKey(new Date());
  stats.hours[k] = (stats.hours[k] || 0) + 1;
  saveStats();
  const keys = Object.keys(stats.hours).sort();
  while (keys.length > 48) delete stats.hours[keys.shift()];
}

const hits = new Map();
function allow(ip) {
  const now = Date.now();
  let rec = hits.get(ip);
  if (!rec || now - rec.t > 60000) {
    rec = { t: now, n: 0 };
    hits.set(ip, rec);
  }
  rec.n++;
  return rec.n <= RATE_LIMIT;
}
// 定期清理，避免内存涨
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of hits) if (now - rec.t > 180000) hits.delete(ip);
}, 60000);

const PANEL_HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HaloFlow 中转站</title>
<style>
:root{--bg:#05060b;--card:rgba(18,22,36,.72);--line:rgba(120,160,210,.16);--cyan:#38f0d8;--violet:#7c5cff;--text:#e8f4ff;--muted:#7f96ad}
*{box-sizing:border-box;margin:0;padding:0}
body{background:radial-gradient(120% 80% at 50% -10%,rgba(124,92,255,.18),transparent 60%),var(--bg);color:var(--text);
font:14px/1.6 -apple-system,"Segoe UI","PingFang SC",system-ui,sans-serif;padding:28px 16px;min-height:100vh}
.wrap{max-width:760px;margin:0 auto}
h1{font-size:20px;font-weight:600;letter-spacing:.02em;background:linear-gradient(96deg,#dffcff,#9ad7ff 40%,#c9b6ff);
-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:4px}
.sub{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);margin-bottom:20px;display:flex;align-items:center;gap:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;backdrop-filter:blur(12px)}
.k{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.v{font-size:24px;font-weight:600;color:#dffcff;font-variant-numeric:tabular-nums}
.v small{font-size:12px;color:var(--muted);font-weight:400;margin-left:4px}
.bars{display:flex;align-items:flex-end;gap:3px;height:70px;margin-top:10px}
.bars i{flex:1;background:linear-gradient(180deg,var(--cyan),rgba(124,92,255,.55));border-radius:3px 3px 0 0;min-height:2px;opacity:.85}
.list{font-size:12.5px;color:#a9c2d8}
.list div{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed rgba(120,160,210,.12)}
.list div:last-child{border:none}
.dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--cyan);box-shadow:0 0 8px var(--cyan);margin-right:6px}
</style></head><body><div class="wrap">
<h1>HaloFlow 中转站</h1>
<div class="sub"><span class="dot"></span><span id="up">运行中</span>
<button id="resetBtn" style="margin-left:auto;background:rgba(255,255,255,.05);border:1px solid rgba(120,160,210,.28);
color:#a9c2d8;border-radius:8px;padding:4px 12px;font-size:11px;cursor:pointer;font-family:inherit">清除数据</button></div>
<div class="grid" id="grid"></div>
<div class="card"><div class="k">最近 24 小时请求</div><div class="bars" id="bars"></div></div>
<div class="card" style="margin-top:12px"><div class="k">最近请求</div><div class="list" id="recent"></div></div>
<div class="card" style="margin-top:12px"><div class="k">今日活跃来源</div><div class="list" id="ips"></div></div>
<script>
async function tick(){
  try{
    const r = await fetch('/stats',{cache:'no-store'});
    const d = await r.json();
    const h = Math.floor(d.uptime/3600), m = Math.floor(d.uptime%3600/60);
    document.getElementById('up').textContent = '已运行 ' + h + 'h ' + m + 'm';
    const items = [
      ['总请求', d.req], ['成功', d.okCount], ['失败', d.err],
      ['限流拦截', d.limited], ['客户端中断', d.aborted || 0],
      ['缓存命中率', (() => {
        const t = (d.cacheHit || 0) + (d.cacheMiss || 0);
        return t ? (d.cacheHit / t * 100).toFixed(1) + '%' : '—';
      })()],
      ['缓存命中 token', (d.cacheHit || 0).toLocaleString()],
      ['输入 token', d.tokIn.toLocaleString()], ['输出 token', d.tokOut.toLocaleString()]
    ];
    document.getElementById('grid').innerHTML = items.map(([k,v]) =>
      '<div class="card"><div class="k">'+k+'</div><div class="v">'+v+'</div></div>').join('');
    const hs = d.hours || [];
    const max = Math.max(1, ...hs.map(x=>x.n));
    document.getElementById('bars').innerHTML = hs.map(x =>
      '<i style="height:'+(x.n/max*100)+'%" title="'+x.hour+' · '+x.n+'"></i>').join('') || '<span class="list">暂无数据</span>';
    document.getElementById('ips').innerHTML = (d.ips||[]).map(x =>
      '<div><span>'+x.ip+'</span><span>'+x.n+' 次</span></div>').join('') || '<div>暂无</div>';
    const rl = d.recent || [];
    document.getElementById('recent').innerHTML = rl.length
      ? rl.map(x => {
          const t = new Date(x.t);
          const hh = String(t.getHours()).padStart(2,'0')+':'+String(t.getMinutes()).padStart(2,'0')+':'+String(t.getSeconds()).padStart(2,'0');
          return '<div><span>'+(x.ok?'✓ ':'✗ ')+hh+'</span><span>'+x.ms+'ms · '+x.status+'</span></div>';
        }).join('')
      : '<div>暂无（如果刚翻译过但这里没记录，说明请求没走中转）</div>';
  }catch(e){ document.getElementById('up').textContent = '面板连接失败'; }
}
document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('确定清空所有统计数据？')) return;
  await fetch('/reset');
  tick();
});
tick(); setInterval(tick, 5000);
</script></body></html>`;

// 从一段文本里抠 usage（兼容非流式 JSON 和 SSE 尾部）
function absorbUsage(text) {
  if (!text) return;
  const hit = text.match(/"prompt_cache_hit_tokens"\s*:\s*(\d+)/);
  const miss = text.match(/"prompt_cache_miss_tokens"\s*:\s*(\d+)/);
  let touched = false;
  if (hit) { stats.cacheHit += Number(hit[1]); touched = true; }
  if (miss) { stats.cacheMiss += Number(miss[1]); touched = true; }
  const ti = text.match(/"prompt_tokens"\s*:\s*(\d+)/);
  const to = text.match(/"completion_tokens"\s*:\s*(\d+)/);
  if (ti) { stats.tokIn += Number(ti[1]); touched = true; }
  if (to) { stats.tokOut += Number(to[1]); touched = true; }
  if (touched) saveStats();
}

function handleRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, x-halo-token');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.url === '/reset') {
    stats.req = 0; stats.ok = 0; stats.err = 0; stats.limited = 0;
    stats.tokIn = 0; stats.tokOut = 0;
    stats.cacheHit = 0; stats.cacheMiss = 0;
    stats.aborted = 0;
    stats.hours = Object.create(null);
    stats.ips.clear();
    stats.recent.length = 0;
    stats.start = Date.now();
    saveStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, reset: true }));
  }

  // 只返回油猴脚本的元数据块，供 Tampermonkey 检查版本（省流量）
  if (req.url === '/haloflow.meta.js') {
    try {
      const js = fs.readFileSync(path.join(__dirname, 'haloflow.user.js'), 'utf8');
      const m = js.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      return res.end(m ? m[0] : '');
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }
  }

  if (req.url === '/haloflow.user.js') {
    try {
      const js = fs.readFileSync(path.join(__dirname, 'haloflow.user.js'), 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      return res.end(js);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }
  }

  // 客户端诊断日志上报（开发者版用）
  if (req.url === '/log' && req.method === 'POST') {
    let body = '';
    let tooBig = false;
    req.on('data', (c) => {
      if (tooBig) return;
      body += c;
      if (body.length > 2 * 1024 * 1024) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return;
      try {
        const dir = path.join(__dirname, 'logs');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
        const name = new Date().toISOString().replace(/[:.]/g, '-') + '_' + ip.replace(/[^0-9a-fA-F:.]/g, '') + '.json';
        const data = JSON.parse(body);
        data._ip = ip;
        data._at = new Date().toISOString();
        fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, name }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }

  if (req.url === '/haloflow.crx') {
    try {
      const buf = fs.readFileSync(path.join(__dirname, 'haloflow.crx'));
      res.writeHead(200, {
        'Content-Type': 'application/x-chrome-extension',
        'Content-Disposition': 'attachment; filename="haloflow.crx"',
        'Content-Length': buf.length,
        'Cache-Control': 'no-cache'
      });
      return res.end(buf);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }
  }

  if (req.url === '/haloflow-dev.crx') {
    try {
      const buf = fs.readFileSync(path.join(__dirname, 'haloflow-dev.crx'));
      res.writeHead(200, {
        'Content-Type': 'application/x-chrome-extension',
        'Content-Disposition': 'attachment; filename="haloflow-dev.crx"',
        'Content-Length': buf.length,
        'Cache-Control': 'no-cache'
      });
      return res.end(buf);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }
  }

  if (req.url === '/stats') {
    const uptime = Math.floor((Date.now() - stats.start) / 1000);
    const hours = [];
    for (let i = 23; i >= 0; i--) {
      const k = hourKey(new Date(Date.now() - i * 3600000));
      hours.push({ hour: k, n: stats.hours[k] || 0 });
    }
    const ips = [...stats.ips.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([ip, n]) => ({ ip, n }));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      ok: true, uptime,
      req: stats.req, okCount: stats.ok, err: stats.err, limited: stats.limited,
      aborted: stats.aborted || 0,
      cacheHit: stats.cacheHit, cacheMiss: stats.cacheMiss,
      tokIn: stats.tokIn, tokOut: stats.tokOut,
      hours, ips,
      recent: stats.recent
    }));
  }

  if (req.url === '/panel' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PANEL_HTML);
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, ts: Date.now() }));
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
  if (!allow(ip)) {
    stats.limited++;
    res.writeHead(429, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'rate limited, retry later' }));
  }

  // 鉴权：支持三种情况
  //   ① 中转口令（HALO_TOKEN）→ 用服务端保存的 DeepSeek key
  //   ② 以 sk- 开头的 key   → 视为用户自己的 key，直接透传给上游
  //   ③ 两个都不对         → 401 并给出明确原因
  const authHeader = String(req.headers['authorization'] || '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const given = String(req.headers['x-halo-token'] || bearer || '').trim();

  let upstreamKey = KEY;
  if (TOKEN && given === TOKEN) {
    upstreamKey = KEY;                     // 走中转口令
  } else if (given.startsWith('sk-')) {
    upstreamKey = given;                   // 用户自己的 key，透传
  } else if (!TOKEN) {
    upstreamKey = KEY;
  } else {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      error: '口令不对。这里要填中转口令（HALO_TOKEN），不是 DeepSeek 的 sk-；或者直接填你自己的 sk- 也可以。'
    }));
  }

  const upPick = pickUpstream(req);
  if (!upPick.ok) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: '不允许的上游地址，请检查 Base URL' }));
  }

  if (!req.url.startsWith('/v1/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'only /v1/chat/completions is proxied' }));
  }

  stats.req++;
  const reqStart = Date.now();
  bumpHour();
  stats.ips.set(ip, (stats.ips.get(ip) || 0) + 1);

  // 正确拼接：base 若已带 /v1、/api/paas/v4 之类的前缀，不能再用 new URL(绝对路径, base)
  let relPath = req.url;
  if (/\/v\d+[\w.]*$/.test(upPick.base)) {
    relPath = req.url.replace(/^\/v\d+/, '');
  }
  const targetUrl = upPick.base.replace(/\/+$/, '') + relPath;
  const upHeaders = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + upstreamKey,
    Accept: req.headers['accept'] || 'text/event-stream'
  };

  let target;
  try { target = new URL(targetUrl); } catch (_) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: '上游地址无法解析：' + targetUrl }));
  }

  const up = https.request(
    { hostname: target.hostname, path: target.pathname + target.search, method: 'POST', headers: upHeaders },
    (ur) => {
      const okUp = ur.statusCode >= 200 && ur.statusCode < 300;
      if (okUp) stats.ok++; else stats.err++;

      res.on('finish', () => {
        stats.recent.unshift({
          t: Date.now(),
          ip: ip.slice(0, 24),
          ok: okUp,
          status: ur.statusCode,
          ms: Date.now() - reqStart
        });
        if (stats.recent.length > 25) stats.recent.length = 25;
        saveStats();
      });

      const ctype = String(ur.headers['content-type'] || '');
      res.writeHead(ur.statusCode || 502, {
        'Content-Type': ctype || 'application/json',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no'
      });

      if (ctype.includes('application/json')) {
        const chunks = [];
        ur.on('data', (c) => { if (chunks.length < 64) chunks.push(c); });
        ur.on('end', () => {
          const buf = Buffer.concat(chunks);
          absorbUsage(buf.toString('utf8'));
          res.end(buf);
        });
      } else {
        // 流式：边转发边缓冲尾部，用于抓最后一块里的 usage
        let tail = '';
        ur.on('data', (chunk) => {
          try { res.write(chunk); } catch (_) {}
          tail = (tail + chunk.toString('utf8')).slice(-6000);
        });
        ur.on('end', () => {
          absorbUsage(tail);
          try { res.end(); } catch (_) {}
        });
        ur.on('error', () => { try { res.end(); } catch (_) {} });
      }
    }
  );

  up.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    try { res.end(JSON.stringify({ error: 'upstream error: ' + e.message })); } catch (_) {}
  });

  // 客户端中途断开（用户点恢复/关标签页）→ 立即掐断到 DeepSeek 的上游连接
  let finished = false;
  res.on('close', () => {
    if (finished) return;
    finished = true;
    if (!res.writableEnded) {
      try { up.destroy(); } catch (_) {}
      stats.aborted = (stats.aborted || 0) + 1;
      saveStats();
    }
  });

  req.pipe(up);
}

loadStats();
setInterval(saveStats, 30000);


// 按环境变量决定 HTTP / HTTPS（有证书就走 TLS）
const server = (() => {
  const keyPath = process.env.SSL_KEY;
  const certPath = process.env.SSL_CERT;
  if (keyPath && certPath && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    console.log('[halo-relay] HTTPS 模式');
    return https.createServer(
      { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
      handleRequest
    );
  }
  console.log('[halo-relay] HTTP 模式（未配置证书）');
  return http.createServer(handleRequest);
})();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[halo-relay] listening on 0.0.0.0:${PORT} (stats file: ${STATS_FILE})`);
});
