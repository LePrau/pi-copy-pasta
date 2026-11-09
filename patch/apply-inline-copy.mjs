#!/usr/bin/env node
// pi-copy-pasta · patch-001-inline-copy · apply script
//
// Patches an installed pi-coding-agent (pi 1.5.0, bundled build) so every
// fenced code block in assistant TEXT parts and expanded THINKING blocks
// becomes click-to-copy (fullscreen TUI): a left click anywhere on the block
// copies its raw code. The copy itself is done by the pi-copy-pasta
// EXTENSION (the folder containing this patch/ directory) — the patch is a
// thin click forwarder: it wraps each code block in a mouse region and calls the
// extension's globalThis.__cpPasta hook.
//
//   - With the extension loaded: clicks copy (the "⧉ /cp N" hint line flips
//     to "✓ copied" for ~1.5 s); the hint + /cp command come from the
//     extension, not the patch.
//   - Without the extension: the patch is a COMPLETE NO-OP — every code block
//     renders exactly like stock pi (its stock fallback branch is verbatim),
//     thinking clicks still toggle.
//
// The installed package ships as a minified bun bundle, so the patch is an
// anchor-based string replacement on exactly one chunk file — no diff/line
// numbers, resilient to chunk renames. A .bak backup is written next to the
// chunk; --rollback restores it (returns to the pre-apply state: pristine,
// v1 or v2, whichever it was).
//
// Patch states (detected per chunk):
//   pristine — original anchor present (old-anchor-v2.txt)
//   v1       — COPY_PASTA_CLIPBIN marker: labels on text parts only (wl-copy
//              spawn in-chunk, no click feedback)
//   v2       — cpCopied marker: labels on text + thinking, sync "✓ copied"
//              flip (superseded by v3 — kept for in-place upgrade)
//   v3       — copyRef marker (current): thin click forwarder to the
//              extension hook, gated active/stock split, timer-deferred flip
//
// usage:
//   node apply-inline-copy.mjs --pi-dir <package-dir>   # explicit package dir
//   node apply-inline-copy.mjs --auto                   # resolve from `which pi`
//   node apply-inline-copy.mjs --pi-dir <dir> --check   # status only
//   node apply-inline-copy.mjs --pi-dir <dir> --rollback
//
// <package-dir> = …/node_modules/@earendil-works/pi-coding-agent

import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const V3_MARK = "copyRef"; // appears (twice) only in the v3 block
const V2_MARK = "cpCopied"; // appears only in the v2 block
const V1_MARK = "COPY_PASTA_CLIPBIN"; // appears only in the v1 block

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const looksLikePkg = (d) => existsSync(path.join(d, "dist", "bundle", "chunks"));

let piDir;
if (opt("--pi-dir")) {
	piDir = path.resolve(opt("--pi-dir"));
} else if (flag("--auto")) {
	let real = undefined;
	try {
		real = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
	} catch { /* not on PATH */ }
	if (!real) {
		console.error("pi not found on PATH — use --pi-dir <package-dir>");
		process.exit(2);
	}
	try {
		real = execFileSync("readlink", ["-f", real], { encoding: "utf8" }).trim();
	} catch { /* not a symlink */ }
	// strategy 1: the resolved path is the bundled cli.js itself
	const m = real.match(/^(.*)\/dist\/bundle\/cli\.js$/);
	if (m) {
		piDir = m[1];
	} else {
		// strategy 2: the resolved file is a wrapper — look for a package path inside it
		let found = undefined;
		try {
			const src = readFileSync(real, "utf8");
			if (src.length < 200000) {
				const pm = src.match(/[^\s"'`]*node_modules[^\s"'`]*pi-coding-agent[^\s"'`]*/);
				if (pm) {
					let cand = path.resolve(path.dirname(real), pm[0]);
					const dm = cand.match(/^(.*)\/dist\/bundle\/cli\.js$/);
					if (dm) cand = dm[1];
					if (looksLikePkg(cand)) found = cand;
				}
			}
		} catch { /* not readable — fall through */ }
		// strategy 3: walk up from the wrapper — plain package, or a managed install
		// (…/bin/pi with …/install/current-version + …/install/releases/<ver>/node_modules/…)
		if (!found) {
			let d = path.dirname(real);
			while (d !== path.dirname(d)) {
				const cand = path.join(d, "node_modules", "@earendil-works", "pi-coding-agent");
				if (looksLikePkg(cand)) { found = cand; break; }
				if (looksLikePkg(d)) { found = d; break; }
				const verFile = path.join(d, "install", "current-version");
				if (existsSync(verFile)) {
					try {
						const ver = readFileSync(verFile, "utf8").trim();
						const mc = path.join(d, "install", "releases", ver, "node_modules", "@earendil-works", "pi-coding-agent");
						if (looksLikePkg(mc)) { found = mc; break; }
					} catch { /* unreadable version file */ }
				}
				d = path.dirname(d);
			}
		}
		if (!found) {
			console.error(`could not auto-resolve the pi package dir from: ${real}`);
			console.error(`  run: cat "${real}"   (shows where the wrapper points)`);
			console.error(`  then use: node apply-inline-copy.mjs --pi-dir <package-dir>`);
			process.exit(2);
		}
		piDir = found;
	}
} else {
	console.error("usage: node apply-inline-copy.mjs (--pi-dir <dir> | --auto) [--check | --rollback]");
	process.exit(2);
}

const chunksDir = path.join(piDir, "dist", "bundle", "chunks");
if (!existsSync(chunksDir)) {
	console.error(`no bundled chunks dir at ${chunksDir} — is this a pi 1.5.0 bundled install?`);
	process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const pristineAnchor = readFileSync(path.join(here, "old-anchor-v2.txt"), "utf8").replace(/\n$/, "");
const v1Block = readFileSync(path.join(here, "new-block-v1.js"), "utf8").replace(/\n$/, "");
const v2Block = readFileSync(path.join(here, "new-block.js"), "utf8").replace(/\n$/, "");
const v2Anchor = readFileSync(path.join(here, "old-anchor-v3.txt"), "utf8").replace(/\n$/, "");
const v3Block = readFileSync(path.join(here, "new-block-v3.js"), "utf8").replace(/\n$/, "");
const v3aBlock = readFileSync(path.join(here, "old-anchor-v3b.txt"), "utf8").replace(/\n$/, "");

const V3B_MARK = 'copyRef(this.messageId,"assistant",ordN)'; // once only in the v3 (new) block
const V3A_CALL = "copyRef(this.messageId,ordN)"; // twice only in the v3a (old, 2-arg) block
const count = (haystack, needle) => haystack.split(needle).length - 1;

// Classify every chunk; the patch lives in exactly one.
let state = undefined; // "pristine" | "v1" | "v2" | "v3a" | "v3"
let target = undefined; // the chunk (file + source)
for (const f of readdirSync(chunksDir).filter((x) => x.endsWith(".js"))) {
	const p = path.join(chunksDir, f);
	const s = readFileSync(p, "utf8");
	if (s.includes(V3_MARK)) { state = s.includes(V3B_MARK) ? "v3" : "v3a"; target = { file: p, s }; break; }
	if (s.includes(V2_MARK)) { state = "v2"; target = { file: p, s }; break; }
	if (s.includes(V1_MARK)) { state = "v1"; target = { file: p, s }; continue; }
	if (s.includes(pristineAnchor)) { state = "pristine"; target = { file: p, s }; break; }
}

if (flag("--rollback")) {
	if (!state) {
		console.error("no copy-pasta patch found — nothing to roll back.");
		process.exit(1);
	}
	if (state === "pristine") {
		console.log("not applied — nothing to roll back.");
		process.exit(0);
	}
	const bak = target.file + ".bak";
	if (!existsSync(bak)) {
		console.error(`patched (${state}) but no backup found at ${bak} — cannot roll back.`);
		process.exit(1);
	}
	const bakSrc = readFileSync(bak, "utf8");
	const backTo = bakSrc.includes(V3B_MARK) ? "v3" : bakSrc.includes(V3_MARK) ? "v3a" : bakSrc.includes(V2_MARK) ? "v2" : bakSrc.includes(V1_MARK) ? "v1" : "pristine";
	copyFileSync(bak, target.file);
	console.log(`rolled back: restored ${target.file} from ${bak} (back to ${backTo}).`);
	console.log("restart pi to take effect.");
	process.exit(0);
}

if (flag("--check")) {
	if (!state) {
		console.error("no copy-pasta state found (neither v1/v2/v3 block nor pristine anchor) — pi version mismatch?");
		process.exit(1);
	}
	console.log({
		pristine: "not applied (anchor found)",
		v1: "v1 applied (text labels, wl-copy spawn, no feedback)",
		v2: "v2 applied (text + thinking labels, sync ✓ copied flip)",
		v3a: "v3a applied (old thin click forwarder, 2-arg hook — upgrade to v3)",
		v3: "v3 applied (thin click forwarder → pi-copy-pasta extension; no-op without it)",
	}[state] + ` — chunk ${path.basename(target.file)}.`);
	process.exit(0);
}

if (state === "v3") {
	console.log("already applied (v3). Use --rollback to undo, or --check for status.");
	process.exit(0);
}
if (state === "v3a") {
	// upgrade below (old 2-arg hook → 3-arg hook)
}
if (!state) {
	console.error("no patchable state found (no pristine anchor, no v1/v2 block) — pi version mismatch (built for 1.5.0).");
	process.exit(1);
}

// Region layout:
//   pristineAnchor = TR + L + origTextBranch + origThinking
//   v3Block        = TR + P3 + L + T3 + NV3   (TR = "thinkingRunIndex=0;",
//                                               P3 = helper preamble, T3 = v3 text branch,
//                                               NV3 = v3 thinking branch)
//   v2→v3 upgrade: v2Anchor (= the full v2 region in a v2 chunk) → v3Block
//   v1→v3 upgrade: L + v1Block + origThinking → P3 + L + T3 + NV3
//   v3a→v3 upgrade: v3aBlock (= the full old v3 region) → v3Block
//   pristine→v3:   pristineAnchor → v3Block
// All four land on byte-identical bytes: TR + P3 + L + T3 + NV3.
const TR = "thinkingRunIndex=0;";
const L = "for(let i=0;i<message.content.length;i++){let content=message.content[i];";
const origThinkingStart = pristineAnchor.indexOf('else if(content.type==="thinking")');
if (
	!pristineAnchor.startsWith(TR + L) ||
	origThinkingStart < 0 ||
	!v3Block.startsWith(TR) ||
	count(v3Block, L) !== 1 ||
	count(v3Block, V3_MARK) !== 2 ||
	count(v3Block, V3B_MARK) !== 1 ||
	count(v3aBlock, V3A_CALL) !== 2 ||
	v3aBlock.includes(V3B_MARK) ||
	v2Anchor !== v2Block
) {
	console.error("internal error: anchor/block layout mismatch (pi version?)");
	process.exit(1);
}
const origThinking = pristineAnchor.slice(origThinkingStart);
const bodyV3 = v3Block.slice(TR.length); // P3 + L + T3 + NV3

let oldText, replacement;
if (state === "v2") { oldText = v2Anchor; replacement = v3Block; }
else if (state === "v3a") { oldText = v3aBlock; replacement = v3Block; }
else if (state === "v1") { oldText = L + v1Block + origThinking; replacement = bodyV3; }
else { oldText = pristineAnchor; replacement = v3Block; }

const n = count(target.s, oldText);
if (n !== 1) {
	const regionName = { v2: "v2 region", v3a: "old v3 (v3a) region", v1: "v1+original-thinking region", pristine: "pristine anchor" }[state];
	console.error(`expected exactly 1 occurrence of the ${regionName} in ${path.basename(target.file)}, found ${n}; aborting.`);
	process.exit(1);
}

const bak = target.file + ".bak";
if (!existsSync(bak)) copyFileSync(target.file, bak);
const patched = target.s.replace(oldText, replacement);
if (!patched.includes(TR + bodyV3) || patched.includes(oldText) || count(patched, V3_MARK) !== 2 || count(patched, V3B_MARK) !== 1 || patched.includes(V3A_CALL) || patched.includes(V2_MARK) || patched.includes(V1_MARK)) {
	console.error("post-patch verification failed; original file left untouched.");
	process.exit(1);
}
writeFileSync(target.file, patched);
console.log(`${state === "v2" ? "upgraded v2 → v3" : state === "v3a" ? "upgraded v3a → v3 (2-arg hook → 3-arg hook)" : state === "v1" ? "upgraded v1 → v3" : "applied v3"} on chunk ${path.basename(target.file)} (backup: ${path.basename(bak)}).`);
console.log("restart pi to take effect. Load the pi-copy-pasta extension (the folder containing this patch/ directory): each code block shows a '/cp N to copy' hint line; click the block or run /cp [id] to copy — the hint flips to '✓ copied' for ~1.5 s.");
