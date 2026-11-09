# patch/ — core patch for pi 1.5.0 (v3)

Makes every fenced code block in assistant messages — in **text parts and
inside expanded thinking blocks** — a **click-to-copy** target in fullscreen
TUI mode: a left click anywhere on the block copies its raw code (fence
lines stripped, trailing whitespace removed) to the system clipboard, and
the inline `**/cp N** to copy` hint line flips to `**/cp N** ✓ copied`
for ~1.5 s.

This is the **v3** patch: a thin **click forwarder**. All copy logic, ids,
hints and the `/cp` command live in the **pi-copy-pasta extension** (the
folder containing this `patch/` directory); the patch only wraps each code
segment in a mouse region and forwards the click to the extension's
`globalThis.__cpPasta` hook.

- **With the extension loaded:** clicks copy, hints + `/cp` work.
- **Without the extension:** the patch is a **complete no-op** — every code
  block renders exactly like stock pi (byte-identical stock fallback
  branch), thinking clicks still toggle.

**Built for pi-coding-agent 1.5.0 bundled installs only** (anchor-based on
the 1.5.0 minified bundle). 1.3.0/1.4.0 were evaluated and deliberately
not shipped (decision 2026-11-06). If the anchor is not found the script
aborts cleanly — that is the version-mismatch signal.

## What to look for

The patch edits exactly **one** chunk file inside the installed
pi-coding-agent package:

```
…/node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks/<hash>.js
```

The script finds it by content (marker/anchor match), not by filename —
chunk names are build hashes and may differ. The package directory is:

- whatever contains `dist/bundle/chunks/`, i.e. the
  `@earendil-works/pi-coding-agent` package dir, or
- wherever your `pi` executable resolves to (the bundled `cli.js`, or a
  wrapper / managed install — the script handles all three, see below).

The script is **home- and path-agnostic**: it reads its companion files
relative to its own directory (this `patch/` folder) and resolves the pi
package dynamically. It works from any checkout/clone of this repo.

## How to invoke

```sh
node apply-inline-copy.mjs --pi-dir <…>/node_modules/@earendil-works/pi-coding-agent
node apply-inline-copy.mjs --auto              # resolves from `which pi`
node apply-inline-copy.mjs --pi-dir <dir> --check     # status only
node apply-inline-copy.mjs --pi-dir <dir> --rollback  # restore from .bak
```

- `--pi-dir <dir>` — explicit package directory (anything that contains
  `dist/bundle/chunks/`).
- `--auto` — resolves from `which pi`. Handles: the bundled `cli.js`
  itself; wrapper scripts (reads the wrapper for a package path, then
  walks up the directory tree); **managed installs** (a `…/bin/pi` wrapper
  plus `…/install/current-version` + `…/install/releases/<ver>/node_modules/…`).
  If it cannot resolve, it prints `cat <wrapper>` and tells you to use
  `--pi-dir`.
- A backup `<chunk>.js.bak` is written next to the chunk on first apply;
  the script is idempotent (`--check`) and reversible (`--rollback`
  restores whatever state the chunk had **before** this apply — pristine,
  v1, v2 or v3a).
- **Restart pi** after applying. Then load the pi-copy-pasta extension —
  hint lines appear, and clicking a block or running `/cp [id]` copies it.

## Patch states (auto-detected per chunk)

| state    | marker | what it is |
|---|---|---|
| pristine | unpatched anchor (`old-anchor-v2.txt`) | stock pi 1.5.0 |
| v1       | `COPY_PASTA_CLIPBIN` | text-part labels only (superseded) |
| v2       | `cpCopied` | text + thinking labels, sync flip (superseded) |
| v3a      | `copyRef`, 2-arg call | old thin click forwarder (superseded) |
| v3       | `copyRef`, 3-arg call | **current** thin click forwarder |

Applying from any state lands on the same v3 bytes:

- pristine → v3 (fresh apply)
- v1 → v3, v2 → v3, v3a → v3 (in-place upgrades — all land byte-identical)

`--check` prints the detected state; applying when already v3 is a no-op.

## Files

| file | role |
|---|---|
| `apply-inline-copy.mjs` | the apply/check/rollback script |
| `old-anchor-v2.txt` | the **pristine** (unpatched) region — the fresh-apply anchor |
| `new-block-v3.js` | the **v3** replacement block (what gets installed) |
| `old-anchor-v3.txt` | the full v2 region — anchor for the v2 → v3 upgrade |
| `old-anchor-v3b.txt` | the full old v3 (v3a) region — anchor for the v3a → v3 upgrade |
| `new-block.js` | the v2 block (kept so the v2→v3 upgrade can be validated) |
| `new-block-v1.js` | the v1 block (kept so the v1→v3 upgrade can be validated) |

All are readable text files — no diffs, no line numbers; replacement is an
exact single-occurrence string match, and the script re-verifies the
patched chunk before writing (syntax-checked region, no leftover markers).

## Verification status

Verified in a VM against a pristine pi 1.5.0 bundle capture (2026-11-04…06):
apply → `node --check` on the chunk → bundle boots (`--version` → 1.5.0) →
`--check` → `--rollback` → byte-identical to the pre-apply state; the v3
chunk is byte-identical across all upgrade paths. Live-tested on a real
install (rounds 5–7, 2026-11-05, incl. the per-part id fix and the
renderer-matching fence-indent rule). This copy of the apply script
differs from the verified dev build by exactly one line: companion-file
resolution uses `fileURLToPath(import.meta.url)` instead of
`new URL(import.meta.url).pathname` (robust to spaces/non-ASCII in paths
and to drive letters); the anchor/block files are byte-identical copies.

Development documentation (root cause, API surface, test rounds):
`pi-agent/development/copy-pasta/` in the Qube workspace.
