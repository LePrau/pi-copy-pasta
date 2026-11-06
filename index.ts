/**
 * pi-copy-pasta — copy-paste retrieval by ID.
 *
 * Every fenced code block in an assistant text part or thinking block gets a
 * session-wide id; the markdown transform renders a hint line above each
 * fence (the id part is bold):
 *
 *     <bold>/cp 12</bold> to copy   (flips to "✓ copied" briefly after a copy)
 *
 * Console command:
 *   /cp        → copies the most recently rendered block (possibly still streaming)
 *   /cp 12     → copies block 12
 *
 * Optional core patch (pi-agent/development/copy-pasta/patch-001-inline-copy, v3)
 * makes the WHOLE code block click-to-copy via this extension's
 * globalThis.__cpPasta hook; without the patch (or with this extension not
 * loaded) pi behaves exactly stock.
 *
 * Clipboard: pi's own copyToClipboard (Wayland wl-copy). No widget — the
 * PoC widget stays in pi-agent/development/copy-pasta/poc-001.
 */

import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cpDoCopy, cpIdOf, cpNewState, cpTransform } from "./lib.ts";

export default function piCopyPasta(api: ExtensionAPI): void {
	const st = cpNewState();

	api.registerMarkdownTransformer((text, ctx) => cpTransform(text, ctx.messageId, st, ctx.messageType));

	api.registerCommand("cp", {
		description: "Copy a /cp block to the clipboard: /cp [id] — bare /cp copies the last block",
		handler: async (args: string, ctx) => {
			const a = args.trim();
			const id = a === "" ? st.lastId : Number(a);
			if (id === null || !Number.isInteger(id) || id < 1 || !st.registry.has(id)) {
				const msg = a === "" && st.lastId === null ? "no /cp blocks yet" : `no /cp block with id ${id}`;
				if (ctx.hasUI) ctx.ui.notify(msg, "warning");
				return;
			}
			const r = cpDoCopy(st, id, copyToClipboard);
			if (ctx.hasUI) ctx.ui.notify(r ? `/cp ${id}: copied ${r.chars} chars` : `copy failed for /cp ${id}`, r ? "info" : "error");
		},
	});

	// Hook for the core patch's click path (patch-001 v3). The patch calls
	// copyRef(messageId, messageType, ordinal) on a whole-block click (the
	// part type distinguishes thinking from text blocks of the same message)
	// and clearFlip(id) after its ~1.5 s timer. If this extension is not
	// loaded, the hook is absent and the patch is a complete no-op.
	(globalThis as Record<string, unknown>).__cpPasta = {
		copyRef: (messageId: string, messageType: string, ordinal: number) => {
			const id = cpIdOf(st, messageId, messageType, ordinal);
			return id === null ? null : cpDoCopy(st, id, copyToClipboard);
		},
		copyId: (id: number) => cpDoCopy(st, id, copyToClipboard),
		clearFlip: (id: number) => {
			st.flipped.delete(id);
		},
		lastId: () => st.lastId,
	};
}
