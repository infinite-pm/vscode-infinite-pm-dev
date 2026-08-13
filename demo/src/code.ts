/**
 * Launching the real VS Code under Playwright's Electron support.
 *
 * There is no window manager on the Xvfb display, so the window is positioned
 * and sized from the Electron main process (app.evaluate) rather than left to a
 * compositor -- that is what makes the captured frame exactly WIDTHxHEIGHT with
 * no decorations of anyone else's making (VS Code draws its own title bar).
 */
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { CODE_APP, HEIGHT, WIDTH } from './config.ts';
import type { Profile } from './profile.ts';

export interface Session {
	app: ElectronApplication;
	page: Page;
}

export async function launchVSCode(profile: Profile): Promise<Session> {
	const app = await electron.launch({
		executablePath: CODE_APP,
		args: [
			// Running as root in a container: Chromium's sandbox cannot start.
			'--no-sandbox',
			'--disable-gpu-sandbox',
			// /dev/shm is small in containers unless --shm-size is raised; we do
			// raise it, but the flag costs nothing and covers a plain podman run.
			'--disable-dev-shm-usage',
			'--disable-gpu',
			'--force-device-scale-factor=1',

			// Nothing here is ever in the foreground the way Chromium means it:
			// there is no window manager to grant focus, and a window it treats
			// as backgrounded or occluded gets its timers clamped and its
			// compositing deprioritised. That is invisible in most of a
			// recording and then very visible in one frame — a pane whose DOM
			// has already updated while the captured pixels have not. Measured
			// case: the image preview swapping in a freshly rendered SVG.
			'--disable-renderer-backgrounding',
			'--disable-background-timer-throttling',
			'--disable-backgrounding-occluded-windows',

			'--user-data-dir', profile.userDataDir,
			'--extensions-dir', profile.extensionsDir,
			'--disable-workspace-trust',
			'--skip-welcome',
			'--skip-release-notes',
			'--disable-updates',
			'--disable-telemetry',
			'--new-window',
			profile.workspaceDir,
		],
		env: { ...process.env } as Record<string, string>,
		timeout: 0,
	});

	const page = await findWorkbench(app);
	await app.evaluate(async ({ BrowserWindow }, size) => {
		const win = BrowserWindow.getAllWindows()[0];
		if (!win) {
			return;
		}
		win.setMenuBarVisibility(false);
		win.setBounds({ x: 0, y: 0, width: size.width, height: size.height });
		win.focus();
	}, { width: WIDTH, height: HEIGHT });

	await page.waitForTimeout(1500);
	return { app, page };
}

/**
 * app.firstWindow() is not enough: VS Code opens auxiliary BrowserWindows, and
 * the one we want is whichever is running workbench.html.
 */
async function findWorkbench(app: ElectronApplication, timeoutMs = 90_000): Promise<Page> {
	const deadline = Date.now() + timeoutMs;
	let last: Page | undefined;

	while (Date.now() < deadline) {
		for (const page of app.windows()) {
			if (!page.url().includes('workbench')) {
				continue;
			}
			last = page;
			try {
				await page.waitForSelector('.monaco-workbench', { timeout: 5_000, state: 'attached' });
				return page;
			} catch {
				// keep polling: the window exists but has not finished booting
			}
		}
		await app.waitForEvent('window', { timeout: 2_000 }).catch(() => undefined);
	}

	throw new Error(
		`VS Code workbench did not come up within ${timeoutMs}ms` +
		(last ? ` (last window: ${last.url()})` : ' (no workbench window appeared)'),
	);
}

export async function closeVSCode(app: ElectronApplication): Promise<void> {
	await app.close().catch(() => undefined);
}
