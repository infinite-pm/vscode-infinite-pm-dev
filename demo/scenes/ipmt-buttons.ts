/**
 * A round trip through the buttons a .ipmt file puts in the editor title bar:
 * source, preview in place, back to source, preview beside it, and one small
 * edit to show it keeping up.
 *
 * The keep-list includes "Reopen as source file" for a reason. It is the button
 * the preview itself carries, and an earlier take that hid everything but the
 * two opening buttons ended on a preview with no visible way back -- staging
 * that had quietly removed a control the flow depends on.
 */
import type { Scene } from '../src/scene.ts';

const IN_PLACE = '.editor-actions [aria-label^="Open as Preview"]';
const BACK_TO_SOURCE = '.editor-actions [aria-label^="Reopen as source file"]';

export default {
	id: 'ipmt-buttons',
	title: 'The .ipmt title-bar buttons: preview in place, back to source, and side by side',
	order: 10,
	blurb: 'Two buttons, and the round trip between source and diagram.',
	editorActions: ['Open Preview to the Side', 'Open as Preview', 'Reopen as source file'],

	async run(s) {
		await s.quickOpen('40.ipmt');
		await s.beat(900);

		await s.caption('A .ipmt file gets two buttons in the title bar');
		await s.highlightShow(IN_PLACE);
		await s.snap('buttons', 'A .ipmt file carries two preview buttons in its title bar');
		await s.beat(1600);
		await s.highlightHide();

		await s.caption('This one shows the diagram in place of the source');
		await s.act('open-in-place', async () => {
			await s.editorAction('Open as Preview');
			await s.waitFor('iframe.webview', 45_000);
			await s.waitForDiagram(3);   // a webview that renders nothing looks the same
		}, { settle: 2200, shows: 'The diagram replaces the source view, and the way back appears in the title bar' });

		await s.caption('The preview carries the way back');
		await s.highlightShow(BACK_TO_SOURCE);
		await s.beat(1200);
		await s.highlightHide();
		await s.act('back-to-source', async () => {
			await s.editorAction('Reopen as source file');
		}, { settle: 1600, shows: 'Back to the source, in the same tab' });

		await s.caption('The other button keeps both on screen');
		await s.act('open-to-the-side', async () => {
			await s.editorAction('Open Preview to the Side');
			await s.waitFor('iframe.webview', 45_000);
			await s.waitForDiagram(3);   // a webview that renders nothing looks the same
		}, { settle: 2000, shows: 'The other button keeps source and diagram side by side' });

		await s.caption('One line, and the diagram keeps up');
		await s.focusFirstGroup();
		await s.gotoEnd();
		await s.act('edit-one-line', async () => {
			await s.type('humans --> alive ::c\n', { delay: 45 });
		}, { settle: 2200, shows: 'One line typed: "alive" appears in the diagram beside it' });
	},
} satisfies Scene;
