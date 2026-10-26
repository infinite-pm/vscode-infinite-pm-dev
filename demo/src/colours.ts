/**
 * Rendered-colour test: the real VS Code, the real .vsix, the real ipm-rpc, and
 * the colours READ FROM THE DOM -- getComputedStyle().color of the token spans
 * Monaco paints, and of the spans in the Markdown preview webview. No images.
 * See docs/colours-e2e.md.
 *
 *   tsx src/colours.ts            every run
 *   tsx src/colours.ts light      only runs whose id contains "light"
 *
 * Normally invoked through demo/bin/run-colours.sh (`make colours-e2e`).
 */
import type { Frame, Page } from 'playwright';
import { closeVSCode, launchVSCode } from './code.ts';
import { prepareProfile, serverInfo, vscodeVersion } from './profile.ts';

type Kind = 'thing' | 'event' | 'concept' | 'arrow';

/** The extension's design (package.json defaults, `[*Light*]` override). */
const PALETTE: Record<'light' | 'dark', Record<Kind | 'string', string>> = {
	light: { thing: '#2d6e1f', event: '#a65300', concept: '#1a5f9e', arrow: '#404040', string: '#a31515' },
	dark: { thing: '#6fc24f', event: '#ff8000', concept: '#6c8ebf', arrow: '#d4d4d4', string: '#ce9178' },
};

interface Run {
	id: string;
	theme: string;
	mode: 'light' | 'dark';
	semantic: boolean;
	preview: boolean;
}

const RUNS: Run[] = [
	{ id: 'light-2026-semantic', theme: 'Light 2026', mode: 'light', semantic: true, preview: true },
	{ id: 'dark-modern-semantic', theme: 'Dark Modern', mode: 'dark', semantic: true, preview: true },
	// TextMate only: the grammar scopes alone must carry the same colours.
	{ id: 'light-2026-textmate', theme: 'Light 2026', mode: 'light', semantic: false, preview: false },
];

/** [segment text, occurrence on the line, expected kind or null, must be bold] */
type Seg = [string, number, Kind | null, boolean];
interface LineSpec {
	file: string;
	line: string;
	segs: Seg[];
}

const FENCE_LINES: Array<{ line: string; segs: Seg[] }> = [
	{
		line: '"the JA stream" ::t --> "ja-hub" ::t',
		segs: [
			['"the JA stream"', 0, 'thing', false],
			['::t', 0, 'thing', true],
			['-->', 0, 'thing', true], // thing -> thing is part-of: the arrow wears the thing colour
			['"ja-hub"', 0, 'thing', false],
			['::t', 1, 'thing', true],
		],
	},
	{
		line: 'plain event --> "an unmarked quoted event"',
		segs: [
			['plain event', 0, 'event', false],
			['-->', 0, 'event', true], // event -> event is leads-to: the arrow wears the event colour
			['"an unmarked quoted event"', 0, 'event', false],
		],
	},
	{
		line: '"b" ::c',
		segs: [
			['"b"', 0, 'concept', false],
			['::c', 0, 'concept', true],
		],
	},
	// An aliased title has its own (lighter) colour in the design; only the
	// "not the string colour" and marker rules apply to it here.
	{
		line: 'x::a "long title" ::t',
		segs: [
			['"long title"', 0, null, false],
			['::t', 0, 'thing', true],
		],
	},
];

const FILES = ['colours.ipmt', 'colours.md'];
const SPECS: LineSpec[] = FILES.flatMap((file) => FENCE_LINES.map((l) => ({ file, ...l })));

interface Span {
	text: string;
	color: string;
	weight: string;
	bg: string;
}

interface Row {
	where: string;
	what: string;
	expected: string;
	observed: string;
	ok: boolean;
}

const hex = (rgb: string): string => {
	const m = rgb.match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/);
	if (!m) {
		return rgb;
	}
	return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
};
const isBold = (w: string): boolean => w === 'bold' || Number(w) >= 600;
const transparent = (bg: string): boolean => bg === 'transparent' || /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg) || /\/\s*0\s*\)/.test(bg);

/** Every leaf span of every Monaco view line, in document order, per line. */
async function readLines(page: Page): Promise<Span[][]> {
	return page.evaluate(() => {
		const lines: Span[][] = [];
		for (const line of Array.from(document.querySelectorAll('.monaco-editor .view-line'))) {
			const spans: Span[] = [];
			for (const el of Array.from(line.querySelectorAll('span span')) as HTMLElement[]) {
				if (el.children.length > 0) {
					continue;
				}
				const cs = getComputedStyle(el);
				spans.push({
					text: (el.textContent ?? '').replace(/ /g, ' '),
					color: cs.color,
					weight: cs.fontWeight,
					bg: cs.backgroundColor,
				});
			}
			lines.push(spans);
		}
		return lines;
	});
}

function checkEditor(file: string, lines: Span[][], mode: 'light' | 'dark', semantic: boolean): Row[] {
	const pal = PALETTE[mode];
	const rows: Row[] = [];
	for (const spec of SPECS.filter((s) => s.file === file)) {
		const spans = lines.find((l) => l.map((s) => s.text).join('').trim() === spec.line);
		if (!spans) {
			rows.push({ where: file, what: spec.line, expected: 'line rendered', observed: 'line not found', ok: false });
			continue;
		}
		// char offset -> style, from the spans
		const text = spans.map((s) => s.text).join('');
		const chars: Span[] = spans.flatMap((s) => Array.from(s.text, () => s));
		for (const [seg, occurrence, relationKind, relationBold] of spec.segs) {
			// Semantic mode colours an arrow by its relation (part-of = thing,
			// leads-to = event); the TextMate grammar has one arrow scope.
			const plainArrow = seg === '-->' && !semantic;
			const kind: Kind | null = plainArrow ? 'arrow' : relationKind;
			const bold = relationBold;
			let at = -1;
			for (let i = 0; i <= occurrence; i++) {
				at = text.indexOf(seg, at + 1);
			}
			const measure = (from: number, len: number, what: string): void => {
				const range = from < 0 ? [] : chars.slice(from, from + len).filter((_, i) => text[from + i] !== ' ');
				const colours = [...new Set(range.map((c) => hex(c.color)))];
				const weights = [...new Set(range.map((c) => (isBold(c.weight) ? 'bold' : 'normal')))];
				const colourOk = kind ? colours.length === 1 && colours[0] === pal[kind] : !colours.includes(pal.string) && colours.length > 0;
				const boldOk = !bold || (weights.length === 1 && weights[0] === 'bold');
				rows.push({
					where: file,
					what,
					expected: `${kind ? pal[kind] : 'not ' + pal.string}${bold ? ' bold' : ''}`,
					observed: `${colours.join('+') || '(none)'} ${weights.join('+')}`,
					ok: colourOk && boldOk,
				});
			};
			const label = `${seg}${occurrence ? ` #${occurrence + 1}` : ''}`;
			if (seg.length > 2 && seg.startsWith('"') && seg.endsWith('"')) {
				// the quotes are brackets to Monaco (language-configuration), so
				// they are measured apart from the title text
				measure(at + 1, seg.length - 2, `${label} text`);
				measure(at, 1, `${label} open quote`);
				measure(at + seg.length - 1, 1, `${label} close quote`);
			} else {
				measure(at, seg.length, label);
			}
		}
		const bgs = [...new Set(spans.filter((s) => s.text.trim()).map((s) => s.bg))];
		rows.push({
			where: file,
			what: `${spec.line.slice(0, 18)}... background`,
			expected: 'transparent',
			observed: bgs.join(' | '),
			ok: bgs.every(transparent),
		});
	}
	// the owner's bug: a ::t marker must wear the thing-title colour
	const markers = rows.filter((r) => r.where === file && r.what.startsWith('::t'));
	const titles = rows.filter((r) => r.where === file && (r.what === '"the JA stream" text' || r.what === '"ja-hub" text'));
	if (markers.length && titles.length) {
		const m = markers[0].observed.split(' ')[0];
		const t = titles[0].observed.split(' ')[0];
		rows.push({ where: file, what: '::t marker == thing title colour', expected: t, observed: m, ok: m === t && m !== '(none)' });
	}
	return rows;
}

/** Poll until `check` has no failing row, or time out with the last table. */
async function settle(check: () => Promise<Row[]>, timeoutMs: number): Promise<Row[]> {
	const deadline = Date.now() + timeoutMs;
	let rows = await check();
	while (rows.some((r) => !r.ok) && Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 400));
		rows = await check();
	}
	return rows;
}

async function openFile(page: Page, name: string): Promise<void> {
	await page.keyboard.press('Control+p');
	await page.waitForSelector('.quick-input-widget', { state: 'visible', timeout: 15_000 });
	await page.keyboard.type(name);
	await page.waitForSelector(`.quick-input-list .monaco-list-row:has-text("${name}")`, { timeout: 15_000 });
	await page.keyboard.press('Enter');
	await page.waitForSelector('.quick-input-widget', { state: 'hidden', timeout: 15_000 });
	// the editor is up when a line of the fixture is painted
	await page.waitForSelector('.monaco-editor .view-line:has-text("plain event")', { timeout: 30_000 });
}

/** The webview that holds the rendered preview, if Playwright can see into it. */
async function findPreviewFrame(page: Page, timeoutMs: number): Promise<Frame | undefined> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const frame of page.frames()) {
			try {
				if ((await frame.locator('pre.ipmt-block span').count()) > 0) {
					return frame;
				}
			} catch {
				// frame detached mid-poll
			}
		}
		await new Promise((r) => setTimeout(r, 400));
	}
	return undefined;
}

async function readPreview(frame: Frame): Promise<Array<{ cls: string; text: string; color: string; weight: string; bg: string }>> {
	return frame.evaluate(() => {
		return Array.from(document.querySelectorAll('pre.ipmt-block span')).map((el) => {
			const cs = getComputedStyle(el as HTMLElement);
			return { cls: el.className, text: (el.textContent ?? '').trim(), color: cs.color, weight: cs.fontWeight, bg: cs.backgroundColor };
		});
	});
}

function checkPreview(spans: Awaited<ReturnType<typeof readPreview>>, mode: 'light' | 'dark'): Row[] {
	const pal = PALETTE[mode];
	const rows: Row[] = [];
	const byClass: Array<[string, Kind, boolean]> = [
		['ipm-t-title', 'thing', false],
		['ipm-t-marker', 'thing', true],
		['ipm-e-title', 'event', false],
		['ipm-c-title', 'concept', false],
		['ipm-c-marker', 'concept', true],
		['ipm-P', 'thing', true], // part-of arrow
		['ipm-L', 'event', true], // leads-to arrow
	];
	for (const [cls, kind, bold] of byClass) {
		const hits = spans.filter((s) => s.cls.split(/\s+/).includes(cls));
		const colours = [...new Set(hits.map((s) => hex(s.color)))];
		const boldOk = !bold || hits.every((s) => isBold(s.weight));
		rows.push({
			where: 'preview',
			what: `.${cls} x${hits.length}`,
			expected: `${pal[kind]}${bold ? ' bold' : ''}`,
			observed: colours.join('+') || '(none)',
			ok: hits.length > 0 && colours.length === 1 && colours[0] === pal[kind] && boldOk,
		});
	}
	const stringy = spans.filter((s) => hex(s.color) === pal.string && s.text);
	rows.push({ where: 'preview', what: 'no span in the string colour', expected: 'none', observed: stringy.map((s) => `${s.cls}:${s.text}`).join(', ') || 'none', ok: stringy.length === 0 });
	const bgs = spans.filter((s) => !transparent(s.bg));
	rows.push({ where: 'preview', what: 'no span with a background', expected: 'none', observed: bgs.map((s) => `${s.cls}:${s.bg}`).join(', ') || 'none', ok: bgs.length === 0 });
	return rows;
}

async function runOne(run: Run): Promise<Row[]> {
	const overrides: Record<string, unknown> = { 'workbench.colorTheme': run.theme };
	if (!run.semantic) {
		overrides['[markdown]'] = { 'editor.semanticHighlighting.enabled': false };
		overrides['[ipmt]'] = { 'editor.semanticHighlighting.enabled': false };
	}
	// Diagnostics: extra settings as JSON, e.g. to rule a VS Code feature in or out.
	Object.assign(overrides, JSON.parse(process.env.COLOURS_SETTINGS || '{}'));
	const profile = prepareProfile(`colours-${run.id}`, overrides, 'colours');
	const server = serverInfo(profile);
	console.log(`server: ${server.version ?? '?'} (${server.source}), VS Code ${vscodeVersion()}`);
	const { app, page } = await launchVSCode(profile);
	const rows: Row[] = [];
	try {
		await page.keyboard.press('Escape');
		for (const file of FILES) {
			await openFile(page, file);
			const fileRows = await settle(async () => checkEditor(file, await readLines(page), run.mode, run.semantic), 25_000);
			rows.push(...fileRows);
		}
		if (run.preview) {
			// the .md editor is the active one: open its preview beside it
			await page.keyboard.press('Control+Shift+v');
			const frame = await findPreviewFrame(page, 25_000);
			if (!frame) {
				// Never a silent skip: a preview that does not show up is a failed row.
				rows.push({ where: 'preview', what: 'highlighted pre.ipmt-block in a webview frame', expected: 'found', observed: 'not found within 25s', ok: false });
			} else {
				rows.push(...(await settle(async () => checkPreview(await readPreview(frame), run.mode), 15_000)));
			}
		}
	} finally {
		await closeVSCode(app);
	}
	return rows;
}

async function main(): Promise<void> {
	const filter = process.argv.slice(2).filter((a) => !a.startsWith('-'));
	const runs = RUNS.filter((r) => filter.length === 0 || filter.some((f) => r.id.includes(f)));
	let failed = 0;
	for (const run of runs) {
		console.log(`\n=== ${run.id} (${run.theme}, semantic=${run.semantic})`);
		let rows: Row[];
		try {
			rows = await runOne(run);
		} catch (error) {
			console.error(`!!! ${run.id}: ${error instanceof Error ? error.message : error}`);
			failed++;
			continue;
		}
		const w = (k: keyof Row, min: number): number => Math.max(min, ...rows.map((r) => String(r[k]).length));
		const [a, b, c] = [w('where', 5), w('what', 4), w('expected', 8)];
		console.log(`${'OK'.padEnd(5)}${'file'.padEnd(a + 2)}${'what'.padEnd(b + 2)}${'expected'.padEnd(c + 2)}observed`);
		for (const r of rows) {
			console.log(`${(r.ok ? 'ok' : 'FAIL').padEnd(5)}${r.where.padEnd(a + 2)}${r.what.padEnd(b + 2)}${r.expected.padEnd(c + 2)}${r.observed}`);
		}
		const bad = rows.filter((r) => !r.ok).length;
		console.log(`--- ${run.id}: ${bad ? `${bad} FAILED` : 'PASS'} (${rows.length} checks)`);
		if (bad) {
			failed++;
		}
	}
	console.log(`\n${failed ? `FAIL: ${failed}/${runs.length} run(s)` : `PASS: ${runs.length} run(s)`}`);
	process.exitCode = failed ? 1 : 0;
}

await main();
