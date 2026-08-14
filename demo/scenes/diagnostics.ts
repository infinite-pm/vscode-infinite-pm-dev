/**
 * What a mistake looks like: the preview keeps the last good diagram and
 * overlays the parse error, the editor squiggles the line, and the Problems
 * panel carries the same message. Then the line is corrected and all three
 * clear together.
 *
 * The mistake is one relation of a real line from 42-21.ipmt, so fixing it
 * restores the example rather than inventing a variant. There is nothing else
 * to show: neither the extension nor ipm-rpc registers a code action, so there
 * is no quick fix to invoke. If that changes, this scene is where it belongs.
 */
import type { Scene } from '../src/scene.ts';

export default {
	id: 'diagnostics',
	title: 'Invalid ipmt: preview banner, squiggle and Problems entry — then the fix',
	order: 70,
	blurb: 'What a mistake looks like, in the preview, the editor and the Problems panel.',

	async run(s) {
		await s.caption('A valid graph, rendered');
		await s.quickOpen('40.ipmt');
		await s.act('open-preview', async () => {
			await s.palette('infinite.pm: Open Preview to the Side');
			await s.waitFor('iframe.webview', 45_000);
			await s.waitForDiagram(3);   // "rendered", not "a pane appeared"
		}, { settle: 1800, shows: 'A valid graph, rendered beside its source' });

		await s.focusEditor();
		await s.gotoEnd();

		await s.caption('Near-to (::N) only relates nodes of the same kind');
		await s.act('type-invalid-line', async () => {
			await s.type('humans --::N-- alive ::c', { delay: 60 });
			// The caption promises a banner that says WHY, so match the rule
			// rather than merely "some error": a generic parse failure here
			// would be a different (worse) story than the one being told.
			await s.waitForPreviewError(/Near-?to|::N/i);
		}, { settle: 2600, shows: 'An invalid Near-to: red banner over the last good diagram, squiggle on the line, one error in the status bar' });

		await s.caption('The preview keeps the last good diagram and says why');
		await s.beat(1400);

		// The same finding, from the language server.
		await s.caption('And the Problems panel carries the same message');
		await s.act('open-problems', async () => {
			await s.key('Control+Shift+M', { delay: 900 });
		}, { settle: 2000, shows: 'The Problems panel carries the same message, attributed to ipm-rpc with its line and column' });
		await s.key('Control+Shift+M', { delay: 700 });

		await s.caption('A thing expressing a concept is a plain leads-to');
		await s.focusEditor();
		await s.gotoEnd();
		await s.key('Home', { delay: 200 });
		await s.key('Shift+End', { delay: 400 });
		await s.act('fix-the-line', async () => {
			await s.type('humans --> alive ::c', { delay: 60 });
			// "Banner gone, diagram back" — both halves, or the still is a lie.
			await s.waitForNoPreviewError();
			await s.waitForDiagram(3);
		}, { settle: 2800, shows: 'Corrected to a plain leads-to: banner gone, no problems, and "alive" in the diagram' });

		await s.caption('Banner gone, Problems empty, diagram back');
		await s.beat(1400);
	},
} satisfies Scene;
