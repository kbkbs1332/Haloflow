# HaloFlow · AI 双语网页翻译

[![Version](https://img.shields.io/badge/version-2.1.6-38f0d8?style=flat-square)](https://github.com/kbkbs1332/Haloflow/releases)
[![License](https://img.shields.io/badge/license-MIT-7c5cff?style=flat-square)](LICENSE)
[![Release](https://img.shields.io/github/v/release/kbkbs1332/Haloflow?style=flat-square&color=ffd23f)](https://github.com/kbkbs1332/Haloflow/releases)
[![Chrome](https://img.shields.io/badge/Chrome%20%2F%20Edge-MV3-blue?style=flat-square)](https://github.com/kbkbs1332/Haloflow)
[![Userscript](https://img.shields.io/badge/Tampermonkey-compatible-orange?style=flat-square)](https://github.com/kbkbs1332/Haloflow)


> 中文 · [English](README.en.md) · **[官网](https://kbkbs1332.github.io/Haloflow/)** · [下载最新版](https://github.com/kbkbs1332/Haloflow/releases/latest)

把网页整页翻成中文，**保留原样式**，支持「直接替换」和「原文+译文双语」两种模式。
带划词翻译、吸边悬浮球、三套独立方案、本地缓存、动态内容跟随，还有一个可选的自建中转服务。

- 形态一：**Chrome / Edge 扩展**（MV3）— 含设置页、弹窗、新标签页
- 形态二：**用户脚本**（Tampermonkey 等）— 能力与扩展基本一致，去掉新标签页

翻译后端是任意 OpenAI 兼容的 `/chat/completions` 接口，DeepSeek / GLM / Kimi / OpenAI / 自建中转都行。

---

## 为什么用它

- **速度**：SCP 文档整页 119 段约 2 秒翻完；GitHub markdown 页面 1153 段 25 秒。做法是流式输出边收边写、长短文本分组并发、超长段落按句拆开分别翻。搭配 DeepSeek V4.1-Flash 表现最好。
- **翻译质量**：同一术语全文用同一个译法，长句按语义断开，原文是口语还是技术口吻就保留哪种。数字、代码、变量名和 URL 不译。提示词可以自己改。
- **样式匹配**：只改文本节点，不替换元素，所以图片、链接、按钮的结构不会坏。双语模式用伪元素追加译文，不往 DOM 里插节点，grid 和 flex 布局不会错位；深色站点自动跟随配色。

## 功能

### 翻译

- **整页翻译**：替换模式 / 双语模式（译文用 `::after` 伪元素追加，不插 DOM 节点，不会破坏 grid / flex）
- **划词翻译**：选中文字弹出浮窗；切到「高考」模式会给出**词性 / 词组 / 派生 / 例句**
- **流式输出**：边收边写，首屏先发一小批
- **并发**：长短文本分组、各自并发，大页面也能在几十秒内跑完
- **长段落拆句**：超长段落自动按句子切开分别翻译再拼回，避免输出被截断
- **缓存**：译过的句子本地存着（上限 1200 条），切模式 / 重开页面直接复用
- **动态内容**：MutationObserver 跟随，滚动加载的新内容自动补翻
- **中断**：随时「恢复原文」，在途请求一并掐断

### 交互

- **吸边悬浮球**：拖拽停靠，点开是菜单（翻译 / 切模式 / 恢复 / 诊断 / 设置）
- **三套方案**：各自独立的 Base URL、Key、模型、提示词、目标语言，可重命名、可整包导出导入
- **诊断报告**：一键生成「收集了多少段 / 哪些被跳过 / 为什么」，可复制或上报到自己部署的中转

### 实验性

- **图片翻译**：开启后悬浮球菜单多一项，点选页面图片 → 多模态模型识别文字并给框 → canvas 采样背景色、自动折行嵌字，直接替换原图

---

## 安装

### 扩展

1. 打开 `chrome://extensions`（Edge 是 `edge://extensions`）
2. 右上角打开「开发者模式」
3. 「加载已解压的扩展程序」→ 选 `extension/` 目录

> 也可以自己打包成 CRX，见 [docs/BUILD.md](docs/BUILD.md)。

### 用户脚本

把 `userscript/haloflow.user.js` 拖进 Tampermonkey，或新建脚本粘贴内容。

---

## 配置

打开设置（扩展点图标 → 设置；脚本点悬浮球 → 设置），填：

| 项 | 说明 |
|---|---|
| Base URL | 填到 `/v1`，例如 `https://api.deepseek.com/v1` |
| API Key | 你的 key，只存在本机 |
| 模型 | 例如 `deepseek-flash`、`deepseek-v4-pro`、`glm-4-flash` |
| 请求转发 | `直连` / `仅中转` / `自动` |

**关于「中转」**：仓库里的 `relay/` 是一套极简 Node 中转服务，作用有两个——把 key 留在服务端不暴露给浏览器、顺便做限流和用量统计。用不到就选「直连」，不需要部署。

想接自己的中转：改 `userscript/haloflow.user.js` 里的 `RELAY_BASE`，或扩展里 `background.js` 的 `RELAY_BASE`。默认为空（只直连）。

---

## 自建中转（可选）

```bash
cd relay
HALO_TOKEN=你的口令 \
DEEPSEEK_KEY=sk-你的key \
PORT=3090 \
node server.js
```

可选环境变量：

- `SSL_KEY` / `SSL_CERT`：给了就走 HTTPS
- `UPSTREAM_ALLOW`：允许透传的上游白名单

接口：

- `POST /v1/chat/completions` — 转发（`Authorization: Bearer <口令>` 或直接 `Bearer sk-xxx` 透传）
- `GET /health` `GET /stats` `GET /panel` — 健康检查 / 用量 / 网页面板
- `POST /log` — 客户端诊断上报（存 `logs/`）

细节见 [relay/README.md](relay/README.md)。

---

## 实现要点

想改代码的话，这几条能省不少时间：

1. **写回只碰文本节点**（`nodeValue`），从不替换元素。所以图片、链接、按钮结构永远不丢。
2. **双语靠伪元素**：`[data-haloflow-tr]::after { content: attr(data-haloflow-tr) }`，不新增 DOM 节点，flex/grid 不会变形。
3. **收集有三级兜底**：严格规则 → 补充收集（扫没覆盖到的文本节点）→ 宽松模式（按文本节点收）。最后才用「整页 translate="no" 也忽略」的强兜底。
4. **别把容器当段落**：导航条（`isRowNav`）、卡片网格（`looksLikeCards`）、`<strong>标签:</strong> 值`（`isLabelField`）都有专门判断，否则会出现「六张卡片的中文全塞进第一张」。
5. **DeepSeek V4 默认开思考**，会把输出预算吃光导致正文为空，所以 `thinking: {type:'disabled'}` 是必须的。
6. **超时按空闲算**，不按总时长：长文档跑两三分钟很正常，按总时长会把好活杀掉。

更多见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

---

## 已知限制

- 纯图片页面（整页是一张长图）需要开「图片翻译」，它是逐张处理的，不支持超长拼接图
- 跨域图片如果没开 CORS，canvas 会污染，图片翻译会退化成「白底 + 译文」
- 依赖页面的可见性判断，个别用 `content-visibility` 做懒渲染的站点可能漏段（用「诊断」能看到）
- 双语模式下译文样式继承原文，深色站点会自动跟随，但极个别站点需要手动改 CSS

---

## License

MIT
