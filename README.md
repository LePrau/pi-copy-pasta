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
  imports, testable in plain node (`pi-agent/development/copy-pasta/` holds
  the test harness).
- `package.json` — extension manifest.

## Optional core patch

`pi-agent/development/copy-pasta/patch-001-inline-copy/` (v3) — thin click
forwarder: wraps each code block in a mouse region, forwards clicks to this
extension's shared copy function. **No-op when this extension is not
loaded** (renders exactly stock pi). See the patch README for apply/rollback.

## Built for

pi **1.5.0** (the extension loads pi's own package for `copyToClipboard` —
Wayland `wl-copy` under the hood).
