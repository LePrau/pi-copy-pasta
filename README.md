# pi-copy-pasta — extension

Ever wanted to copy a code snipptet right out off the session text?
Struggled with properly selecting it?
Annoyed that the copied formatting is not the correct formatting?

With copy-pasta you can copy those code-snippets.
The extension detects the snippets, gives them an ID and lets you simply
copy them to clipboard.
```
**/cp 12** to copy
```
## Usage

- **`/cp`** — copy the most recently rendered block (possibly still
  streaming).
- **`/cp 12`** — copy block 12. Feedback as a notification toast
  (`/cp 12: copied 234 chars`).
## Install

```sh
pi install git:LePrau/pi-copy-pasta
```
Restart pi. The `/cp` command and the hint lines appear as soon as the
extension loads (no patch required for that).

If you want click-to-copy, you need to patch pi itself.
There currently is no API to add click events to the session output.

Simply run:
```
node patch/apply-inline-copy.mjs --auto
```
to install the patch.

To remove the patch again:
```
node patch/apply-inline-copy.mjs --rollback
```

**Requirements:** pi **1.5.0** or greater (tested up to 1.5.2)
The extension imports `copyToClipboard` from pi's own package).
Clipboard is whatever pi's own `copyToClipboard` uses: 
- on Linux `wl-copy` under Wayland,`xclip`/`xsel` under X11,
  with an OSC 52 fallback for remote sessions
- macOS/Windows use their native paths.

If your terminal reports no clipboard tool and is not OSC 52-capable,
copies will silently fail — `/cp` still prints the char count in the toast.

## Supported versions

| pi version    | status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.5.0**     | supported — live-tested on a real install 2026-11-05 (v1 round 5, v2 round 6, v3 round 7); the current v3 (3-arg hook) final live TUI re-test is recorded as pending in the dev findings as of 2026-11-06                                                                                                                                                                                                                                                                                                                                       |
| **1.5.1**     | supported — live-verified on a real install 2026-11-10 (applied via `--auto` on the 1.5.1 install; clicking code snippets in reasoning blocks copies to the clipboard); also VM-verified against the captured 1.5.1 bundle: extension loads cleanly through the real loader with the hook registered (probe-verified), and the core patch applies out of the box (anchor found, full apply/check/boot/rollback cycle)                                                                                                                           |
| **1.5.2**     | supported — VM-verified against the captured 1.5.2 bundle 2026-11-19: the v3 patch applies out of the box (fresh-apply anchor matches verbatim in the bundle; full apply → `node --check` → boot (`--version` → 1.5.2) → `--check` → `--rollback` cycle, rollback byte-identical to pristine), and the extension loads cleanly through the real loader with the hook + session-start handler registered (probe-verified). Live test on a real 1.5.2 install: pending (the session-start notice will flag a missing/stale patch in the meantime) |
| 1.4.0 / 1.3.0 | **not supported by design** (decision 2026-11-06): the id model keys on `messageId`, which only exists in the 1.5.x transform context and message component. Portability was evaluated (one shared patch anchor set would cover 1.3.0/1.4.0, plus a degraded "soft id" mode for the extension) — see the development findings, round 8 (`pi-agent/development/copy-pasta/` in the Qube workspace, not in this repo).                                                                                                                            |
| 0.87.x        | not supported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Startup notice (patch-state detection)

If you forget to patch, or patch is removed due to updated pi,
you'll get a warning, that the copy-pasta patch is not (yet) applied.

You will only be nagged once per session.

