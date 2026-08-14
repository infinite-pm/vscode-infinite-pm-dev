/**
 * Paths and knobs. Everything is overridable by environment variable so the
 * Makefile stays the only place that knows about podman.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const num = (v: string | undefined, fallback: number): number => {
	const n = v === undefined ? NaN : Number(v);
	return Number.isFinite(n) ? n : fallback;
};

/** Repository root as seen inside the container. */
export const WORK_DIR = process.env.DEMO_WORK ?? '/work';
export const DEMO_DIR = join(WORK_DIR, 'demo');
export const OUT_DIR = process.env.DEMO_OUT ?? join(WORK_DIR, 'out');

export const SCENES_DIR = join(DEMO_DIR, 'scenes');
/**
 * One fixture workspace per scene, named after it. A scene's workspace holds
 * only the files that scene needs -- when the point is that `_ipm/` appeared,
 * four unrelated files in the Explorer are working against you.
 */
export const FIXTURES_DIR = join(DEMO_DIR, 'workspaces');

export const VIDEO_DIR = join(OUT_DIR, 'video');
export const STILLS_DIR = join(OUT_DIR, 'stills');
export const PROFILES_DIR = join(OUT_DIR, 'profiles');
export const WORKSPACES_DIR = join(OUT_DIR, 'workspaces');

/** The extension build under test -- the Makefile copies it here. */
export const VSIX = process.env.DEMO_VSIX ?? join(OUT_DIR, 'ext.vsix');

/**
 * The language server. Only CI's target-qualified .vsix bundles an ipm-rpc; a
 * locally packaged one relies on ipm.serverPath, so the Makefile builds a static
 * binary here and the profile points at it. Absent = trust whatever the vsix has.
 */
export const IPM_RPC = process.env.DEMO_IPM_RPC ?? join(OUT_DIR, 'ipm-rpc');

/** Unpacked VS Code (in the image, or a host build mounted over it). */
export const VSCODE_DIR = process.env.VSCODE_DIR ?? '/opt/vscode';

export const WIDTH = num(process.env.DEMO_WIDTH, 1600);
export const HEIGHT = num(process.env.DEMO_HEIGHT, 900);
export const FPS = num(process.env.DEMO_FPS, 25);

/** GIF is downscaled from the master: readable in a README, small enough to ship. */
export const GIF_WIDTH = num(process.env.DEMO_GIF_WIDTH, 800);
export const GIF_FPS = num(process.env.DEMO_GIF_FPS, 12);

/**
 * Where the published assets live, for the MP4 README: GitHub will not play a
 * <video> from a repository-relative path, so those need absolute URLs.
 */
export const ASSETS_URL = (process.env.DEMO_ASSETS_URL
	?? 'https://raw.githubusercontent.com/infinite-pm/vscode-infinite-pm-demo/main').replace(/\/$/, '');

/** Multiplies every pause and typing delay. 0.5 = twice as fast. */
export const SPEED = num(process.env.DEMO_SPEED, 1);

/**
 * VS Code's window zoom level: each step is 1.2x on the whole workbench, not
 * just the editor font, so icons, tabs and the status bar scale with the text.
 * At 1600x900 that is what makes a downscaled GIF readable.
 */
export const ZOOM = num(process.env.DEMO_ZOOM, 1);

/**
 * VS Code ships its Electron binary next to a shell wrapper of the same name in
 * bin/. Playwright must be handed the *binary*; the wrapper is what the CLI
 * (--install-extension) needs. Stable is `code`, Insiders `code-insiders`.
 */
function resolveNames(): { app: string; cli: string } {
	for (const name of ['code', 'code-insiders', 'codium', 'codium-insiders']) {
		if (existsSync(join(VSCODE_DIR, name))) {
			return { app: join(VSCODE_DIR, name), cli: join(VSCODE_DIR, 'bin', name) };
		}
	}
	throw new Error(
		`no VS Code executable found in ${VSCODE_DIR} -- rebuild the image, or mount an unpacked VS Code there`,
	);
}

export const { app: CODE_APP, cli: CODE_CLI } = resolveNames();
