/**
 * Writing a document from nothing: empty Markdown file, preview split off to the
 * side before a word is typed, the diagram appearing as the fence is written,
 * and one save at the end that renders and links the generated SVG.
 *
 * The fence is closed after its first lines and then grown from the inside --
 * both how people actually write one, and what lets the rest of the scene show
 * anything: an unterminated fence is not a block yet.
 *
 * There is one save in the middle, and it is not decoration. Live refresh
 * *swaps* the rendered <img> the marker points at; until a save has embedded
 * one, the Markdown preview has nothing to swap and shows only the highlighted
 * fence. So: close the fence, save once to get a diagram, then grow the block
 * and watch it re-render on every keystroke without saving again.
 */
import type { Scene } from '../src/scene.ts';

export default {
	id: 'new-doc',
	title: 'New Markdown file: split preview from the start, typed live, saved at the end',
	order: 40,
	blurb: 'Writing a document from an empty file, diagram and all.',
	settings: { 'ipm.embedOnSave': true },

	async run(s) {
		await s.caption('A new, empty Markdown file');
		await s.quickOpen('new-doc.md');
		await s.beat(900);

		await s.caption('Preview to the side before writing a word');
		await s.act('open-preview', async () => {
			await s.palette('Markdown: Open Preview to the Side');
			await s.waitFor('iframe.webview', 45_000);
		}, { settle: 1500, shows: 'An empty Markdown file with its preview already beside it' });

		await s.focusEditor();
		await s.caption('Ordinary Markdown first');
		await s.act('type-prose', async () => {
			// Nothing to do with the extension, so it goes in fast.
			await s.prose('# Life, the Universe and Everything\n\n');
			await s.prose('The shape of the whole thing:\n\n');
		}, { settle: 900, shows: 'A heading and a sentence of ordinary Markdown' });

		// Open the fence, put the model's opening spine in it, and close it
		// straight away: a complete fence is what the renderer needs.
		await s.caption('Open an ipmt fence and close it right away');
		await s.act('type-fence', async () => {
			await s.type('```ipmt\n', { delay: 60 });
			await s.type('Beginning ::e\n', { delay: 45 });
			await s.type('  --> "Life, the Universe and Everything" ::e lue::a\n', { delay: 38 });
			await s.type('  --> Freeze ::e\n', { delay: 45 });
			await s.type('```', { delay: 60 });
		}, { settle: 1800, shows: 'An ipmt fence opened, given the model\'s opening spine, and closed straight away' });

		await s.caption('Save once — the SVG is rendered and linked under the fence');
		await s.act('first-save', async () => {
			await s.save();
			await s.waitForEditorText('ipm-svg');
		}, { settle: 2400, shows: 'The save renders the SVG and links it under the fence — the diagram appears' });

		// Back inside the block, above the closing fence, and grow it there.
		// By line number rather than ArrowUp: the save just inserted two lines,
		// and this should not depend on where that left the caret.
		await s.caption('Move back inside, above the closing fence');
		await s.gotoLine(8);
		await s.act('grow-block', async () => {
			await s.type('\n\nLife ::e --::P--> lue', { delay: 45 });
			await s.beat(1200);
			await s.type('\nthe Universe, everything --> lue', { delay: 45 });
			await s.beat(1200);
			await s.type('\n\nhumans --> Life', { delay: 50 });
		}, { settle: 2200, shows: 'Three more lines grown inside the block, each re-rendering the preview unsaved' });

		await s.caption('Save again — the SVG on disk catches up with the fence');
		await s.act('final-save', async () => {
			await s.save();
		}, { settle: 2600, shows: 'The save brings the SVG on disk up to date with the fence' });
	},
} satisfies Scene;
