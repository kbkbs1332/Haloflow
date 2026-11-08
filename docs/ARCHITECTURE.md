# 架构

```
                    ┌────────────────────────────┐
   页面 DOM  ──────▶│ collectBlocks()            │
                    │  ├─ 严格规则（块级叶子）    │
                    │  ├─ 补充收集（漏网文本）    │
                    │  └─ 宽松兜底（整页文本节点）│
                    └────────────┬───────────────┘
                                 │ blocks[]
                                 ▼
                    ┌────────────────────────────┐
                    │ 分组：短文本 / 长文本       │
                    │  · 短：按字符数 ≤1200 分批  │
                    │  · 长：每段独立（>520 拆句）│
                    └────────────┬───────────────┘
                                 │ 并发 worker
                                 ▼
        ┌─────────────┐   ┌──────────────┐   ┌────────────┐
        │ 本地缓存命中 │   │ 直连 API      │   │ 中转 relay │
        └──────┬──────┘   └──────┬───────┘   └─────┬──────┘
               │                 │ 流式 SSE        │
               └────────┬────────┴─────────────────┘
                        ▼
              ┌──────────────────────┐
              │ applyTranslation()   │
              │  · replace：改文本节点│
              │  · both：写 data 属性 │
              └──────────┬───────────┘
                         ▼
                   CSS 伪元素渲染
```

## 目录

| 文件 | 职责 |
|---|---|
| `content.js` | 全部页面逻辑：收集、分组、请求、写回、悬浮球、设置面板、图片翻译、诊断 |
| `content.css` | 页面内译文样式（伪元素） |
| `background.js` | 扩展后台：转发请求（绕 CORS）、配置读写、方案切换 |
| `popup.*` | 工具栏弹窗：一键翻译 / 切模式 / 状态 |
| `options.*` | 设置页：三套方案、缓存、实验性功能、配置备份 |
| `newtab.*` | 可选的新标签页（搜索 + 星轨背景） |
| `userscript/haloflow.user.js` | 与 content.js 同源的用户脚本版本（单文件） |
| `relay/server.js` | 可选的中转服务 |

内容脚本和用户脚本是**两套代码、同一套逻辑**。改动时两边都要同步（这是历史原因，未来可以抽公共模块）。

## 关键设计

### 1. 写回只碰文本节点

```js
nodes[0].nodeValue = 译文;
for (let i = 1; i < nodes.length; i++) nodes[i].nodeValue = '';
```

元素节点（`img` / `svg` / `a`）一个都不动，所以图片永远不丢、链接结构永远完整。

### 2. 双语用伪元素

不插 `<div>`，因为 flex / grid 容器里多一个子元素就会错位：

```css
[data-haloflow-tr]::after {
  content: attr(data-haloflow-tr);
  display: block;
  border-left: 2px solid currentColor;
  opacity: .62;
}
```

横排导航这类「单行、矮、短文本」的元素会加 `data-haloflow-inline`，改成并排显示，否则译文掉到下一行会被父容器的 `overflow:hidden` 裁掉。

### 3. 收集的三级兜底

```
严格规则   p/li/h1..h6/td…，且不含块级子元素、子元素都是内联标签
   ↓ 一条都没收到
补充收集   扫所有没被覆盖的文本节点（救 div>span 的卡片、shadow DOM）
   ↓ 还是空
宽松模式   纯文本节点收集
   ↓ 还是空
忽略 translate="no" 再来一遍（用户主动点了翻译，就不该被站点声明拦住）
```

### 4. 别把容器当段落

三个专门的排除规则，都是踩过坑加上的：

| 判断 | 解决什么 |
|---|---|
| `isRowNav` | 横排导航条被整条当一个块，译文掉行被裁 |
| `looksLikeCards` | 卡片网格被整块合并，六张卡片的中文全塞进第一张 |
| `isLabelField` | `<strong>Item #:</strong> SCP-055` 这种只换标签、值保留；但正文太长（>80 字符）就不算字段，整段翻 |

### 5. 超时按空闲算

- **单个请求**：75 秒没有新数据才算挂（有数据就一直续命）
- **整轮翻译**：90 秒没有任何新段落完成才复位

按总时长算会把「正常跑两三分钟的大页面」杀掉。

### 6. DeepSeek V4 要显式关思考

```js
if (/deepseek/i.test(model) && effort === 'off') {
  body.thinking = { type: 'disabled' };
}
```

不关的话，流里 96% 是 `reasoning_content`，正文很可能直接为空。实测同一个请求：开思考 70KB，关思考 1.5KB。

### 7. 长段落拆句

超过 520 字符的段落，按句号/问号切开分别请求，再按顺序拼回去。避免「一次输出太长被 `max_tokens` 截断 → 整段丢失」。

## 请求链路

```
content.js ──┬─ 直连：GM_xmlhttpRequest / fetch(background 转发)
             └─ 中转：POST {relay}/v1/chat/completions
                       headers: Authorization + X-Halo-Upstream
```

流式解析是手写状态机，容忍 `content: null`、`reasoning_content`、`[DONE]`、断行残留。

## 诊断

`window.__haloflowDiag()` 返回：

```js
{
  total,              // 本轮能翻多少段
  diag: { … },        // 各过滤规则的命中计数
  sample: [ … ],      // 前 5 条文本
  rejected: [ … ]     // 被跳过的文本 + 原因（最多 20 条）
}
```

悬浮球菜单的「诊断」就是把它渲染成人能读的文本，可以复制或 POST 到 `/log`。
