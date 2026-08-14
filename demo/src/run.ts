/**
 * Scene runner: profile -> launch -> record -> drive -> encode, per scene.
 *
 *   tsx src/run.ts                 record every scene
 *   tsx src/run.ts ipmt-preview    record one
 *   tsx src/run.ts --list
 *
 * Normally invoked through the container entrypoint (which supplies the Xvfb
 * display), i.e. `make demo`.
 */
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OUT_DIR, SCENES_DIR, STILLS_DIR, VIDEO_DIR } from './config.ts';
import { closeVSCode, launchVSCode } from './code.ts';
import { prepareProfile, serverInfo, vscodeVersion } from './profile.ts';
import { poster, startRecording, toGif } from './capture.ts';
import { writeIndex, writeProvenance, writeSceneReport } from './report.ts';
import { Stage, type Scene } from './scene.ts';

async function loadScenes(): Promise<Scene[]> {
	const files = readdirSync(SCENES_DIR).filter((f) => f.endsWith('.ts')).sort();
	const scenes: Scene[] = [];
	for (const file of files) {
		const mod = await import(pathToFileURL(join(SCENES_DIR, file)).href);
		const scene = mod.default as Scene | undefined;
		if (!scene?.id || typeof scene.run !== 'function') {
			throw new Error(`${file} does not default-export a Scene`);
		}
		scenes.push(scene);
	}
	return scenes;
}

/** What only this run can report, filled in on the first scene. */
const runtime: { vscode?: string; ipmRpc?: { version?: string; source?: string } } = {};

async function record(scene: Scene): Promise<void> {
	console.log(`\n=== ${scene.id} -- ${scene.title}`);

	const profile = prepareProfile(scene.id, scene.settings, scene.workspace ?? scene.id);
	runtime.vscode ??= vscodeVersion();
	runtime.ipmRpc ??= serverInfo(profile);
	const { app, page } = await launchVSCode(profile);
	const stage = new Stage(page, app, scene.id, profile.workspaceDir);

	// Pre-roll, before the recorder starts: whatever a first launch put on
	// screen goes away here rather than in the video.
	await page.keyboard.press('Escape');
	await stage.palette('Notifications: Clear All Notifications');
	if (scene.sidebar) {
		await stage.narrowSideBar(scene.sidebarWidth ?? 0.6);
	} else {
		await stage.palette('View: Toggle Primary Side Bar Visibility');
	}
	if (scene.screencast === true) {
		await stage.palette('Developer: Toggle Screencast Mode');
	}
	if (scene.editorActions) {
		await stage.keepEditorActions(scene.editorActions);
	}
	await stage.pointer();
	await stage.beat(500);

	const video = join(VIDEO_DIR, `${scene.id}.mp4`);
	const recording = startRecording(video);
	await stage.beat(600); // let ffmpeg reach the display before anything moves

	let failure: unknown;
	try {
		await scene.run(stage);
		await stage.beat(900); // a moment on the final frame
	} catch (error) {
		failure = error;
		await stage.snap('FAILURE').catch(() => undefined);
	} finally {
		await recording.stop();
		await closeVSCode(app);
	}

	if (failure) {
		throw failure;
	}

	await toGif(video, join(VIDEO_DIR, `${scene.id}.gif`));
	await poster(video, join(STILLS_DIR, scene.id, '00-poster.png'), 1);
	const report = writeSceneReport({ id: scene.id, title: scene.title, order: scene.order, blurb: scene.blurb, steps: stage.steps });
	writeIndex();
	console.log(`--- ${scene.id}: ${video} + .gif, ${stage.steps.length} stills, ${report}`);
}

async function main(): Promise<void> {
	const args = process.argv.slice(2).filter((a) => a.length > 0);
	const all = await loadScenes();

	// Rebuilding the index needs no VS Code: it reads the reports each scene
	// already wrote. Useful when the copy around the recordings changes and the
	// recordings themselves have not.
	if (args.includes('--index')) {
		console.log(`rebuilt ${writeIndex()}`);
		return;
	}

	if (args.includes('--list')) {
		for (const scene of all) {
			console.log(`${scene.id.padEnd(24)} ${scene.title}`);
		}
		return;
	}

	const wanted = args.filter((a) => !a.startsWith('-'));
	const scenes = wanted.length ? all.filter((s) => wanted.includes(s.id)) : all;

	const missing = wanted.filter((id) => !all.some((s) => s.id === id));
	if (missing.length) {
		throw new Error(`unknown scene(s): ${missing.join(', ')} -- try --list`);
	}

	const failed: string[] = [];
	for (const scene of scenes) {
		try {
			await record(scene);
		} catch (error) {
			failed.push(scene.id);
			console.error(`!!! ${scene.id} failed: ${error instanceof Error ? error.message : error}`);
		}
	}

	const recorded = scenes.filter((s) => !failed.includes(s.id)).map((s) => s.id);
	if (recorded.length) {
		writeProvenance({ ...runtime, scenes: recorded });
		writeIndex();
	}
	console.log(`\nrecorded ${scenes.length - failed.length}/${scenes.length} scene(s) into ${OUT_DIR}`);

	// A failed scene leaves a partial mp4 and a FAILURE still beside last
	// week's good ones, and `make publish` rsyncs the directory wholesale into
	// the assets repo — from which `make dist` carries GIFs into the extension
	// README the Marketplace shows. Leave a marker the publish step can see,
	// and clear it when everything passed, so a green run after a red one is
	// not blocked by a stale file.
	const marker = join(OUT_DIR, 'FAILED');
	if (failed.length) {
		writeFileSync(marker, `${failed.join('\n')}\n`);
		console.error(`failed: ${failed.join(', ')}`);
		console.error(`wrote ${marker} — \`make publish\` will refuse until this is resolved`);
		process.exitCode = 1;
	} else if (existsSync(marker)) {
		rmSync(marker);
	}
}

await main();
