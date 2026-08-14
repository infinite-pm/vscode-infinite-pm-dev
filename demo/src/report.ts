/**
 * Markdown contact sheets: one page per scenario, plus an index.
 *
 * The headings are the scene's own captions -- whatever was on screen when the
 * still was taken -- so a page reads as the narration of the video rather than
 * a list of file names, and no scene has to describe itself twice.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSETS_URL, OUT_DIR, STILLS_DIR } from './config.ts';

export interface Step {
	no: number;
	/** Slug, used for the file name. */
	name: string;
	/**
	 * What the reader is looking at, in a sentence -- the heading of the step.
	 * A page is read top to bottom, so each frame is the state the one before it
	 * became: the sequence carries the change, and a step only needs to say what
	 * it now shows.
	 */
	shows: string;
	/** The frame, or absent when this step changed nothing on screen. */
	file?: string;
}

export interface SceneReport {
	id: string;
	title: string;
	/** Teaching order in the published README; lowest first. */
	order?: number;
	/** A sentence under the GIF. */
	blurb?: string;
	steps: Step[];
}

/** What the host knew (see demo/bin/host-provenance.mjs) plus what the run adds. */
interface Provenance {
	renderedAt?: string;
	extension?: { name?: string; version?: string; repo?: RepoState; vsix?: { sha256?: string; bytes?: number } };
	ipmTools?: RepoState;
	examples?: RepoState;
	harness?: RepoState;
	vscode?: string;
	ipmRpc?: { version?: string; source?: string };
	scenes?: string[];
}

interface RepoState {
	short?: string;
	commit?: string;
	subject?: string;
	branch?: string;
	dirty?: boolean;
	dirtyFiles?: number;
}

const STEPS_FILE = 'steps.json';

/**
 * Merge the host's provenance with what only this run can report -- the VS Code
 * build inside the image, the ipm-rpc actually used and where it came from --
 * and write out/provenance.json.
 */
export function writeProvenance(runtime: {
	vscode?: string;
	ipmRpc?: { version?: string; source?: string };
	scenes: string[];
}): string {
	const hostFile = join(OUT_DIR, 'provenance.host.json');
	let host: Provenance = {};
	if (existsSync(hostFile)) {
		try {
			host = JSON.parse(readFileSync(hostFile, 'utf8')) as Provenance;
		} catch {
			host = {};
		}
	}
	const file = join(OUT_DIR, 'provenance.json');
	writeFileSync(file, JSON.stringify({ ...host, ...runtime }, null, 2) + '\n');
	return file;
}

/** Sentence-case a snap label, for steps taken with no caption showing. */
function prettify(name: string): string {
	const words = name.replace(/[-_]+/g, ' ').trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

export function writeSceneReport(report: SceneReport): string {
	const dir = join(STILLS_DIR, report.id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, STEPS_FILE), JSON.stringify(report, null, 2) + '\n');

	const lines: string[] = [
		`# ${report.id}`,
		'',
		report.title,
		'',
		`![${report.id}](../../video/${report.id}.gif)`,
		'',
		`[Full-resolution video](../../video/${report.id}.mp4)`,
		'',
	];

	for (const step of report.steps) {
		lines.push(`## ${step.no}. ${step.shows}`, '');
		if (step.file) {
			lines.push(`![${step.name}](${step.file})`, '');
		} else {
			lines.push('*Nothing changed on screen — the frame above still applies.*', '');
		}
	}

	const file = join(dir, `${report.id}.md`);
	writeFileSync(file, lines.join('\n'));
	return file;
}

/** Read out/provenance.json, or the host half of it if the run has not merged yet. */
function readProvenance(): Provenance | undefined {
	for (const name of ['provenance.json', 'provenance.host.json']) {
		const file = join(OUT_DIR, name);
		if (existsSync(file)) {
			try {
				return JSON.parse(readFileSync(file, 'utf8')) as Provenance;
			} catch {
				return undefined;
			}
		}
	}
	return undefined;
}

/** One repo as a table row: commit, subject, and dirty said out loud. */
function repoRow(label: string, repo: RepoState | undefined): string | undefined {
	if (!repo?.short) {
		return undefined;
	}
	const state = repo.dirty
		? `**dirty** (${repo.dirtyFiles} file${repo.dirtyFiles === 1 ? '' : 's'} uncommitted)`
		: 'clean';
	return `| ${label} | \`${repo.short}\` | ${repo.subject ?? ''} | ${state} |`;
}

/**
 * What produced these assets, in the page that ships them.
 *
 * A rendered GIF says nothing about the code it came from, and "which build was
 * this?" is the first question anyone asks of one. Dirty is spelled out rather
 * than implied: an asset rendered from a working tree with uncommitted changes
 * cannot be reproduced from its commit alone.
 */
function provenanceSection(p: Provenance | undefined): string[] {
	if (!p) {
		return [];
	}
	const lines = ['## Rendered with', ''];
	const rows = [
		repoRow('extension', p.extension?.repo),
		repoRow('ipm-tools', p.ipmTools),
		repoRow('examples (ipm-drawio)', p.examples),
		repoRow('harness (this repo)', p.harness),
	].filter(Boolean) as string[];
	if (rows.length) {
		lines.push('| repository | commit | subject | state |', '| --- | --- | --- | --- |', ...rows, '');
	}

	const facts: string[] = [];
	if (p.extension?.version) {
		facts.push(`- extension \`${p.extension.name ?? 'vscode-infinite-pm'}\` v${p.extension.version}`);
	}
	if (p.extension?.vsix?.sha256) {
		facts.push(`- vsix sha256 \`${p.extension.vsix.sha256.slice(0, 16)}…\``);
	}
	if (p.vscode) {
		facts.push(`- VS Code ${p.vscode}`);
	}
	if (p.ipmRpc?.version) {
		facts.push(`- ipm-rpc ${p.ipmRpc.version}${p.ipmRpc.source ? ` (${p.ipmRpc.source})` : ''}`);
	}
	if (p.renderedAt) {
		facts.push(`- rendered ${p.renderedAt}`);
	}
	if (facts.length) {
		lines.push(...facts, '');
	}
	lines.push('Full detail: [`provenance.json`](provenance.json).', '');
	return lines;
}

/**
 * Rebuild the index from every scene that has a report on disk -- not just the
 * ones this run recorded, so `make demo SCENES=one` does not shrink it.
 */
export function writeIndex(): string {
	const reports: SceneReport[] = [];
	for (const entry of readdirSync(STILLS_DIR, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}
		const stepsFile = join(STILLS_DIR, entry.name, STEPS_FILE);
		if (existsSync(stepsFile)) {
			reports.push(JSON.parse(readFileSync(stepsFile, 'utf8')) as SceneReport);
		}
	}
	// Teaching order, then name for anything that has not declared one.
	reports.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id));

	writeFileSync(join(OUT_DIR, 'README.md'), readme(reports, 'gif'));
	const file = join(OUT_DIR, 'README-mp4.md');
	writeFileSync(file, readme(reports, 'mp4'));
	return file;
}

/**
 * The published index, in two flavours.
 *
 * GIF is the one that always works: GitHub renders an animated GIF from a
 * relative path in a repository README, no questions asked. MP4 needs an
 * absolute URL -- a relative <video src> resolves against the blob page and
 * fetches HTML -- so that flavour is built from DEMO_ASSETS_URL and carries a
 * plain link beside each player for when the browser declines to play it.
 */
function readme(reports: SceneReport[], kind: 'gif' | 'mp4'): string {
	const other = kind === 'gif' ? 'README-mp4.md' : 'README.md';
	const lines: string[] = [
		'<!-- Generated by vscode-infinite-pm-dev (make demo && make publish). Do not edit. -->',
		'',
		'# infinite.pm for VS Code — what it does',
		'',
		'Recordings of the [infinite.pm extension](https://github.com/infinite-pm/vscode-infinite-pm)',
		'— published on the',
		'[Visual Studio Marketplace](https://marketplace.visualstudio.com/publishers/infinite-pm) —',
		'doing the things it does, in the order they make sense.',
		'',
		kind === 'gif'
			? `Prefer video? The same list with MP4 players: [${other}](${other}).`
			: `These need a browser that will play MP4 from raw URLs; the animated-GIF version always works: [${other}](${other}).`,
		'',
	];

	for (const report of reports) {
		lines.push(`## ${report.title}`, '');
		if (kind === 'gif') {
			lines.push(`![${report.id}](video/${report.id}.gif)`, '');
		} else {
			lines.push(
				`<video src="${ASSETS_URL}/video/${report.id}.mp4" controls muted loop width="900"></video>`,
				'',
				`[Download the MP4](${ASSETS_URL}/video/${report.id}.mp4)`,
				'',
			);
		}
		if (report.blurb) {
			lines.push(report.blurb, '');
		}
		lines.push(
			`[Step by step, with stills](stills/${report.id}/${report.id}.md) · ` +
			`${report.steps.length} steps · ` +
			(kind === 'gif' ? `[MP4](video/${report.id}.mp4)` : `[GIF](video/${report.id}.gif)`),
			'',
		);
	}

	lines.push(...provenanceSection(readProvenance()));
	lines.push('---', '', 'How these are made, and how to regenerate them: [docs/dev.md](docs/dev.md).', '');
	return lines.join('\n');
}
