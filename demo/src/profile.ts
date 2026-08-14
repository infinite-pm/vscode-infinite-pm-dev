/**
 * A throwaway VS Code profile per scene: fresh user-data-dir, fresh
 * extensions-dir with the .vsix under test installed, and a fresh copy of the
 * demo workspace (scenes type into files and may trigger embed-on-save, which
 * writes SVGs -- that must never touch demo/workspace/).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { CODE_CLI, FIXTURES_DIR, IPM_RPC, PROFILES_DIR, VSCODE_DIR, VSIX, WORKSPACES_DIR, ZOOM } from './config.ts';

export interface Profile {
	userDataDir: string;
	extensionsDir: string;
	workspaceDir: string;
}

/** The VS Code build inside the image, for the provenance record. */
export function vscodeVersion(): string | undefined {
	try {
		const pkg = JSON.parse(readFileSync(join(VSCODE_DIR, 'resources', 'app', 'package.json'), 'utf8'));
		return pkg.version as string;
	} catch {
		return undefined;
	}
}

/**
 * The ipm-rpc actually used, and where it came from -- asked of the binary
 * rather than inferred, because "which server rendered this?" is exactly the
 * question a published asset has to be able to answer.
 */
export function serverInfo(profile: Profile): { version?: string; source?: string } {
	const explicit = chooseServer();
	const candidate = explicit ?? bundledServerPath(profile.extensionsDir);
	if (!candidate) {
		return { source: 'PATH (none found)' };
	}
	const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
	return {
		version: result.status === 0 ? result.stdout.trim() : undefined,
		// No absolute path: this ends up in a published record.
		source: explicit ? 'local build (out/ipm-rpc)' : 'bundled in the vsix',
	};
}

/** The server the installed extension carries for this platform, if any. */
function bundledServerPath(extensionsDir: string): string | undefined {
	const goos = process.platform === 'darwin' ? 'darwin' : 'linux';
	const goarch = process.arch === 'arm64' ? 'arm64' : 'amd64';
	for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}
		const candidate = join(extensionsDir, entry.name, 'bin', `${goos}-${goarch}`, 'ipm-rpc');
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

/**
 * Settings shared by every scene. Two groups: things that make the recording
 * look like a clean demo machine, and things that make frames deterministic
 * (a blinking caret alone makes every GIF diff useless).
 */
const BASE_SETTINGS: Record<string, unknown> = {
	// --- clean demo machine ---
	'workbench.colorTheme': 'Default Light Modern',
	'workbench.startupEditor': 'none',
	'workbench.tips.enabled': false,
	'workbench.editor.enablePreview': false,
	'workbench.editor.showTabs': 'multiple',
	'window.commandCenter': false,
	'window.menuBarVisibility': 'hidden',
	// A demo of this extension is not a demo of chat: without these, the
	// secondary side bar opens on the chat welcome view and eats a quarter of
	// the frame, with a "Sign In" pill in the title bar.
	'chat.disableAIFeatures': true,
	'workbench.secondarySideBar.defaultVisibility': 'hidden',
	'window.titleBarStyle': 'custom',
	'breadcrumbs.enabled': false,
	'explorer.compactFolders': false,
	'update.mode': 'none',
	'extensions.autoCheckUpdates': false,
	'extensions.autoUpdate': false,
	'telemetry.telemetryLevel': 'off',
	'security.workspace.trust.enabled': false,
	'git.enabled': false,
	'npm.autoDetect': 'off',
	'problems.decorations.enabled': true,

	// --- readable at GIF scale ---
	// Zoom scales the whole workbench (see config.ZOOM); the activity bar is
	// 48px of icons no scene ever uses.
	'window.zoomLevel': ZOOM,
	'workbench.activityBar.location': 'hidden',
	'editor.fontSize': 16,
	'editor.fontFamily': "'DejaVu Sans Mono', 'Liberation Mono', monospace",
	'editor.lineHeight': 1.5,
	'editor.minimap.enabled': false,
	'editor.stickyScroll.enabled': false,
	'editor.renderWhitespace': 'none',
	'editor.occurrencesHighlight': 'off',
	'editor.lineNumbers': 'on',
	'terminal.integrated.fontSize': 15,

	// --- deterministic frames ---
	'editor.cursorBlinking': 'solid',
	'editor.cursorSmoothCaretAnimation': 'off',
	'editor.smoothScrolling': false,
	'workbench.list.smoothScrolling': false,
	'workbench.reduceMotion': 'on',
	// Typed text must land literally: auto-closing would turn a typed ``` fence
	// into ``````, auto-surround would wrap a selection instead of replacing it
	// (which is exactly how the diagnostics scene fixes a line), and auto-indent
	// compounds leading spaces -- typing a continuation line after one already
	// indented by two produced four, and pushed the closing fence off column 0
	// so the block never closed.
	'editor.autoClosingBrackets': 'never',
	'editor.autoClosingQuotes': 'never',
	'editor.autoSurround': 'never',
	'editor.autoIndent': 'none',
	'editor.quickSuggestions': { other: false, comments: false, strings: false },
	'editor.suggestOnTriggerCharacters': false,
	'editor.parameterHints.enabled': false,
	'editor.hover.enabled': false,
	'editor.lightbulb.enabled': 'off',

	// --- keystroke overlay (Developer: Toggle Screencast Mode) ---
	'screencastMode.fontSize': 28,
	'screencastMode.verticalOffset': 3,
	'screencastMode.keyboardOverlayTimeout': 1500,
	'screencastMode.mouseIndicatorSize': 30,
	'screencastMode.mouseIndicatorColor': '#F38518',
	'screencastMode.keyboardOptions': {
		showKeys: true,
		showKeybindings: true,
		showCommands: true,
		showCommandGroups: false,
		showSingleEditorCursorMoves: false,
	},

	// --- the extension under test ---
	'ipm.liveRefresh': true,
	'ipm.liveRefreshDebounceMs': 150,
	// Scenes that want to show embed-on-save turn this back on themselves; the
	// default off keeps a scene from writing _ipm/ SVGs it never shows.
	'ipm.embedOnSave': false,
	'ipm.restartOnBinaryChange': false,
};

export function prepareProfile(
	sceneId: string,
	overrides: Record<string, unknown> = {},
	fixture = sceneId,
): Profile {
	if (!existsSync(VSIX)) {
		throw new Error(`extension build not found at ${VSIX} -- run 'make vsix' (needs a .vsix in the extension repo)`);
	}
	const fixtureDir = join(FIXTURES_DIR, fixture);
	if (!existsSync(fixtureDir)) {
		throw new Error(`no fixture workspace at ${fixtureDir} -- every scene needs one (or set Scene.workspace)`);
	}

	const root = join(PROFILES_DIR, sceneId);
	const userDataDir = join(root, 'user-data');
	const extensionsDir = join(root, 'extensions');
	const workspaceDir = join(WORKSPACES_DIR, sceneId);

	for (const dir of [root, workspaceDir]) {
		rmSync(dir, { recursive: true, force: true });
	}
	mkdirSync(join(userDataDir, 'User'), { recursive: true });
	mkdirSync(extensionsDir, { recursive: true });
	mkdirSync(workspaceDir, { recursive: true });
	cpSync(fixtureDir, workspaceDir, { recursive: true });

	const settings: Record<string, unknown> = { ...BASE_SETTINGS, ...overrides };
	const server = chooseServer();
	if (server) {
		settings['ipm.serverPath'] = server;
	}
	writeFileSync(join(userDataDir, 'User', 'settings.json'), JSON.stringify(settings, null, 2) + '\n');

	initGitRepo(workspaceDir);
	installExtension(userDataDir, extensionsDir);
	return { userDataDir, extensionsDir, workspaceDir };
}

/**
 * Which ipm-rpc the recording should run against, or undefined to let the
 * extension use the one inside its own .vsix.
 *
 * A vsix built by CI (or by `npm run package` with bin/ staged) ships a server
 * for its platform, and that is what a user installing from the Marketplace
 * gets -- so a recording of it should exercise exactly that, not a binary built
 * from whatever state the sibling ipm-tools checkout happens to be in. Only when
 * the vsix carries no server does the profile point at the locally built one,
 * which is the extension's own documented fallback. DEMO_IPM_RPC forces a path
 * either way.
 */
function chooseServer(): string | undefined {
	if (process.env.DEMO_IPM_RPC) {
		console.log(`server: ${process.env.DEMO_IPM_RPC} (DEMO_IPM_RPC)`);
		return process.env.DEMO_IPM_RPC;
	}
	// Zip entry names sit in the archive uncompressed, so a substring search over
	// the bytes is enough to tell whether this platform's server is in there.
	const marker = `bin/${process.platform === 'darwin' ? 'darwin' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'amd64'}/ipm-rpc`;
	if (readFileSync(VSIX).includes(marker)) {
		console.log(`server: bundled in the vsix (${marker})`);
		return undefined;
	}
	if (existsSync(IPM_RPC)) {
		console.log(`server: ${IPM_RPC} (vsix bundles none)`);
		return IPM_RPC;
	}
	console.log('server: none found -- the extension will look on PATH');
	return undefined;
}

/**
 * Make the scene workspace its own git repository.
 *
 * Not cosmetic. The extension's repo-scoped features -- include refresh, "embed
 * all in repo" -- resolve a root by looking for one, and without a repository
 * here that search escapes upward: a recorded scene once re-embedded and
 * rewrote the *source fixtures* under demo/workspaces/ and dropped SVGs at the
 * container's filesystem root, because everything shared one enclosing tree.
 * A repo boundary at the workspace is both the fix and what a real user has.
 */
function initGitRepo(workspaceDir: string): void {
	const result = spawnSync('git', ['init', '-q'], { cwd: workspaceDir, stdio: 'inherit' });
	if (result.status !== 0) {
		throw new Error(`git init failed in ${workspaceDir} (status ${result.status})`);
	}
}

function installExtension(userDataDir: string, extensionsDir: string): void {
	const result = spawnSync(
		CODE_CLI,
		[
			'--no-sandbox',
			'--user-data-dir', userDataDir,
			'--extensions-dir', extensionsDir,
			'--install-extension', VSIX,
			'--force',
		],
		{ stdio: 'inherit', env: process.env },
	);
	if (result.status !== 0) {
		throw new Error(`installing ${VSIX} failed with status ${result.status}`);
	}
}
