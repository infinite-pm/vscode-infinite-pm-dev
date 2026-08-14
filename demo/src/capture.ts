/**
 * Screen capture and encoding, both plain ffmpeg.
 *
 * We grab the X display rather than asking Playwright for a video: x11grab
 * records at a constant frame rate independent of what the script is doing, and
 * it sees *everything* on screen -- including anything VS Code renders outside
 * the page, which a page-level recorder would miss. The recorder is started by
 * the scene runner once the workbench is ready, so there is no dead footage.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { FPS, GIF_FPS, GIF_WIDTH, HEIGHT, WIDTH } from './config.ts';

export interface Recording {
	file: string;
	stop(): Promise<void>;
}

export function startRecording(file: string): Recording {
	mkdirSync(dirname(file), { recursive: true });
	const display = process.env.DISPLAY ?? ':99';

	const proc = spawn('ffmpeg', [
		'-loglevel', 'error',
		'-y',
		'-f', 'x11grab',
		// Playwright dispatches input through CDP, which never moves the X
		// cursor -- drawing it would pin a pointer at 0,0 for the whole video.
		'-draw_mouse', '0',
		'-video_size', `${WIDTH}x${HEIGHT}`,
		'-framerate', String(FPS),
		'-i', `${display}.0+0,0`,
		'-c:v', 'libx264',
		'-preset', 'veryfast',
		'-crf', '18',
		'-pix_fmt', 'yuv420p',
		'-movflags', '+faststart',
		file,
	], { stdio: ['pipe', 'inherit', 'inherit'] });

	const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));

	return {
		file,
		async stop() {
			// 'q' on stdin makes ffmpeg finalise the container; killing it
			// outright can leave an unplayable file.
			proc.stdin?.write('q');
			proc.stdin?.end();
			const timer = setTimeout(() => proc.kill('SIGINT'), 5_000);
			const hardTimer = setTimeout(() => proc.kill('SIGKILL'), 10_000);
			await exited;
			clearTimeout(timer);
			clearTimeout(hardTimer);
		},
	};
}

/**
 * A single frame off the display, as the recorder sees it.
 *
 * Not page.screenshot(): that captures the CSS viewport, which is a different
 * size from the window once VS Code's zoom level is non-zero -- stills came out
 * scaled down and clipped on the right while the video was fine. Grabbing from
 * X keeps stills and video pixel-identical by construction.
 */
export async function grabFrame(file: string): Promise<void> {
	mkdirSync(dirname(file), { recursive: true });
	const display = process.env.DISPLAY ?? ':99';
	await run('ffmpeg', [
		'-loglevel', 'error',
		'-y',
		'-f', 'x11grab',
		'-draw_mouse', '0',
		'-video_size', `${WIDTH}x${HEIGHT}`,
		'-i', `${display}.0+0,0`,
		'-frames:v', '1',
		file,
	]);
}

/** Master video -> GIF, via a per-clip optimised palette. */
export async function toGif(src: string, dst: string): Promise<void> {
	await run('ffmpeg', [
		'-loglevel', 'error',
		'-y',
		'-i', src,
		'-filter_complex',
		`fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[a][b];` +
		'[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
		'-loop', '0',
		dst,
	]);
}

/** A single frame, for a poster image or a README still. */
export async function poster(src: string, dst: string, atSeconds: number): Promise<void> {
	await run('ffmpeg', [
		'-loglevel', 'error',
		'-y',
		'-ss', String(atSeconds),
		'-i', src,
		'-frames:v', '1',
		dst,
	]);
}

function run(cmd: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc: ChildProcess = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
		proc.once('error', reject);
		proc.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
	});
}
