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
