/**
 * Where the generated files come from, starting from nothing: a plain Markdown
 * file in a workspace of exactly one file, so `_ipm/` appearing in the Explorer
 * is unmistakably the extension's doing.
 *
 * The graph is the banner's own model, verbatim from
 * ipm-drawio/cmd-dev/banner-gen/content.go -- minus the two 42 lines, which the
 * scene adds later. Nothing invented for the demo: this is the diagram that
 * already stands for the project.
 *
 * Live refresh is ON, and the scene is arranged so that it does not hide what
 * this scene is about. Once the SVG exists it is opened in a group below the
 * source, so three things are on screen at once: the fence being edited, the
 * preview re-rendering from the buffer as you type, and the file on disk. The
 * preview moving while the file below it sits still is the point -- and then a
 * save makes the file catch up.
 */
import type { Scene } from '../src/scene.ts';

export default {
	id: 'embed-on-save',
	title: 'Embed on save: the preview moves as you type, the file only on save',
	order: 50,
	blurb: 'Where the generated files come from, and what a save actually changes.',
	settings: {
		'ipm.embedOnSave': true,
		'ipm.liveRefresh': true,
		// Three panes and a 500px diagram: one zoom step down buys the room.
		// Scrolling the preview does not, because the Markdown preview scroll is
		// synced to the editor and both panes run off the end together.
		'window.zoomLevel': 0,
	},
	// The Explorer is the evidence here: one file before, `_ipm/` after.
	sidebar: true,

	async run(s) {
		await s.caption('A plain Markdown file — one file, nothing generated');
		await s.quickOpen('answer.md');
		await s.beat(1200);

		await s.caption('Open the Markdown preview to the side');
		await s.act('open-preview', async () => {
			await s.palette('Markdown: Open Preview to the Side');
			await s.waitFor('iframe.webview', 45_000);
		}, { settle: 1800, shows: 'One Markdown file, its preview beside it, and an Explorer holding nothing else' });

		await s.caption('Saving does nothing — there is no ipmt block to render');
		await s.focusEditor();
		await s.gotoEnd();
		await s.act('save-with-no-block', async () => {
			await s.save();
		}, { settle: 2000, shows: 'Saving writes nothing: there is no ipmt block to render' });

		await s.caption('Add an ipmt block');
		await s.act('type-block', async () => {
			await s.type('\n```ipmt\n', { delay: 55 });
			await s.type('"Life, the Universe and Everything" ::e lue::a\n', { delay: 40 });
			await s.type('humans / AI / machines ::t --> lue\n', { delay: 45 });
			await s.type('lue --> Complex process ::c\n', { delay: 45 });
			await s.type('```', { delay: 55 });
		}, { settle: 1800, shows: 'The banner\'s own model, typed into a fenced ipmt block' });

		await s.caption('Now save — the SVG is rendered, written and linked');
		await s.act('save-renders-svg', async () => {
			await s.save();
			await s.waitForEditorText('ipm-svg');
		}, { settle: 2600, shows: 'The save renders the SVG and inserts the marker and image link below the fence' });

		// The marker in the text says a file was written; the tree is where you
		// see that it exists.
		await s.caption('And the SVG itself is there, next to the page');
		await s.act('svg-in-explorer', async () => {
			await s.explorerExpand('_ipm');
			await s.explorerExpand('answer');
			await s.highlightShow('.explorer-folders-view .monaco-list-row:has-text("100.ipm.svg")');
		}, { settle: 1400, shows: '_ipm/answer/100.ipm.svg in the Explorer — the file the marker points at' });
		await s.highlightHide();

		// Put the file itself on screen, under the source. The Explorer click
		// opens it in the active group -- the left one, since the caret is in the
		// editor -- and moving it down splits that column into source over file.
		await s.caption('Open that SVG below the source, so the file is on screen too');
		await s.act('three-panes', async () => {
			await s.explorerRow('100.ipm.svg');
			await s.palette('View: Move Editor into Group Below');
		}, { settle: 1800, shows: 'That SVG opened below the source: fence, preview and file on disk, all on screen' });

		await s.caption('The answer is missing. Add it.');
		await s.focusFirstGroup();
		// Line 8 is `lue --> Complex process ::c`, the last line inside the block.
		// 42 is a ::t here, not a concept -- a thing like any other, which
		// expresses the concept of a number. That is the banner's own joke.
		await s.gotoLine(8);
		await s.act('type-42', async () => {
			await s.type('\n42 ::t --> lue\n42 --> number ::c', { delay: 50 });
			// A beat of its own, so the "after" cannot be mistaken for a shot
			// taken before a refresh had time to land.
			await s.beat(600);
		}, { settle: 2000, shows: '42 typed into the fence — the preview has it already, the file below does not' });

		await s.caption('The preview has 42 already. The file below it does not.');
		await s.beat(2000);

		// Two things have to be true before this shot is worth taking, and
		// neither is a pause: the file has to have been rewritten, and the pane
		// showing it has to have reloaded. The pane does reload on its own —
		// what it does not do is promise to have done so by the time a beat()
		// expires. See docs/headless-recording.md.
		await s.caption('Save — and the file catches up');
		const savedAt = Date.now();
		await s.act('save-catches-up', async () => {
			await s.save();
			await s.waitForWorkspaceFile('_ipm/answer/100.ipm.svg', '>42<');
			await s.waitForImagePreview('100.ipm.svg', savedAt);
		}, { settle: 2000, shows: 'The save rewrites the SVG on disk, the marker hash changes with it, and the pane below reloads' });
	},
} satisfies Scene;
