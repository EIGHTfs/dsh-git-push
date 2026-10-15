# assets/tree-sitter —— 随包发布的 tree-sitter 运行时与语法（**第三方，MIT**）

本目录是**第三方产物**，不是本项目源码。用途：给审计的「列级/语法级精筛」提供真语法树，
与 `lib/ast/*` 的自研 token 级判定形成互补（自研层始终保留为**回退路径**）。

## 内容与来源（钉死版本，勿随手升级）

| 文件 | 来源 | 版本 | 大小 | sha256（前 16 位） |
|---|---|---|---|---|
| `tree-sitter.js` | npm `web-tree-sitter` | **0.25.10** | 150,999 B | 见 `sha256sum` 现场复核 |
| `tree-sitter.wasm` | npm `web-tree-sitter` | **0.25.10** | 205,488 B | 同上 |
| `tree-sitter-javascript.wasm` | npm `tree-sitter-wasms` | 0.1.13 | 647,334 B | `63812b9e275d2685` |
| `tree-sitter-typescript.wasm` | npm `tree-sitter-wasms` | 0.1.13 | 2,342,690 B | `8515404dceed38e1` |
| `tree-sitter-python.wasm` | npm `tree-sitter-wasms` | 0.1.13 | 476,105 B | `9056d0fb0c337810` |
| `LICENSE` | npm `web-tree-sitter` | 0.25.10 | 1,085 B | —— |

> ⚠️ **运行时版本不要随手升**：实测 `web-tree-sitter@0.27.1` 与 `tree-sitter-wasms@0.1.13` 的语法
> **不兼容** —— `Language.load` 会在 `getDylinkMetadata` 处抛出**空消息**的 Error（0.26.0 同样失败 ✗）。
> 0.25.10 实测可加载同一批语法（`LANGUAGE_VERSION=15`）✓；换版本必须重跑 `lib/ast/treesitter.js` 的冒烟测试。

下载方式（可复现；CDN 直取，不走 npm install）：

```bash
WTS=0.25.10; TSW=0.1.13
# 注意：0.25.x 的文件名是 tree-sitter.js / tree-sitter.wasm（0.27.x 才是 web-tree-sitter.* ✗ 不兼容）
curl -sL -o tree-sitter.js          "https://cdn.jsdelivr.net/npm/web-tree-sitter@$WTS/tree-sitter.js"
curl -sL -o tree-sitter.wasm        "https://cdn.jsdelivr.net/npm/web-tree-sitter@$WTS/tree-sitter.wasm"
curl -sL -o LICENSE                 "https://cdn.jsdelivr.net/npm/web-tree-sitter@$WTS/LICENSE"
for L in javascript typescript python; do
  curl -sL -o "tree-sitter-$L.wasm" "https://cdn.jsdelivr.net/npm/tree-sitter-wasms@$TSW/out/tree-sitter-$L.wasm"
done
```

## 落库校验（每次改动本目录都要复核）

```bash
# ① 必须是真 wasm（魔数 \0asm）——曾把 CDN 的 404 错误页当 wasm 存进来过 ✗
for f in *.wasm; do printf '%s %s\n' "$(head -c4 "$f" | od -An -c | tr -d ' \n')" "$f"; done
# ② 与上表 sha256 对照
sha256sum *.wasm *.js
```

## 许可与合规

- `web-tree-sitter`（含 `web-tree-sitter.js` / `web-tree-sitter.wasm`）：**MIT**，许可证原文见同目录 `LICENSE`。
- 语法包 `tree-sitter-wasms` 内各语法由对应上游语法项目构建（各语法多为 MIT/Apache-2.0）；
  本目录只随包分发**预编译 wasm**，不改动其内容。
- 分发要求：保留 `LICENSE` 与来源说明（本文件即是）✓

## 语言集合口径（与审计规则包对齐）

**加载哪些语言 = `lib/audit-rules/` 里存在哪些「语言规则包」**（**空占位包也算** ✓）：

```
有规则的：nodejs(js/ts) · frontend(js/ts/css/html) · java · python
空占位包：cpp · go · php · rust · swift
```

当前试点已落 **javascript / typescript / python** 三个；
其余（java/go/rust/cpp/php/swift）按同一口径后续补入（每个约 0.3~2.3MB，**体积是主要代价** ✗）。

## 与自研层的关系（重要）

```
优先：能加载到语法 wasm ⇒ 用语法树确认「命中的那一处是不是真的语法节点」（如 string_fragment / comment ⇒ 不是代码）
回退：加载失败 / 无对应语法 / 超预算 ⇒ 退回 lib/ast/code-lines.js 的 token 级（行级 + 列级）判定
铁律：**新增规则字段必须同时登记 lib/rule/registry.js 的 withRuleScope 补丁点** ✗
      —— 否则会出现「单元测试通过、生产路径静默失效」（2026-10-15 实测踩到）
```
