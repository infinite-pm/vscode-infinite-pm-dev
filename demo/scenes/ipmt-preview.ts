/**
 * The .ipmt preview pane: open a graph file, put the rendered SVG next to it,
 * type, watch it re-render, then zoom.
 */
import type { Scene } from '../src/scene.ts';

export default {
	id: 'ipmt-preview',
	title: '.ipmt preview to the side: live re-render while typing, pan + zoom',
	order: 20,
	blurb: 'A `.ipmt` file is a graph: the source *is* the diagram, and it re-renders as you type.',

	async run(s) {
		await s.caption('An .ipmt file is a graph — the source is the diagram');
		await s.quickOpen('40.ipmt');
		await s.beat(1000);

		await s.caption('Open Preview to the Side');
		await s.act('open-preview', async () => {
			await s.palette('infinite.pm: Open Preview to the Side');
			await s.waitFor('iframe.webview', 45_000);
		}, { settle: 2200, shows: 'The preview opens beside the source, showing the whole graph' });

		await s.caption('Typing re-renders in memory — nothing is written to disk');
		await s.focusEditor();
		await s.gotoEnd();
		// The lines typed here are 42-21.ipmt verbatim: the 21st century as a
		// part of Life. Ends where that example ends, `humans --> alive ::c`.
		await s.act('add-21st-century', async () => {
			await s.type('l21::a Life in 21st century ::e --::P--> Life ::e\n', { delay: 40 });
		}, { settle: 1800, shows: 'A typed line adds "Life in 21st century" as part of Life — rendered without a save' });

		await s.act('add-earth', async () => {
			await s.type('\nEarth --> planet ::c\n', { delay: 45 });
			await s.type('Earth --> l21\n', { delay: 50 });
		}, { settle: 1800, shows: 'Earth joins, expressing the concept "planet" and feeding the 21st century' });

		await s.act('add-humans-ais', async () => {
			await s.type('\nhumans, AIs --> l21\n', { delay: 45 });
			await s.type('humans --> alive ::c\n', { delay: 45 });
		}, { settle: 2000, shows: 'humans and AIs join the 21st century, and humans expresses "alive"' });

		// Optional: a scene should still produce a usable video if the pane moved.
		if (await s.has('iframe.webview', 2_000)) {
			// The preview scales by exp(-deltaY * 0.0015) per notch, so three of
			// these land near 170% -- enough to show crisp vectors while keeping
			// the graph in frame. Zoom is cursor-centred, hence `at`: the graph
			// sits in the right half of the pane, not at its midpoint.
			const at = { x: 0.72, y: 0.45 };
			await s.caption('Wheel zoom is vector — the SVG is resized, not scaled');
			await s.act('zoom-in', async () => {
				await s.wheelOver('iframe.webview', -140, { steps: 3, delay: 240, at });
			}, { settle: 1600, shows: 'Wheel zoom to 170%: the nodes stay sharp, because the SVG is resized rather than scaled' });
			await s.wheelOver('iframe.webview', 140, { steps: 3, delay: 180, at });
			await s.beat(1200);
		}
	},
} satisfies Scene;
