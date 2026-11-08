# relay — 极简翻译中转

一个单文件的 Node 服务（无依赖，只用 `http/https/fs/path`），给浏览器端当翻译代理用。

## 为什么需要它

- **Key 不下发**：浏览器只拿到「中转口令」，真正的 API key 留在服务端
- **限流**：默认每个 IP 每分钟 90 次
- **用量统计**：请求数、token 数、缓存命中率，带一个网页面板
- **跨上游**：可以用 `X-Halo-Upstream` 指定允许的上游（DeepSeek / 智谱 / Kimi / OpenAI…）

不用也完全可以——客户端选「直连」就行。

## 跑起来

```bash
HALO_TOKEN=换成你自己的口令 \
DEEPSEEK_KEY=sk-你的key \
PORT=3090 \
node server.js
```

HTTPS（可选）：

```bash
SSL_KEY=/path/to/key.pem SSL_CERT=/path/to/cert.pem node server.js
```

## 环境变量

| 变量 | 作用 |
|---|---|
| `HALO_TOKEN` | 中转口令，客户端填这个（或直接填自己的 `sk-`） |
| `DEEPSEEK_KEY` | 默认上游的 key |
| `PORT` | 监听端口，默认 3090 |
| `SSL_KEY` / `SSL_CERT` | 给了就走 HTTPS |
| `UPSTREAM_ALLOW` | 允许 `X-Halo-Upstream` 指过去的上游，逗号分隔 |

## 路由

| 路径 | 说明 |
|---|---|
| `POST /v1/chat/completions` | 转发到上游，支持流式 |
| `GET /health` | 健康检查 |
| `GET /stats` | 用量统计 JSON |
| `GET /panel` | 网页面板（请求数 / token / 缓存命中） |
| `POST /reset` | 清零统计 |
| `POST /log` | 客户端诊断上报，落到 `logs/` |
| `GET /haloflow.user.js` | 把同目录下的用户脚本发出去（可选） |
| `GET /haloflow.meta.js` | 只发元数据块，给 Tampermonkey 查版本 |

## 鉴权

`Authorization: Bearer <HALO_TOKEN>`，或者直接 `Bearer sk-xxxx` 透传自己的 key。

## 注意

- 这是个「够用就行」的实现，没做持久化，重启统计清零
- 想长期跑请挂 systemd / pm2，并放在反代后面
- 日志目录会一直长，记得定期清
