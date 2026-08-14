/**
 * ipmt fences inside Markdown: syntax colours in the editor, and the diagram
 * on disk being replaced in VS Code's Markdown preview, as you type, by an
 * in-memory render of the edited fence.
 *
 * The fixture (demo/workspaces/md-live-refresh/life.md) is already embedded --
 * marker plus generated SVG, the state a real repository is in. Without that
 * there is no <img> for live refresh to swap, and the preview would show only
 * the highlighted fence; see the embed-on-save scene for how the marker gets
 * there.
 */
import type { Scene } from '../src/scene.ts';

export default {
	id: 'md-live-refresh',
	title: 'Markdown: ipmt fence highlighting + live SVG refresh in the preview',
	order: 30,
	blurb: 'The same, inside a fenced `ipmt` block in ordinary Markdown.',

	async run(s) {
		await s.caption('An ipmt fence inside ordinary Markdown');
		await s.quickOpen('life.md');
		await s.beat(1400);

		await s.caption('Open the Markdown preview to the side');
		await s.act('open-preview', async () => {
			await s.palette('Markdown: Open Preview to the Side');
			await s.waitFor('iframe.webview', 45_000);
		}, { settle: 2600, shows: 'The fence coloured in both panes, with the diagram from disk below it' });

		await s.caption('Zoom in on part of the graph — without saving');
		await s.focusEditor();
		// See demo/workspaces/md-live-refresh/life.md.
		await s.gotoLine(13);
		// 42-21.ipmt verbatim, ending on that example's last line.
		await s.act('add-21st-century', async () => {
			await s.type('\nl21::a Life in 21st century ::e --::P--> Life ::e', { delay: 40 });
		}, { settle: 1800, shows: 'A line typed into the fence appears in the preview, the file still unsaved' });

		await s.act('add-humans-ais', async () => {
			await s.type('\nhumans, AIs --> l21', { delay: 45 });
		}, { settle: 1600, shows: 'humans and AIs join it, still without a save' });

		await s.act('add-alive', async () => {
			await s.type('\nhumans --> alive ::c', { delay: 45 });
		}, { settle: 2400, shows: 'humans expresses "alive" — the whole edit rendered, nothing written to disk' });

		await s.caption('The preview swapped in a freshly rendered SVG');
		await s.beat(1600);
	},
} satisfies Scene;
