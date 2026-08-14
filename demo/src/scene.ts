/**
 * The vocabulary a scene is written in.
 *
 * A scene drives VS Code the way a viewer would understand it -- command
 * palette, quick open, typing -- rather than by poking at internals, so what
 * ends up in the video is a sequence anyone could reproduce by hand.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';
import { SPEED, STILLS_DIR } from './config.ts';
import { grabFrame } from './capture.ts';
import type { Step } from './report.ts';

export interface Scene {
	/** File-name-safe id; also the output basename. */
	id: string;
	/** One line, shown in `make list` and in the run log. */
	title: string;
	/**
	 * Where this scene sits in the published README -- lowest first. A reader
	 * meets them in teaching order, not alphabetical order, and that order is a
	 * property of the scene rather than of whoever writes the index.
	 */
	order?: number;
	/** A sentence for the README, under the GIF. Defaults to the title. */
	blurb?: string;
	/** Merged into the throwaway profile's settings.json. */
	settings?: Record<string, unknown>;
	/**
	 * Fixture workspace under demo/workspaces/. Defaults to the scene id; set it
	 * only when two scenes genuinely want the same starting files.
	 */
	workspace?: string;
	/**
	 * Keep the primary side bar (Explorer) open. Default: false -- it is a wide
	 * strip of nothing in most scenes. Turn it on when the file tree is part of
	 * what the scene shows.
	 */
	sidebar?: boolean;
	/**
	 * Side bar width as a fraction of VS Code's default, applied before
	 * recording. Default 0.6 -- the Explorer's 300px is mostly empty in a demo
	 * workspace of four files. Ignored unless `sidebar` is on.
	 */
	sidebarWidth?: number;
	/**
	 * Keep only these editor title-bar buttons, matched by the start of their
	 * tooltip (e.g. `['Open Preview to the Side', 'Open as Preview']`). Default:
	 * keep whatever VS Code shows.
	 */
	editorActions?: string[];
	/**
	 * VS Code's screencast mode: every keystroke and command name, bottom
	 * centre. Off by default -- it narrates arrow keys and quick-open typing
	 * that nobody needs to read. `save()` announces itself instead.
	 */
	screencast?: boolean;
	run(s: Stage): Promise<void>;
}

/**
 * Keystrokes worth announcing, and how to write them.
 *
 * Deliberate commands only. Navigation (Home, End, arrows, Enter, Escape) and
 * everything `type()` sends stay silent -- VS Code's screencast mode narrates
 * all of it, which buries the two or three presses a viewer actually needs to
 * notice under a stream of letters.
 */
const KEY_LABELS: Record<string, string> = {
	'Control+s': 'save   ctrl + s',
	'F1': 'command palette   F1',
	'Control+P': 'quick open   ctrl + p',
	'Control+g': 'go to line   ctrl + g',
	'Control+Shift+M': 'problems   ctrl + shift + m',
	'Control+Shift+K': 'delete line   ctrl + shift + k',
};

/** Sentence-case a slug, for a step given no description of its own. */
function prettify(name: string): string {
	const words = name.replace(/[-_]+/g, ' ').trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

export class Stage {
	private stillNo = 0;
	private readonly stillsDir: string;
	/** Caption currently on screen -- becomes the heading of the next still. */
	private lastCaption?: string;
	/** Every still taken, in order, for the scenario's Markdown page. */
	readonly steps: Step[] = [];
	/** Hash of the last frame captured, to spot a step that starts where the last ended. */
	private lastFrameHash?: string;

	constructor(
		readonly page: Page,
		readonly app: ElectronApplication,
		readonly sceneId: string,
		readonly workspaceDir: string,
	) {
		this.stillsDir = join(STILLS_DIR, sceneId);
		// Start clean: stills are numbered per run, so a shorter run would
		// otherwise leave higher-numbered frames (or a FAILURE shot) behind and
		// the directory would describe a take that no longer exists.
		rmSync(this.stillsDir, { recursive: true, force: true });
		mkdirSync(this.stillsDir, { recursive: true });
	}

	/**
	 * Record something the recording itself cannot show — a fallback taken, a
	 * condition that had to be forced. Goes to the run log so a scene that
	 * limped through does not read as one that sailed.
	 */
	note(message: string): void {
		console.log(`    note [${this.sceneId}]: ${message}`);
	}

	/** A pause, in milliseconds of *demo* time (scaled by DEMO_SPEED). */
	async beat(ms = 700): Promise<void> {
		await this.page.waitForTimeout(Math.max(0, Math.round(ms * SPEED)));
	}

	/** Type as a person would -- per-character delay, not a paste. */
	async type(text: string, opts: { delay?: number } = {}): Promise<void> {
		await this.page.keyboard.type(text, { delay: Math.round((opts.delay ?? 55) * SPEED) });
	}

	/**
	 * Type text that is not what the viewer came for -- a heading, a sentence of
	 * ordinary Markdown, anything the extension has no part in. Three times the
	 * speed of ipmt content, so the take spends its seconds on the thing being
	 * demonstrated.
	 */
	async prose(text: string): Promise<void> {
		await this.type(text, { delay: 18 });
	}

	/**
	 * Press a key combination. Announces itself in the corner if it is one of
	 * the combos in KEY_LABELS; pass `announce` to override (a label to force
	 * one, `false` to stay quiet).
	 */
	async key(
		combo: string,
		opts: { times?: number; delay?: number; announce?: string | false } = {},
	): Promise<void> {
		const label = opts.announce === undefined ? KEY_LABELS[combo] : opts.announce;
		const times = opts.times ?? 1;
		for (let i = 0; i < times; i++) {
			if (label) {
				await this.announce(label);
			}
			await this.page.keyboard.press(combo);
			await this.beat(opts.delay ?? 120);
		}
	}

	/**
	 * The small key badge, bottom-right under the caption. Hides itself on a
	 * timer inside the page, so a scene never has to remember to clear it and
	 * two presses in a row just extend the same badge.
	 */
	private async announce(label: string): Promise<void> {
		await this.page.evaluate((text) => {
			let el = document.getElementById('demo-keys') as (HTMLElement & { _hide?: number }) | null;
			if (!el) {
				el = document.createElement('div') as HTMLElement & { _hide?: number };
				el.id = 'demo-keys';
				el.style.cssText = [
					'position:fixed', 'bottom:52px', 'right:28px',
					'z-index:2147483647', 'pointer-events:none',
					'padding:6px 14px', 'border-radius:6px',
					'background:#ff8000', 'color:#1a1a1a',
					'border:1px solid rgba(0,0,0,.25)',
					'font:600 16px/1.3 system-ui,sans-serif', 'letter-spacing:.3px',
					'box-shadow:0 4px 16px rgba(153,77,0,.4)',
					'opacity:0', 'transition:opacity .15s ease',
				].join(';');
				document.body.appendChild(el);
			}
			el.textContent = text;
			el.style.opacity = '1';
			clearTimeout(el._hide);
			el._hide = setTimeout(() => { el!.style.opacity = '0'; }, 1800) as unknown as number;
		}, label);
		await this.beat(220);
	}

	/**
	 * Run a command through the palette, visibly.
	 *
	 * The command name arrives whole rather than character by character. It is
	 * scaffolding, not content: what a viewer needs is to see *which* command
	 * ran, and that is the job of the pause after the text lands. Typing it out
	 * only draws the eye to the part nobody came to watch.
	 */
	async palette(title: string, opts: { pick?: number } = {}): Promise<void> {
		await this.key('F1', { delay: 250 });
		await this.page.waitForSelector('.quick-input-widget', { state: 'visible' });
		await this.page.keyboard.insertText(title);
		await this.expectPick(`command "${title}"`);
		await this.beat(700);
		if (opts.pick) {
			await this.key('ArrowDown', { times: opts.pick, delay: 200 });
		}
		await this.page.keyboard.press('Enter');
		await this.beat(400);
	}

	/**
	 * Open a workspace file through quick open, visibly.
	 *
	 * `expect` is what proves the editor arrived. The default suits a text file;
	 * anything VS Code opens in a custom editor (an .svg lands in the image
	 * preview, not a text buffer) has no `.view-lines` and needs its own.
	 */
	async quickOpen(fileName: string, opts: { expect?: string } = {}): Promise<void> {
		await this.key('Control+P', { delay: 250 });
		await this.page.waitForSelector('.quick-input-widget', { state: 'visible' });
		// Whole, not typed -- same reasoning as palette().
		await this.page.keyboard.insertText(fileName);
		await this.expectPick(`file "${fileName}"`);
		await this.beat(700);
		await this.page.keyboard.press('Enter');
		await this.page.waitForSelector(opts.expect ?? '.monaco-editor .view-lines', { state: 'visible' });
		await this.beat(600);
	}

	/**
	 * Wait for the quick input to actually offer something. Without this a typo
	 * in a command title just sits on "No matching commands" until the default
	 * timeout, which reads like a hang rather than the mistake it is.
	 */
	private async expectPick(what: string): Promise<void> {
		try {
			await this.page.waitForSelector('.quick-input-list .monaco-list-row', { state: 'visible', timeout: 10_000 });
		} catch {
			throw new Error(`quick input offered no match for ${what}`);
		}
	}

	/**
	 * Click into a text editor to give it the caret.
	 *
	 * Prefers the *active* editor group, falling back to the leftmost. In a split
	 * layout the naive "first .view-lines" is a trap: with a preview open to the
	 * side and a file just opened into the right-hand group, it types into the
	 * wrong document -- which is exactly how a scene once wrote its edits into
	 * the Markdown page instead of the .ipmt file it had just opened. The
	 * fallback covers the case where the active group holds a webview (a preview
	 * pane has no `.view-lines` at all).
	 */
	async focusEditor(): Promise<void> {
		const active = this.page.locator('.editor-group-container.active .monaco-editor .view-lines').first();
		const target = (await active.count()) > 0
			? active
			: this.page.locator('.editor-instance .monaco-editor .view-lines').first();
		await target.click();
		await this.beat(200);
	}

	/**
	 * Make the leftmost editor group active by clicking into it.
	 *
	 * A click, not `View: Focus First Editor Group` through the palette: that is
	 * layout plumbing, and running it on camera puts a command in the video that
	 * has nothing to do with the extension. Clicking the editor is what a person
	 * would do anyway.
	 */
	async focusFirstGroup(): Promise<void> {
		await this.page.locator('.editor-instance .monaco-editor .view-lines').first().click();
		await this.beat(250);
	}

	/** Put the caret at the end of the focused editor. */
	async gotoEnd(): Promise<void> {
		await this.key('Control+End', { delay: 200 });
	}

	/** Go to a line and put the caret at its end -- visibly, via Ctrl+G. */
	async gotoLine(line: number): Promise<void> {
		await this.key('Control+g', { delay: 300 });
		await this.page.waitForSelector('.quick-input-widget', { state: 'visible' });
		await this.type(String(line), { delay: 90 });
		await this.beat(500);
		await this.page.keyboard.press('Enter');
		await this.key('End', { delay: 200 });
	}

	/** Is this selector on screen? For optional parts of a scene. */
	async has(selector: string, timeout = 3_000): Promise<boolean> {
		try {
			await this.page.waitForSelector(selector, { state: 'visible', timeout });
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Wait until a file in the scene's workspace contains `needle`.
	 *
	 * Proof that a write actually happened, rather than a guess dressed up as a
	 * pause: a scene that shows a generated file catching up must not depend on
	 * how long the language server took to write it.
	 */
	async waitForWorkspaceFile(relPath: string, needle: string, timeout = 20_000): Promise<void> {
		const file = join(this.workspaceDir, relPath);
		const deadline = Date.now() + timeout;
		while (Date.now() < deadline) {
			try {
				if (readFileSync(file, 'utf8').includes(needle)) {
					return;
				}
			} catch {
				// not written yet
			}
			await this.page.waitForTimeout(200);
		}
		throw new Error(`${relPath} did not come to contain "${needle}" within ${timeout}ms`);
	}

	/**
	 * Wait until VS Code's built-in image preview is showing a picture it
	 * loaded *after* `since`, for the file whose name contains `fileName`.
	 *
	 * A file on disk being correct does not mean the pane showing it is: the
	 * preview reloads through its own file watcher, on its own schedule. And a
	 * `beat()` long enough to usually cover that is exactly the kind of wait
	 * that fails on a loaded machine and leaves a stale pane in the still —
	 * with the video looking plausible either way, since the harness cannot
	 * tell a stale pane from a deliberate one.
	 *
	 * What makes this checkable is that the image preview cache-busts its
	 * `<img>` with `?version=<Date.now()>` every time it re-renders, so the URL
	 * in the DOM says when the picture on screen was loaded. We read that from
	 * the webview host frames through the Electron main process: webview hosts
	 * are out-of-process iframes, which `webContents.mainFrame.framesInSubtree`
	 * reaches and Playwright's frame attachment may not.
	 *
	 * Having confirmed it, spend two animation frames in the host so the
	 * renderer has produced a frame before the caller captures pixels: the DOM
	 * being right is necessary, not sufficient, when the capture comes off a
	 * headless X server rather than out of the app.
	 */
	async waitForImagePreview(fileName: string, since: number, timeout = 20_000): Promise<void> {
		const deadline = Date.now() + timeout;
		let seen: number[] = [];
		while (Date.now() < deadline) {
			seen = await this.imagePreviewVersions(fileName);
			if (seen.some((v) => v > since)) {
				await this.flushFrames();
				await this.repaint();
				return;
			}
			await this.page.waitForTimeout(150);
		}
		// This failure has two very different causes and they need telling
		// apart: either the preview never reloaded (a product problem), or it
		// reloaded and the framebuffer we capture from did not follow (a
		// headless-compositing problem — see docs/headless-recording.md). The
		// version numbers on screen say which, so report them either way.
		const stale = seen.length > 0 && seen.every((v) => v <= since);
		throw new Error(
			`the image preview of "${fileName}" did not reload within ${timeout}ms ` +
			`(versions on screen: ${seen.length ? seen.join(', ') : 'none'}; wanted one after ${since}). ` +
			(stale
				? 'The pane is showing an OLDER render, so the reload itself never happened.'
				: 'No image preview for that file was on screen at all — check the pane is open.'),
		);
	}

	/**
	 * Ask the compositor for a fresh frame.
	 *
	 * Under Xvfb with software rendering and no window manager, a webview whose
	 * DOM has changed does not reliably reach the X framebuffer that ffmpeg
	 * grabs — most visibly when the image preview swaps in a whole new iframe.
	 * `invalidate()` is Electron's way of saying "repaint everything", which is
	 * the nudge a compositor with no damage events never gets.
	 */
	async repaint(): Promise<void> {
		await this.app.evaluate(async ({ BrowserWindow }) => {
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.invalidate();
			}
		});
		// One frame for the invalidate to land, one for it to be composited.
		await this.page.evaluate(
			() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
		);
	}

	/**
	 * Read something out of every webview host frame on screen.
	 *
	 * The recordings photograph webviews — the Markdown preview, the .ipmt
	 * preview — and until now asserted only that an `iframe.webview` existed,
	 * which is true of a webview showing nothing at all. `script` runs inside
	 * each host frame; its children (`#active-frame`) are same-origin with it,
	 * so their DOM is readable from there.
	 *
	 * Through the Electron main process rather than Playwright: webview hosts
	 * are out-of-process iframes, which `framesInSubtree` reaches reliably and
	 * Playwright's frame attachment may not.
	 */
	async readWebviews<T>(script: string): Promise<T[]> {
		return this.app.evaluate(async ({ BrowserWindow }, src) => {
			const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('workbench'));
			if (!win) {
				return [];
			}
			const out: unknown[] = [];
			for (const frame of win.webContents.mainFrame.framesInSubtree) {
				if (!frame.url.includes('index.html')) {
					continue;
				}
				try {
					out.push(await frame.executeJavaScript(src, true));
				} catch { /* a frame mid-swap */ }
			}
			return out;
		}, script) as Promise<T[]>;
	}

	/**
	 * Every ipmt fence rendered in a Markdown preview, with the token classes
	 * actually painted on it. An empty `spanClasses` is the "black fence" bug —
	 * the one that shipped twice, visible in every frame of a recording that
	 * reported green.
	 */
	async ipmtFences(): Promise<Array<{ text: string; spanClasses: string[] }>> {
		const script = `(() => {
			const out = [];
			for (const fr of document.querySelectorAll('iframe')) {
				try {
					const d = fr.contentDocument;
					if (!d) continue;
					for (const code of d.querySelectorAll('code.language-ipmt')) {
						out.push({
							text: code.textContent || '',
							spanClasses: [...new Set([...code.querySelectorAll('span[class^="ipm-"]')]
								.map(s => s.getAttribute('class')))],
						});
					}
				} catch (e) { /* cross-origin or mid-swap */ }
			}
			return out;
		})()`;
		const perHost = await this.readWebviews<Array<{ text: string; spanClasses: string[] }>>(script);
		return perHost.flat();
	}

	/** Wait until a Markdown preview shows a coloured ipmt fence. */
	async waitForColouredFence(minClasses = 3, timeout = 20_000): Promise<void> {
		const deadline = Date.now() + timeout;
		let seen: Array<{ spanClasses: string[] }> = [];
		while (Date.now() < deadline) {
			seen = await this.ipmtFences();
			if (seen.some((f) => f.spanClasses.length >= minClasses)) {
				return;
			}
			await this.page.waitForTimeout(150);
		}
		throw new Error(
			`no ipmt fence in the preview carries ${minClasses} token classes after ${timeout}ms ` +
			`(found ${seen.length} fence(s): ${JSON.stringify(seen.map((f) => f.spanClasses))}). ` +
			'An uncoloured fence is what this scene is filming.',
		);
	}

	/** The `<img>` sources inside every webview: `data:` means a live render. */
	async previewImages(): Promise<Array<{ src: string; live: boolean }>> {
		const script = `(() => {
			const out = [];
			for (const fr of document.querySelectorAll('iframe')) {
				try {
					const d = fr.contentDocument;
					if (!d) continue;
					for (const img of d.querySelectorAll('img')) {
						const src = img.getAttribute('src') || '';
						out.push({ src: src.slice(0, 60), live: src.indexOf('data:') === 0 });
					}
				} catch (e) { /* cross-origin or mid-swap */ }
			}
			return out;
		})()`;
		const perHost = await this.readWebviews<Array<{ src: string; live: boolean }>>(script);
		return perHost.flat();
	}

	/** Wait until the preview swaps a committed SVG for an in-memory render. */
	async waitForLiveDiagram(timeout = 20_000): Promise<void> {
		const deadline = Date.now() + timeout;
		let seen: Array<{ src: string; live: boolean }> = [];
		while (Date.now() < deadline) {
			seen = await this.previewImages();
			if (seen.some((i) => i.live)) {
				return;
			}
			await this.page.waitForTimeout(150);
		}
		throw new Error(
			`no preview image is an in-memory render after ${timeout}ms (saw ${JSON.stringify(seen)}). ` +
			'Live refresh is the subject of this scene; filming the committed SVG instead ' +
			'would look identical and mean the opposite.',
		);
	}

	/** Error banners currently shown in any .ipmt preview pane. */
	async previewErrors(): Promise<string[]> {
		const script = `(() => {
			const out = [];
			for (const fr of document.querySelectorAll('iframe')) {
				try {
					const d = fr.contentDocument;
					if (!d) continue;
					for (const e of d.querySelectorAll('#error-banner .error, .error')) {
						const t = (e.textContent || '').trim();
						if (t) out.push(t);
					}
				} catch (e) { /* cross-origin or mid-swap */ }
			}
			return out;
		})()`;
		const perHost = await this.readWebviews<string[]>(script);
		return perHost.flat();
	}

	/** Wait for a preview error banner whose text matches `pattern`. */
	async waitForPreviewError(pattern: RegExp, timeout = 20_000): Promise<string> {
		const deadline = Date.now() + timeout;
		let seen: string[] = [];
		while (Date.now() < deadline) {
			seen = await this.previewErrors();
			const hit = seen.find((t) => pattern.test(t));
			if (hit) {
				return hit;
			}
			await this.page.waitForTimeout(150);
		}
		throw new Error(
			`no preview error matching ${pattern} after ${timeout}ms (banners: ${JSON.stringify(seen)})`,
		);
	}

	/** Wait for every preview error banner to clear. */
	async waitForNoPreviewError(timeout = 20_000): Promise<void> {
		const deadline = Date.now() + timeout;
		let seen: string[] = [];
		while (Date.now() < deadline) {
			seen = await this.previewErrors();
			if (seen.length === 0) {
				return;
			}
			await this.page.waitForTimeout(150);
		}
		throw new Error(`preview still shows ${JSON.stringify(seen)} after ${timeout}ms`);
	}

	/** Rendered diagram sizes in any preview pane, from each SVG's viewBox. */
	async previewDiagrams(): Promise<Array<{ width: number; height: number; nodes: number }>> {
		const script = `(() => {
			const out = [];
			for (const fr of document.querySelectorAll('iframe')) {
				try {
					const d = fr.contentDocument;
					if (!d) continue;
					for (const svg of d.querySelectorAll('svg')) {
						const vb = svg.viewBox && svg.viewBox.baseVal;
						out.push({
							width: vb ? vb.width : 0,
							height: vb ? vb.height : 0,
							nodes: svg.querySelectorAll('text').length,
						});
					}
				} catch (e) { /* cross-origin or mid-swap */ }
			}
			return out;
		})()`;
		const perHost = await this.readWebviews<Array<{ width: number; height: number; nodes: number }>>(script);
		return perHost.flat();
	}

	/** Wait until a preview pane is showing a diagram with actual geometry. */
	async waitForDiagram(minLabels = 1, timeout = 20_000): Promise<void> {
		const deadline = Date.now() + timeout;
		let seen: Array<{ width: number; height: number; nodes: number }> = [];
		while (Date.now() < deadline) {
			seen = await this.previewDiagrams();
			if (seen.some((d) => d.width > 0 && d.height > 0 && d.nodes >= minLabels)) {
				return;
			}
			await this.page.waitForTimeout(150);
		}
		throw new Error(
			`no preview shows a diagram with >=${minLabels} labels after ${timeout}ms ` +
			`(saw ${JSON.stringify(seen)}). An empty pane photographs the same as a full one.`,
		);
	}

	/** `?version=` timestamps of every image preview currently showing `fileName`. */
	private async imagePreviewVersions(fileName: string): Promise<number[]> {
		return this.app.evaluate(async ({ BrowserWindow }, name) => {
			const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('workbench'));
			if (!win) {
				return [];
			}
			const script = `(() => {
				const out = [];
				for (const fr of document.querySelectorAll('iframe')) {
					try {
						const img = fr.contentDocument && fr.contentDocument.querySelector('img');
						if (!img) continue;
						const src = img.getAttribute('src') || '';
						if (src.indexOf(${JSON.stringify(name)}) === -1) continue;
						const m = /version(?:%3D|=)(\\d+)/.exec(src);
						if (m) out.push(Number(m[1]));
					} catch (e) { /* a frame mid-swap */ }
				}
				return out;
			})()`;
			const found: number[] = [];
			for (const frame of win.webContents.mainFrame.framesInSubtree) {
				if (!frame.url.includes('index.html')) {
					continue;
				}
				try {
					found.push(...(await frame.executeJavaScript(script, true) as number[]));
				} catch { /* frame went away underneath us */ }
			}
			return found;
		}, fileName);
	}

	/** Let every webview host produce a frame before pixels are captured. */
	private async flushFrames(): Promise<void> {
		await this.app.evaluate(async ({ BrowserWindow }) => {
			const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('workbench'));
			if (!win) {
				return;
			}
			const twoFrames = `new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))`;
			await Promise.all(win.webContents.mainFrame.framesInSubtree
				.filter((f) => f.url.includes('index.html'))
				.map((f) => f.executeJavaScript(twoFrames, true).catch(() => undefined)));
		});
	}

	/** Wait until the active editor's visible text contains `needle`. */
	async waitForEditorText(needle: string, timeout = 30_000): Promise<void> {
		await this.page.waitForFunction(
			(text) => document.querySelector('.editor-instance .view-lines')?.textContent?.includes(text) ?? false,
			needle,
			{ timeout },
		);
	}

	/**
	 * Wait until the active editor's visible text no longer contains `needle`.
	 *
	 * The mirror of `waitForEditorText`, for a deletion: a step that removes a
	 * line has to prove the line went, or a missed keystroke photographs the
	 * same as a successful delete.
	 */
	async waitForNoEditorText(needle: string, timeout = 30_000): Promise<void> {
		await this.page.waitForFunction(
			(text) => !(document.querySelector('.editor-instance .view-lines')?.textContent?.includes(text) ?? false),
			needle,
			{ timeout },
		);
	}

	async save(): Promise<void> {
		await this.key('Control+s', { delay: 400 });
	}

	async click(selector: string): Promise<void> {
		await this.page.locator(selector).first().click();
		await this.beat(250);
	}

	async waitFor(selector: string, timeout = 30_000): Promise<void> {
		await this.page.waitForSelector(selector, { state: 'visible', timeout });
	}

	/**
	 * Bracket an action the extension reacts to, capturing it either side.
	 *
	 * The unit is one *action*, not one keystroke: a whole ipmt block typed in
	 * is a single step, because forty stills of a line growing character by
	 * character document nothing that the two ends do not. Saves, preview
	 * openings and each edit that re-renders get their own pair.
	 */
	async act(
		name: string,
		action: () => Promise<void>,
		opts: { settle?: number; shows?: string } = {},
	): Promise<void> {
		await action();
		if (opts.settle) {
			await this.beat(opts.settle);
		}
		await this.record(name, opts.shows);
	}

	/** Content hash of a captured frame, for spotting an unchanged screen. */
	private hash(base: string): string {
		return createHash('sha256').update(readFileSync(join(this.stillsDir, base))).digest('hex');
	}

	/** A screenshot of the workbench, numbered in scene order. */
	async snap(name: string, shows?: string): Promise<void> {
		await this.record(name, shows);
	}

	/**
	 * One frame, one step, one heading.
	 *
	 * A page is read in order, so consecutive frames already carry the change --
	 * a "before" is only ever the picture directly above it printed twice. When a
	 * step genuinely alters nothing on screen (a save with nothing to render),
	 * the step still belongs on the page, but its frame does not: the reader is
	 * told the previous one still stands.
	 */
	private async record(name: string, shows?: string): Promise<void> {
		const no = ++this.stillNo;
		const base = `${String(no).padStart(2, '0')}-${name}.png`;
		await this.shoot(base);
		const hash = this.hash(base);
		const unchanged = hash === this.lastFrameHash;
		if (unchanged) {
			rmSync(join(this.stillsDir, base), { force: true });
		}
		this.lastFrameHash = hash;
		this.steps.push({
			no,
			name,
			shows: shows ?? this.lastCaption ?? prettify(name),
			file: unchanged ? undefined : base,
		});
	}

	/** Grab one frame into the scene's stills directory; returns the base name. */
	private async shoot(base: string): Promise<string> {
		// A DOM that has changed is not a framebuffer that has: nudge the
		// compositor before grabbing, or the still can lag the app it shows.
		await this.repaint();
		await grabFrame(join(this.stillsDir, base));
		return base;
	}

	/**
	 * A title card at the top of the window. Injected into the workbench DOM,
	 * so it is part of the captured frame without any post-processing.
	 */
	async caption(text: string, ms = 2200): Promise<void> {
		await this.captionShow(text);
		await this.beat(ms);
		await this.captionHide();
	}

	async captionShow(text: string): Promise<void> {
		this.lastCaption = text;
		await this.page.evaluate((message) => {
			let el = document.getElementById('demo-caption');
			if (!el) {
				el = document.createElement('div');
				el.id = 'demo-caption';
				// Bottom right, clear of the screencast keyboard overlay (which
				// sits bottom-centre) and of the status bar. #ff8000 is the
				// palette's event orange (ipm-tools pkg/ipmtokens/palette.json),
				// with near-black text: white on this orange is about 2.6:1 and
				// unreadable at GIF scale, dark text is about 9:1.
				el.style.cssText = [
					'position:fixed', 'bottom:100px', 'right:28px',
					'z-index:2147483647', 'pointer-events:none',
					'padding:10px 20px', 'border-radius:8px',
					'background:#ff8000', 'color:#1a1a1a',
					'border:1px solid rgba(0,0,0,.25)',
					'font:600 22px/1.35 system-ui,sans-serif', 'letter-spacing:.2px',
					'box-shadow:0 8px 28px rgba(153,77,0,.45)',
					'opacity:0', 'transition:opacity .18s ease',
					'max-width:46vw', 'text-align:left',
				].join(';');
				document.body.appendChild(el);
			}
			el.textContent = message;
			void el.offsetWidth; // flush, so the transition actually runs
			el.style.opacity = '1';
		}, text);
		await this.beat(220);
	}

	async captionHide(): Promise<void> {
		await this.page.evaluate(() => {
			const el = document.getElementById('demo-caption');
			if (el) {
				el.style.opacity = '0';
			}
		});
		await this.beat(220);
	}

	/**
	 * Synthetic mouse pointer. Playwright's clicks are CDP events, which never
	 * move the X cursor, so without this a click looks like it came from
	 * nowhere. The overlay follows the dispatched DOM events instead.
	 */
	async pointer(): Promise<void> {
		await this.page.evaluate(() => {
			if (document.getElementById('demo-pointer')) {
				return;
			}
			const dot = document.createElement('div');
			dot.id = 'demo-pointer';
			dot.style.cssText = [
				'position:fixed', 'top:0', 'left:0', 'width:18px', 'height:18px',
				'z-index:2147483646', 'pointer-events:none',
				'border-radius:50%', 'background:rgba(243,133,24,.55)',
				'border:2px solid #fff', 'box-shadow:0 2px 8px rgba(0,0,0,.5)',
				'transform:translate(-50%,-50%)', 'opacity:0',
				'transition:opacity .2s ease',
			].join(';');
			document.body.appendChild(dot);
			let idle: ReturnType<typeof setTimeout> | undefined;
			addEventListener('mousemove', (e) => {
				dot.style.opacity = '1';
				dot.style.left = `${e.clientX}px`;
				dot.style.top = `${e.clientY}px`;
				// Fade when the pointer stops: otherwise it sits in the middle of
				// the editor for the rest of the take, long after the click.
				clearTimeout(idle);
				idle = setTimeout(() => (dot.style.opacity = '0'), 1200);
			}, true);
		});
	}

	/**
	 * Narrow the side bar to `factor` of its current width by dragging its sash.
	 *
	 * The width is workspace state, not a setting, so there is nothing to write
	 * into settings.json -- and dragging the sash is exact, where the
	 * decrease-view-width command is a fixed step you would have to repeat and
	 * guess at. Called during the pre-roll, so the drag never reaches the video.
	 */
	async narrowSideBar(factor: number): Promise<void> {
		const bar = await this.page.locator('.part.sidebar').boundingBox();
		if (!bar || bar.width === 0) {
			return;
		}
		const edge = bar.x + bar.width;
		for (const sash of await this.page.locator('.monaco-sash.vertical').all()) {
			const box = await sash.boundingBox();
			if (!box || Math.abs(box.x + box.width / 2 - edge) > 8) {
				continue;
			}
			const y = box.y + box.height / 2;
			await this.page.mouse.move(box.x + box.width / 2, y);
			await this.page.mouse.down();
			await this.page.mouse.move(bar.x + bar.width * factor, y, { steps: 12 });
			await this.page.mouse.up();
			await this.beat(300);
			return;
		}
		console.warn('narrowSideBar: no sash found at the side bar edge; leaving it as is');
	}

	/**
	 * An editor title-bar button, addressed by the start of its tooltip.
	 *
	 * Matched on the label wherever it sits: VS Code puts `aria-label` on the
	 * inner anchor, not on the `.action-item` wrapper.
	 */
	private editorActionLocator(labelPrefix: string) {
		return this.page.locator(`.editor-actions [aria-label^="${labelPrefix}"]`).first();
	}

	/** Click an editor title-bar button by the start of its tooltip. */
	async editorAction(labelPrefix: string): Promise<void> {
		await this.editorActionLocator(labelPrefix).click();
		await this.beat(400);
	}

	/**
	 * Leave only the named buttons in the editor title bar.
	 *
	 * Staging, like hiding the activity bar: a `.ipmt` file's title bar carries
	 * this extension's two preview buttons plus VS Code's own Split Editor Right
	 * and More Actions, and in a shot about *these* buttons the other two are
	 * noise.
	 *
	 * A stylesheet rather than a script: the toolbar is rebuilt whenever the
	 * active editor changes, and CSS reapplies itself where a one-shot pass
	 * would need a MutationObserver to keep up. The rule only ever *hides*, so
	 * nothing has to restore the original `display`, and it matches the label on
	 * the item or on any descendant, since VS Code puts it on the inner anchor.
	 */
	async keepEditorActions(labelPrefixes: string[]): Promise<void> {
		const keep = labelPrefixes
			.flatMap((label) => [`:not([aria-label^="${label}"])`, `:not(:has([aria-label^="${label}"]))`])
			.join('');
		await this.page.evaluate((css) => {
			const style = document.createElement('style');
			style.id = 'demo-editor-actions';
			style.textContent = css;
			document.head.appendChild(style);
		}, `.editor-actions .action-item${keep} { display: none !important; }`);
	}

	/** Click a row in the Explorer tree by its label -- expands a folder, opens a file. */
	async explorerRow(name: string): Promise<void> {
		await this.page
			.locator('.explorer-folders-view .monaco-list-row')
			.filter({ hasText: name })
			.first()
			.click();
		await this.beat(600);
	}

	/**
	 * Expand an Explorer folder, and make sure it actually expanded.
	 *
	 * A click that lands while the tree is still re-rendering the previous
	 * expansion selects the row without toggling it, which is silent: the scene
	 * carries on and only fails later, looking for a child that never appeared.
	 * Row count is the check -- expanding always adds rows.
	 */
	async explorerExpand(name: string, tries = 3): Promise<void> {
		const rows = this.page.locator('.explorer-folders-view .monaco-list-row');
		for (let i = 0; i < tries; i++) {
			const before = await rows.count();
			await this.explorerRow(name);
			await this.beat(500);
			if (await rows.count() > before) {
				return;
			}
		}
		throw new Error(`Explorer folder "${name}" did not expand after ${tries} attempts`);
	}

	/**
	 * Ring an element in orange for a moment.
	 *
	 * The box is measured in Node and drawn as a fixed-position overlay, so it
	 * works on anything on screen -- a tree row, an editor line -- without
	 * touching the element itself or the theme's own selection colours.
	 */
	async highlight(selector: string, ms = 2000): Promise<void> {
		await this.highlightShow(selector);
		await this.beat(ms);
		await this.highlightHide();
	}

	/** Ring an element and leave it up -- so a snap() can capture it. */
	async highlightShow(selector: string): Promise<void> {
		const box = await this.page.locator(selector).first().boundingBox();
		if (!box) {
			throw new Error(`cannot highlight "${selector}": not on screen`);
		}
		await this.page.evaluate((b) => {
			const ring = document.createElement('div');
			ring.id = 'demo-highlight';
			// Clamped to the viewport: a toolbar sitting against the window edge
			// would otherwise have its ring drawn half off screen.
			const left = Math.max(2, b.x - 4);
			const width = Math.min(b.width + 8, window.innerWidth - left - 2);
			ring.style.cssText = [
				'position:fixed', `left:${left}px`, `top:${b.y - 3}px`,
				`width:${width}px`, `height:${b.height + 6}px`,
				'z-index:2147483646', 'pointer-events:none',
				'border:2px solid #ff8000', 'border-radius:5px',
				'box-shadow:0 0 0 4px rgba(255,128,0,.25)',
			].join(';');
			document.body.appendChild(ring);
		}, box);
		await this.beat(250);
	}

	async highlightHide(): Promise<void> {
		await this.page.evaluate(() => document.getElementById('demo-highlight')?.remove());
	}

	/** Move the pointer somewhere visible without clicking. */
	async moveTo(selector: string): Promise<void> {
		await this.page.locator(selector).first().hover();
		await this.beat(250);
	}

	/**
	 * Scroll the wheel over an element, one notch at a time.
	 *
	 * This is how the .ipmt preview is zoomed: its own `wheel` handler scales the
	 * SVG around the cursor. Pressing Ctrl+= instead would need keyboard focus
	 * inside the webview, and when it is not there VS Code's own "Zoom In"
	 * shortcut wins -- which scales the whole window and shows the wrong feature.
	 */
	async wheelOver(
		selector: string,
		deltaY: number,
		opts: { steps?: number; delay?: number; at?: { x: number; y: number } } = {},
	): Promise<void> {
		const box = await this.page.locator(selector).first().boundingBox();
		if (!box) {
			throw new Error(`cannot scroll over "${selector}": not on screen`);
		}
		// `at` is a 0..1 position within the element. It matters for a zoom that
		// centres on the cursor: park it where the content is, not where the
		// element's midpoint happens to fall.
		const at = opts.at ?? { x: 0.5, y: 0.5 };
		await this.page.mouse.move(box.x + box.width * at.x, box.y + box.height * at.y);
		await this.beat(300);
		for (let i = 0; i < (opts.steps ?? 5); i++) {
			await this.page.mouse.wheel(0, deltaY);
			await this.beat(opts.delay ?? 160);
		}
	}
}
