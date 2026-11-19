/**
 * pi-copy-pasta — pure logic (no pi imports; unit-testable in plain node).
 *
 * Id model: every fenced code block in an assistant text part or thinking
 * block gets a session-wide id (1, 2, 3, …) assigned in order of first
 * appearance. The markdown transform inserts a hint line above each fence
 * (the id part is bold):
 *
 *     <bold>/cp 12</bold> to copy        →  <bold>/cp 12</bold> ✓ copied   (after a copy, ~1.5 s)
 *
 * Hints are part of the transformed text, so they appear on every render —
 * including the final one (no event-driven lag).
 *
 * Clipboard: pi's own copyToClipboard (Wayland wl-copy under the hood) —
 * injected as a parameter so this file stays importable without pi.
 */

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export interface CpSegment {
	/** true for a fenced code block (fence lines included in `text`). */
	code: boolean;
	/** Full segment text — code: incl. fence lines; prose: verbatim. */
	text: string;
	/** Code only: body without fence lines, trailing whitespace stripped. */
	raw?: string;
}

export interface CpState {
	nextId: number;
	lastId: number | null;
	/** messageId+messageType → id per code-block ordinal (0-based, in text order). */
	perMessage: Map<string, number[]>;
	/** id → latest raw body (re-set on every render). */
	registry: Map<number, string>;
	/** ids currently showing "✓ copied". */
	flipped: Set<number>;
}

export function cpNewState(): CpState {
	return { nextId: 1, lastId: null, perMessage: new Map(), registry: new Map(), flipped: new Set() };
}

const CP_FENCE = /^([ ]{0,3})(`{3,}|~{3,})(.*)$/;

/** CommonMark fence opener: ≤3 spaces indent, ≥3 backticks/tildes, no fence char in info string. */
function cpFenceM(line: string): RegExpExecArray | null {
	const m = CP_FENCE.exec(line);
	return m && !m[3].includes(m[2][0]) ? m : null;
}

/** CommonMark fence closer: same char, length ≥ opener, only trailing whitespace. */
function cpCloseM(line: string, ch: string, len: number): boolean {
	const m = /^([ ]{0,3})(`{3,}|~{3,})[ \t]*$/.exec(line);
	return !!(m && m[2][0] === ch && m[2].length >= len);
}

/**
 * Split text into prose / fenced-code segments using strict CommonMark fence
 * rules — matches pi's own markdown renderer. An unclosed trailing fence is
 * a code segment (streaming / model didn't close it).
 */
export function cpSegsOf(text: string): CpSegment[] {
	const lines = text.split("\n");
	const segs: CpSegment[] = [];
	let i = 0;
	while (i < lines.length) {
		const st = cpFenceM(lines[i]);
		if (!st) {
			let j = i;
			while (j < lines.length && !cpFenceM(lines[j])) j++;
			segs.push({ code: false, text: lines.slice(i, j).join("\n") });
			i = j;
			continue;
		}
		const ch = st[2][0];
		const len = st[2].length;
		let k = i + 1;
		let closed = -1;
		while (k < lines.length) {
			if (cpCloseM(lines[k], ch, len)) {
				closed = k;
				k++;
				break;
			}
			k++;
		}
		// raw matches what pi's parser (marked 18.0.11, measured 2026-11-05) shows:
		// for BACKTICK fences, exactly the fence's indent (0–3) of leading spaces is
		// stripped from each body line that has at least that many; TILDE fences keep
		// all leading whitespace. A trailing run of whitespace at the very end of the
		// body is trimmed (invisible on screen, cleaner to paste — intentional delta).
		const strip = ch === "`" ? st[1].length : 0;
		const body = lines
			.slice(i + 1, closed >= 0 ? closed : k)
			.map((l) => (strip > 0 && /^ */.exec(l)![0].length >= strip ? l.slice(strip) : l));
		segs.push({
			code: true,
			text: lines.slice(i, k).join("\n"),
			raw: body.join("\n").replace(/\s+$/, ""),
		});
		i = k;
	}
	return segs;
}

/**
 * Insert the /cp hint line above every code fence. Called once per render
 * with the full text of the message part; ids are stable across re-renders
 * (existing ordinals keep their ids; newly appearing blocks get new ids).
 * Only assistant text and thinking parts are transformed.
 */
// Pi passes the SAME messageId to a message's thinking and text parts (the
// transform runs once per part, ordinals restart per call), so state is keyed
// by message + part type — ids stay session-wide, assigned in first-appearance
// order across messages and parts.
const cpKey = (messageId: string, messageType: string): string => messageId + "\u0000" + messageType;

export function cpTransform(text: string, messageId: string, st: CpState, messageType: string): string {
	if (messageType !== "assistant" && messageType !== "assistant-thinking") return text;
	const key = cpKey(messageId, messageType);
	const segs = cpSegsOf(text);
	let ord = 0;
	const parts = segs.map((seg) => {
		if (!seg.code) return seg.text;
		const ids = st.perMessage.get(key) ?? [];
		let id = ids[ord];
		if (id === undefined) {
			id = st.nextId++;
			ids[ord] = id;
			st.lastId = id;
		}
		st.perMessage.set(key, ids);
		st.registry.set(id, seg.raw ?? "");
		const m = CP_FENCE.exec(seg.text.split("\n")[0])!;
		const hint = `${m[1]}**/cp ${id}** ${st.flipped.has(id) ? "✓ copied" : "to copy"}`;
		ord++;
		return hint + "\n" + seg.text;
	});
	return parts.join("\n");
}

export interface CpCopyResult {
	ok: boolean;
	id: number;
	chars: number;
}

/** (messageId, messageType, ordinal) → id, or null. Used by the click hook. */
export function cpIdOf(st: CpState, messageId: string, messageType: string, ordinal: number): number | null {
	const id = st.perMessage.get(cpKey(messageId, messageType))?.[ordinal];
	return id === undefined ? null : id;
}

/**
 * Copy block `id` to the clipboard via the given clipboard function
 * (fire-and-forget, errors swallowed) and mark it flipped — the hint shows
 * "✓ copied" on the next render of that message.
 */
export function cpDoCopy(st: CpState, id: number, clipboard: (text: string) => Promise<unknown>): CpCopyResult | null {
	const raw = st.registry.get(id);
	if (raw === undefined) return null;
	void clipboard(raw).catch(() => {});
	st.flipped.add(id);
	return { ok: true, id, chars: raw.length };
}

// ---------------------------------------------------------------------------
// Core-patch state detection (read-only; feeds the session-start notice).
//
// The detection mirrors patch/apply-inline-copy.mjs's --check scan exactly:
// same chunk markers, same priority order. It runs in-process (no subprocess,
// no `which`/`readlink`) so it also works on Windows installs.

/** Patch states — same names/order as the apply script's --check output. */
export type CpPatchState = "pristine" | "v1" | "v2" | "v3a" | "v3";

// Keep in sync with patch/apply-inline-copy.mjs (its V3_MARK/V2_MARK/V1_MARK/V3B_MARK).
const CP_V3_MARK = "copyRef"; // appears (twice) only in the v3/v3a blocks
const CP_V2_MARK = "cpCopied"; // appears only in the v2 block
const CP_V1_MARK = "COPY_PASTA_CLIPBIN"; // appears only in the v1 block
const CP_V3B_MARK = 'copyRef(this.messageId,"assistant",ordN)'; // once only in the v3 (new) block

/**
 * Resolve the package dir of the RUNNING pi-coding-agent. Starts from
 * `startPath` (default: process.argv[1] — the script node is executing, i.e.
 * pi itself; a parameter so tests can point at fixture trees) and applies the
 * same three strategies as the apply script's --auto, minus its subprocesses
 * (`which`/`readlink` don't exist on Windows; this runs in-process):
 *   1. realpath matches …/dist/bundle/cli.js → that package root
 *   2. it's a wrapper: a package path appears inside its contents
 *   3. walk up: <d>/node_modules/@earendil-works/pi-coding-agent, <d> itself,
 *      or a managed install (<d>/install/current-version → install/releases/<ver>/…)
 * Returns the dir if it contains dist/bundle/chunks, else undefined.
 */
export function cpFindPiPackage(startPath?: string): string | undefined {
	const looksLikePkg = (d: string) => existsSync(path.join(d, "dist", "bundle", "chunks"));
	const start = startPath ?? process.argv[1];
	if (!start || !existsSync(start)) return undefined;
	let real: string;
	try {
		real = realpathSync(start);
	} catch {
		return undefined;
	}
	// strategy 1: the resolved path is the bundled cli.js itself
	const m = real.match(/^(.*)[\\/]+dist[\\/]+bundle[\\/]+cli\.js$/);
	if (m) return looksLikePkg(m[1]) ? m[1] : undefined;
	// strategy 2: the resolved file is a wrapper — look for a package path inside it
	let found: string | undefined;
	try {
		const src = readFileSync(real, "utf8");
		if (src.length < 200000) {
			const pm = src.match(/[^\s"'`]*node_modules[^\s"'`]*pi-coding-agent[^\s"'`]*/);
			if (pm) {
				let cand = path.resolve(path.dirname(real), pm[0]);
				const dm = cand.match(/^(.*)[\\/]+dist[\\/]+bundle[\\/]+cli\.js$/);
				if (dm) cand = dm[1];
				if (looksLikePkg(cand)) found = cand;
			}
		}
	} catch { /* not readable — fall through */ }
	// strategy 3: walk up — plain package, or a managed install
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
	return found && looksLikePkg(found) ? found : undefined;
}

/**
 * Detect the inline-copy core patch state in an installed pi package
 * (read-only). Same markers and priority order as the apply script's --check
 * scan: v3/v3a (copyRef), v2 (cpCopied), v1 (COPY_PASTA_CLIPBIN — keep
 * scanning), then the pristine anchor. `pristineAnchor` is the content of
 * patch/old-anchor-v2.txt (trailing newline stripped). undefined = no known
 * state (pi version mismatch / exotic layout) — callers stay silent.
 */
export function cpDetectPatchState(pkgDir: string, pristineAnchor: string): CpPatchState | undefined {
	const chunksDir = path.join(pkgDir, "dist", "bundle", "chunks");
	if (!existsSync(chunksDir)) return undefined;
	let state: CpPatchState | undefined;
	for (const f of readdirSync(chunksDir).filter((x) => x.endsWith(".js"))) {
		const s = readFileSync(path.join(chunksDir, f), "utf8");
		if (s.includes(CP_V3_MARK)) return s.includes(CP_V3B_MARK) ? "v3" : "v3a";
		if (s.includes(CP_V2_MARK)) return "v2";
		if (s.includes(CP_V1_MARK)) { state = "v1"; continue; } // fallback — keep scanning
		if (s.includes(pristineAnchor)) return "pristine";
	}
	return state;
}

/**
 * Session-start notice text, or undefined when no notice is warranted:
 * "v3" = patch present (silent); undefined = not detectable (silent — no
 * false alarms). The message carries the exact apply command for the
 * resolved package (works on every OS — no `which`/`readlink` needed).
 */
export function cpPatchNotice(state: CpPatchState | undefined, patchScript: string, pkgDir?: string): string | undefined {
	if (state === undefined || state === "v3") return undefined;
	const cmd = pkgDir ? `node ${patchScript} --pi-dir ${pkgDir}` : `node ${patchScript} --auto`;
	if (state === "pristine")
		return `pi-copy-pasta: the click-copy patch is NOT applied — /cp still works, but click-to-copy needs the core patch: ${cmd}`;
	return `pi-copy-pasta: the core patch is at ${state} (older generation) — re-apply to upgrade it to v3: ${cmd}`;
}
