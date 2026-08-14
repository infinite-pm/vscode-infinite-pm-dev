/**
 * A page that renders as the diagram alone -- no ipmt source in the Markdown --
 * and stays in sync when the graph it points at changes.
 *
 * This is the supported way to keep the source out of the rendered document:
 * an `<!-- ipm-include src=./x.ipmt -->` line instead of an inline fence. Both
 * the include line and the marker are HTML comments, so the preview (and
 * GitHub) show only the image. There is no fence attribute that hides the
 * source of an inline block: the flag vocabulary is `unresolved`, `defaults`
 * and `embed=false`, and an unknown token is a hard error, so a made-up
 * `​```ipmt hide` would draw a diagnostic rather than hide anything.
 *
 * Saving the .ipmt re-embeds every Markdown file that includes it -- that is the
 * extension's include-refresh path, and the payoff of the scene.
 */
import type { Scene } from '../src/scene.ts';

export default {
	id: 'include-refresh',
	title: 'Include: a page that renders as the diagram alone, refreshed from its .ipmt',
	order: 60,
	blurb: 'A page that renders as the diagram alone, kept in sync with the `.ipmt` it includes.',
	settings: { 'ipm.embedOnSave': true },

	async run(s) {
		await s.caption('The page carries no ipmt source — just an include line');
		await s.quickOpen('page.md');
		await s.act('open-preview', async () => {
			await s.palette('Markdown: Open Preview to the Side');
			await s.waitFor('iframe.webview', 45_000);
		}, { settle: 2600, shows: 'The page renders as the diagram alone: the Markdown carries an include line, not ipmt source' });

		await s.caption('The graph lives in its own .ipmt file');
		// Back to the left group first. Opening the preview to the side leaves
		// the right-hand group active, and quick open follows the active group --
		// without this the .ipmt replaces the preview instead of the page.
		await s.focusFirstGroup();
		await s.act('open-ipmt', async () => {
			await s.quickOpen('answer.ipmt');
		}, { settle: 1600, shows: 'The graph\'s own .ipmt file, opened beside the rendered page' });

		await s.caption('Add the answer there, and save');
		await s.focusEditor();
		await s.gotoEnd();
		await s.act('edit-and-save', async () => {
			await s.type('42 ::t --> lue\n', { delay: 50 });
			await s.type('42 --> number ::c\n', { delay: 50 });
			await s.beat(1000);
			await s.save();
			// Saving the .ipmt must re-embed the page that includes it. Wait
			// for the committed SVG to actually carry 42 — the caption says it
			// arrives, and a scene that films the old diagram says so too.
			await s.waitForWorkspaceFile('_ipm/page/answer.ipm.svg', '>42<');
		}, { settle: 3000, shows: 'Saving the .ipmt re-embeds the page: 42 arrives in the diagram, still with no source in the render' });

		await s.caption('The page re-embedded itself — still no source in the render');
		await s.beat(1600);
	},
} satisfies Scene;
