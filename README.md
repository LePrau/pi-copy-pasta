# pi-copy-pasta — extension

Copy-paste retrieval by ID. Every fenced code block in an **assistant text
part** or **thinking block** gets a session-wide id (1, 2, 3, …) and shows a
hint line above the fence:

```
**/cp 12** to copy
```

(bold command id + regular text — markdown has no grey/dim, this is the
closest achievable rendering). After a copy the hint flips to
`**/cp 12** ✓ copied` for ~1.5 s.

## Usage

- **`/cp`** — copy the most recently rendered block (possibly still
  streaming).
- **`/cp 12`** — copy block 12. Feedback as a notification toast
  (`/cp 12: copied 234 chars`).

With the optional core patch (below), the **whole code block is
click-to-copy** in fullscreen — click anywhere on the fence/body and the
hint flips `✓ copied` for ~1.5 s.

## Scope

- Assistant text parts + thinking blocks only (user messages get no ids —
  you already have that input and can scroll).
- Ids are session-wide, in memory (reset per pi process/session start),
  assigned in order of first appearance — including across the thinking and
  text parts of one message (they share a messageId; the registry is keyed
  by message + part type, so parts never collide).
- The copied code matches what pi renders: for backtick fences the fence's
  own indentation is stripped from the content lines (marked/CommonMark
  behaviour, measured against pi's parser); tilde fences keep all leading
  whitespace; a trailing run of whitespace at the very end of a block is
  trimmed (invisible on screen).
- An **unclosed** trailing fence (model didn't close it, or a single
  decorative fence) is a copyable block with its raw content as-is.
- Blocks inside thinking: clicking one copies it **without** toggling the
  thinking block (nested mouse region; with the patch). The /cp command
  works for thinking blocks too (same id space).

## Files

- `index.ts` — pi wiring: markdown transformer, `/cp` command,
  `globalThis.__cpPasta` hook for the core patch
  (`copyRef(messageId, messageType, ordinal)`, `copyId`, `clearFlip`,
  `lastId`).
- `lib.ts` — pure logic (segmenter, transform, id registry, copy) — no pi
  imports, testable in plain node (unit harness:
  `pi-agent/development/copy-pasta/lib-test.mjs` in the Qube workspace —
  not in this repo).
- `package.json` — extension manifest.
- `patch/` — the optional core patch (apply script + anchors/blocks + own
  README — see "Optional core patch" below).

## Install

Put this directory where pi discovers extensions (verified against pi
1.5.0's loader): the project dir `<workspace>/.pi/extensions/`, the global
agent dir (`~/.pi/agent/extensions/`, overridable via the
`PI_CODING_AGENT_DIR` env var — `<PROFILE>_CODING_AGENT_DIR` for named
profiles), or any extension path configured in pi's settings. From a Gitea clone:

```sh
git clone <your-gitea>/pi-copy-pasta <your-pi-workspace>/extensions/pi-copy-pasta
```

Restart pi. The `/cp` command and the hint lines appear as soon as the
extension loads (no patch required for that).

**Requirements:** pi **1.5.0 or 1.5.1** (bundled build — the extension
imports `copyToClipboard` from pi's own package). Clipboard is whatever pi's own
`copyToClipboard` uses (measured in the 1.5.0 package): on Linux
`wl-copy` under Wayland, `xclip`/`xsel` under X11, with an OSC 52 fallback
for remote sessions; macOS/Windows use their native paths. If your terminal
reports no clipboard tool and is not OSC 52-capable, copies will silently
fail — `/cp` still prints the char count in the toast.

## Supported versions

| pi version | status |
|---|---|
| **1.5.0** | supported — live-tested on a real install 2026-11-05 (v1 round 5, v2 round 6, v3 round 7); the current v3 (3-arg hook) final live TUI re-test is recorded as pending in the dev findings as of 2026-11-06 |
| **1.5.1** | supported — live-verified on a real install 2026-11-10 (applied via `--auto` on the 1.5.1 install; clicking code snippets in reasoning blocks copies to the clipboard); also VM-verified against the captured 1.5.1 bundle: extension loads cleanly through the real loader with the hook registered (probe-verified), and the core patch applies out of the box (anchor found, full apply/check/boot/rollback cycle) |
| 1.4.0 / 1.3.0 | **not supported by design** (decision 2026-11-06): the id model keys on `messageId`, which only exists in 1.5.0's transform context and message component; the core patch is also 1.5.0-only as shipped. Portability was evaluated (one shared patch anchor set would cover 1.3.0/1.4.0, plus a degraded "soft id" mode for the extension) — see the development findings, round 8 (`pi-agent/development/copy-pasta/` in the Qube workspace, not in this repo). |
| 0.87.x | not supported |

## Optional core patch

The `patch/` subfolder of this package (v3) — thin click forwarder: wraps
each code block in a mouse region, forwards clicks to this extension's
shared copy function. **No-op when this extension is not loaded** (renders
exactly stock pi). **1.5.0 / 1.5.1** (anchor-based; verified to apply
out of the box on both bundles).
Self-contained: the apply script reads its anchors/blocks from its own
directory, so it works from any clone of this repo. See `patch/README.md`
for what to look for and how to apply/roll back (`--auto`, `--check`,
`--rollback`, `.bak` restore).

## Built for

pi **1.5.0** — developed and live-verified on a Wayland session (v1/v2
rounds 5–6, 2026-11-05; copies via pi's own `copyToClipboard` → `wl-copy`);
**1.5.1** — patch + extension live-verified on a real install 2026-11-10.
