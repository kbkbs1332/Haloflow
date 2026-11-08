# HaloFlow · AI Bilingual Web Translator

[![Version](https://img.shields.io/badge/version-2.1.6-38f0d8?style=flat-square)](https://github.com/kbkbs1332/Haloflow/releases)
[![License](https://img.shields.io/badge/license-MIT-7c5cff?style=flat-square)](LICENSE)
[![Release](https://img.shields.io/github/v/release/kbkbs1332/Haloflow?style=flat-square&color=ffd23f)](https://github.com/kbkbs1332/Haloflow/releases)
[![Chrome](https://img.shields.io/badge/Chrome%20%2F%20Edge-MV3-blue?style=flat-square)](https://github.com/kbkbs1332/Haloflow)
[![Userscript](https://img.shields.io/badge/Tampermonkey-compatible-orange?style=flat-square)](https://github.com/kbkbs1332/Haloflow)


Translate whole web pages into Chinese (or any target language) **while keeping the original layout**.
Two modes: *replace* and *bilingual* (original + translation side by side).
Ships with selection popup, edge-snapping floating ball, three independent profiles, local cache, dynamic-content following, and an optional self-hosted relay.

> [中文文档](README.md) · English · [Homepage](https://kbkbs1332.github.io/Haloflow/)

- Form 1: **Chrome / Edge extension** (MV3) — options page, popup, optional new tab
- Form 2: **Userscript** (Tampermonkey et al.) — same capabilities, minus the new tab

Backend is any OpenAI-compatible `/chat/completions` endpoint: DeepSeek, GLM, Kimi, OpenAI, or your own relay.

---

## Why HaloFlow

- **Speed**: with a warm cache, a 119-block SCP article finishes in about 2 seconds. It streams as tokens arrive, translates short and long paragraphs in parallel, and splits long paragraphs at sentence boundaries. Works best with DeepSeek V4.1-Flash.
- **Translation quality**: the same term gets the same translation across the page, long sentences are split where the meaning breaks, and the original register (casual or technical) is kept. Numbers, code, variable names and URLs are left alone. The system prompt is editable.
- **Layout fidelity**: only text nodes are rewritten, never elements, so images, links and buttons stay intact. Bilingual mode appends the translation with pseudo-elements instead of inserting nodes, so grid and flex layouts don't shift, and dark sites follow automatically.

## Features

### Translation

- **Whole page**: replace mode / bilingual mode (translation injected with `::after` pseudo-elements, no extra DOM nodes, so grid & flex layouts stay intact)
- **Selection**: select text, get a popup
- **Streaming**: renders as tokens arrive; the first batch is sent early for a fast first screen
- **Concurrency**: short and long paragraphs are grouped separately and translated in parallel
- **Long paragraph splitting**: paragraphs over 520 chars are split at sentence boundaries, translated piecewise, then joined back
- **Cache**: translations stored locally (max 1200 entries), reused across mode switches and reloads
- **Dynamic content**: MutationObserver follows infinite scroll and translates newly inserted content
- **Abort**: "Restore original" cancels in-flight requests immediately

### Interaction

- **Floating ball**: drag to snap to an edge; tap for a menu (translate / mode / restore / diagnose / settings)
- **Three profiles**: each with its own base URL, key, model, prompt and target language; renamable, exportable / importable as a whole
- **Diagnostics**: one tap produces "how many blocks were collected / what was skipped / why"; copy it or upload it to your own relay

### Experimental

- **Image translation**: enable it, pick images on the page, a multimodal model OCRs them and returns boxes; canvas samples the background color, wraps text and replaces the image in place

---

## Install

### Extension

1. Open `chrome://extensions` (`edge://extensions` on Edge)
2. Enable "Developer mode"
3. "Load unpacked" → select the `extension/` folder

> You can also build a CRX yourself — see [docs/BUILD.md](docs/BUILD.md).

### Userscript

Drag `userscript/haloflow.user.js` into Tampermonkey, or create a new script and paste it.

---

## Configuration

Open settings (extension icon → settings; for the script: floating ball → settings):

| Field | Notes |
|---|---|
| Base URL | up to `/v1`, e.g. `https://api.deepseek.com/v1` |
| API Key | stored locally only |
| Model | e.g. `deepseek-flash`, `deepseek-v4-pro`, `glm-4-flash` |
| Forwarding | `direct` / `relay only` / `auto` |

**About the relay**: `relay/` is a minimal Node service that keeps your API key server-side and adds rate limiting plus usage stats. If you don't need it, choose "direct" — nothing to deploy.

To use your own relay, set `RELAY_BASE` in `userscript/haloflow.user.js`, or in the extension's `background.js`. The open-source default is empty (direct only).

---

## Self-hosting the relay (optional)

```bash
cd relay
HALO_TOKEN=your-token \
DEEPSEEK_KEY=sk-your-key \
PORT=3090 \
node server.js
```

Optional env vars:

- `SSL_KEY` / `SSL_CERT` — enable HTTPS
- `UPSTREAM_ALLOW` — allow-list for upstream passthrough

Endpoints:

- `POST /v1/chat/completions` — forward (`Authorization: Bearer <token>`, or pass your own `sk-...` straight through)
- `GET /health` `GET /stats` `GET /panel` — health / usage / HTML panel
- `POST /log` — client diagnostics sink (writes to `logs/`)

Details in [relay/README.md](relay/README.md).

---

## Implementation notes

If you plan to hack on this, these save time:

1. **Only text nodes are rewritten** (`nodeValue`), elements are never replaced — images, links and buttons always survive.
2. **Bilingual mode uses pseudo-elements**: `[data-haloflow-tr]::after { content: attr(data-haloflow-tr) }` — no DOM insertion, no flex/grid breakage.
3. **Three-tier collection**: strict rules → supplement pass (leftover text nodes) → loose mode (per text node). Only then a final pass that ignores page-level `translate="no"`.
4. **Never treat a container as a paragraph**: nav bars (`isRowNav`), card grids (`looksLikeCards`) and `<strong>Label:</strong> value` (`isLabelField`) each have dedicated guards — otherwise six card titles get crammed into the first card.
5. **DeepSeek V4 enables thinking by default**, which eats the entire output budget and leaves the answer empty — so `thinking: {type:'disabled'}` is mandatory.
6. **Timeouts are idle-based**, not total-duration: a big page legitimately takes 2–3 minutes.

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Known limitations

- Pure-image pages need "image translation"; it processes images one by one, no support for very long stitched images
- Cross-origin images without CORS taint the canvas, so image translation degrades to "white background + text"
- Sites that lazily render with `content-visibility` may lose a few blocks (use "Diagnose" to see exactly which)
- Bilingual translation inherits the original element's styles; dark sites follow automatically, but a handful need manual CSS tweaks

---

## License

MIT
