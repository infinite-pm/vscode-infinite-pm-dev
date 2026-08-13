# vscode-infinite-pm-dev

Internal tooling for the [`vscode-infinite-pm`](https://github.com/infinite-pm/vscode-infinite-pm)
extension that is **not** needed to develop the extension itself, and therefore
does not belong in its repository: demo recording, release media, screenshot
generation, and similar chores.

Nothing here ships to the Marketplace and nothing here is a dependency of the
extension's build.

| Directory | What it is |
| --- | --- |
| [`demo/`](demo/) | Scripted screen recordings of the extension — real VS Code, driven by Playwright inside a container, captured to `mp4` + `gif`. |
| [`docs/`](docs/) | Notes on the tooling itself — see [`headless-recording.md`](docs/headless-recording.md) for what a headless capture will lie to you about, and why a scene waits on state rather than on a pause. |

## demo — programmatic feature videos

`make demo` produces, per scene, an `mp4` master, a README-sized `gif`, and a
set of `png` stills — from a TypeScript script, reproducibly, with no GUI
interaction and **nothing installed on the host**. VS Code, Node, Playwright,
Xvfb and ffmpeg all live in the container image; only `demo/` and `out/` are
bind-mounted.

```bash
make image          # build the container image (downloads VS Code into it)
make ext            # rebuild the extension .vsix from source
make demo           # run every scene
make publish        # copy the rendered assets into the assets repository
make demo SCENES="ipmt-preview"
make demo SPEED=0.7 # 30% faster pauses and typing
make demo ZOOM=2    # bigger workbench (1.2x per step) at the same frame size
make list           # list available scenes
```

Scenes are framed for legibility after the GIF downscale: Default Light Modern,
`window.zoomLevel` scaling the whole workbench rather than just the editor font,
no activity bar, and no primary side bar unless a scene asks for it
(`sidebar: true`, which also narrows it to 60% — the Explorer's default 300px is
mostly empty in a four-file workspace).

Inputs come from the sibling checkouts, and `make demo` stages both into `out/`
so the container needs no mount outside this repository:

- **`../vscode-infinite-pm/*.vsix`** — the newest one wins; build it there with
  `npm run package`.
- **`../ipm-tools`** — a *static* `ipm-rpc` is built from it
  (`CGO_ENABLED=0`, because the host's glibc is newer than the image's) and the
  scene profiles point `ipm.serverPath` at it. Only CI's target-qualified `.vsix`
  bundles a server binary; a locally packaged one does not, and without this the
  extension would run with no language server at all — no diagrams, no
  diagnostics.

Output lands in `out/`:

```
out/
  README.md                    showcase: every scene as a gif, in order
  README-mp4.md                the same list with <video> players
  provenance.json              which builds produced this render
  ext.vsix                     copy of the extension build under test
  ipm-rpc                      locally built server, used only as a fallback
  video/ipmt-preview.mp4       1600x900 master
  video/ipmt-preview.gif       800px wide, 12fps — for README / Marketplace
  stills/ipmt-preview/*.png    scene screenshots
  stills/ipmt-preview/ipmt-preview.md   the scene as stills, step by step
  profiles/<scene>/            throwaway user-data-dir + extensions-dir
  workspaces/<scene>/          throwaway copy of demo/workspaces/<scene>
```

**Markdown contact sheets.** Each scene writes a page of its own stills: one
frame per step under a sentence saying what that frame shows (`shows` on
`s.act`). A page is read top to bottom, so the sequence carries the change — a
"before" would only ever be the picture above it printed twice — and a step that
alters nothing on screen keeps its heading and says so instead of repeating the
frame. The unit is one action, not one keystroke: a whole ipmt block typed in is
a single step.

`out/README.md` indexes them in each scene's declared `order`, and is rebuilt
from every scene with a report on disk, so `make demo SCENES=one` refreshes that
scene without shrinking the index.

**Which `ipm-rpc` runs.** If the `.vsix` bundles a server for this platform (CI
builds do, and so does `npm run package` with `bin/` staged), the recording uses
*that* — what a user installing from the Marketplace actually gets. The locally
built `out/ipm-rpc` is used only when the vsix carries none, which is the
extension's own documented fallback. `DEMO_IPM_RPC=/path/to/ipm-rpc` forces it
either way. Every run prints which one it chose.

### Provenance, and publishing

Every render writes `out/provenance.json` and opens the published README with
the same facts: the commit and subject of each repository that fed it (extension,
`ipm-tools`, the examples in `ipm-drawio`, and this harness), the extension
version, the sha256 of the `.vsix`, the VS Code build, and which `ipm-rpc` ran.
**Dirty is recorded, not hidden** — an asset rendered from a working tree with
uncommitted changes cannot be reproduced from its commit alone, so the table
says so. The `.vsix` carries its own evidence too (when it was built against
when its sources last changed), because "extension at commit X" is only true if
the build postdates X.

Collection is split: the container cannot see the sibling checkouts, so
[`cmd-dev/provenance`](cmd-dev/provenance) writes what git knows before the run
and the run merges in the versions only it can report.

`make publish` copies `video/`, `stills/`, both READMEs and `provenance.json`
into `ASSETS_REPO` (default `../vscode-infinite-pm-demo`) — the repository other
projects link to. It commits nothing; what lands there is for a human to read.
`make dist` then carries the two featured GIFs from there into the extension's
README ([`cmd-dev/assets-dist`](cmd-dev/assets-dist)), and `make dist-check`
exits non-zero when that copy is stale.

**Language.** Everything around the recorder is Go — provenance, distribution,
the container entrypoint (see [`cmd-dev/readme.md`](cmd-dev/readme.md)). The
recorder in `demo/src/` is TypeScript because Playwright's Electron support is
Node-only: there is no Go binding that can launch an Electron app and speak CDP
to its workbench, and hand-rolling one would trade a supported dependency for a
fragile reimplementation.

### Scenes

| id | shows |
| --- | --- |
| `ipmt-buttons` | The shortest one: the two buttons a `.ipmt` file puts in the editor title bar, each ringed and then clicked — preview beside the source, then in its place. No typing, no saving. |
| `ipmt-preview` | `40.ipmt` opened with the preview to the side; `42-21.ipmt` is typed in on top of it, re-rendering in memory line by line; wheel zoom stays vector-crisp. |
| `md-live-refresh` | ipmt fence inside Markdown: editor + preview share the tokenizer, and the preview swaps in a fresh render while you type — before any save. |
| `embed-on-save` | Where generated files come from, starting from one plain `.md` in a workspace of exactly one file: a save does nothing, an ipmt block is added, a save renders `_ipm/` and links it — the tree is expanded down to the generated `100.ipm.svg` and it is ringed in orange — then the SVG file is opened *below* the source, so fence, preview and file on disk are on screen together: `42` is typed, the preview has it, the file does not, and the save makes it catch up. |
| `new-doc` | An empty `.md`, preview split off before a word is typed. The fence is opened, given the model's opening spine and **closed immediately**; a save renders and links the SVG; then the block is grown from the inside, above the closing fence, re-rendering on every keystroke; a final save lets the SVG on disk catch up. |
| `diagnostics` | An invalid relation: red banner over the last good diagram in the preview, squiggle in the editor, the same message in the Problems panel — then the line is corrected and all three clear. |
| `include-refresh` | A page that renders as **the diagram alone, with no ipmt source**, via `<!-- ipm-include src=./answer.ipmt -->`. Editing and saving the `.ipmt` re-embeds the page. |

### Fixtures

Each scene gets **its own workspace** under
[`demo/workspaces/<scene-id>/`](demo/workspaces/), holding only the files that
scene needs (override with `Scene.workspace` if two scenes genuinely want the
same starting files). When the point of a scene is that `_ipm/` appeared, four
unrelated files in the Explorer work against it.

**Every graph here is one of ours, used verbatim — none are invented for the
demo, and scenes must not edit them into something else.**

`ipmt-preview`, `md-live-refresh`, `diagnostics` and `new-doc` use
[`ipm-drawio/temp/mj/40.ipmt`](../ipm-drawio/temp/mj/40.ipmt) and its zoom-in
[`42-21.ipmt`](../ipm-drawio/temp/mj/42-21.ipmt): the first is the fixture, the
second is what the scene types on top of it, ending exactly where that example
ends (`humans --> alive ::c`). `40.ipmt` rather than `42.ipmt` so the graph
opens on a spine — `Beginning --> Life, the Universe and Everything --> Freeze`
— instead of a single root event. The diagnostics scene mistypes *one relation* of
a real line — `humans --::N-- alive ::c` — so that fixing it restores the
example rather than inventing a variant.

The graph in `embed-on-save` and `include-refresh` is **the banner's own
model**, verbatim from
[`ipm-drawio/cmd-dev/banner-gen/content.go`](../ipm-drawio/cmd-dev/banner-gen/content.go)
— minus its two `42` lines, which each scene adds on camera. Nothing invented
for the demo: it is the diagram that already stands for the project, and 42
enters as a `::t`, a thing like any other that expresses the concept of a
number. If the banner model changes there, change it here too.

The starting states are not interchangeable:

- `md-live-refresh/life.md` ships **already embedded** (marker + generated
  SVG), the state a real repository is in.
- `embed-on-save/answer.md` ships as **plain prose, no fence at all** — the
  scene builds everything from there.
- `new-doc/new-doc.md` is **empty**, and stays that way: the scene types the
  whole document. An empty file rather than an untitled buffer, because saving
  an untitled buffer opens a file dialog that adds a detour to the video without
  showing anything about the extension.

Behind those differences is one fact: **live refresh swaps the `<img>` a marker
points at, so it needs one to exist.** In a Markdown file that means a save must
have embedded the diagram first — which is why the new-doc scene saves in the
middle rather than only at the end, and why closing the fence early is not by
itself enough to make anything appear.

After editing `life.md` or `page.md`, run `make fixtures` (it drives
`md-embed` from the sibling `ipm-tools` checkout) so the generated SVGs and
marker hashes match their sources again.

### Hiding the ipmt source in a rendered page

Use an include line, not a fence attribute:

```
<!-- ipm-include src=./answer.ipmt -->
```

Both the include line and the marker it grows are HTML comments, so the preview
and GitHub render only the image — this is what `include-refresh` demonstrates.

**There is no fence attribute that hides the source of an inline block.** The
flag vocabulary is closed — `unresolved`, `defaults`, `embed=false` — and an
unknown token is a hard error, so a made-up ` ```ipmt hide ` draws a diagnostic
instead of hiding anything. Adding one would mean a flag in `ipm-tools`
(`pkg/ipmtmeta`, plus docs and tests) that the extension's markdown-it plugin
then honours in the preview.

### How it works

1. **Xvfb** provides a 1600x900 virtual display inside the container — no
   compositor, no window manager, so the VS Code window is placed at exactly
   `0,0` at exactly the requested size.
2. **Playwright's Electron support** launches the real VS Code binary
   (`_electron.launch`) with a throwaway profile that has the extension `.vsix`
   installed, then drives it through the same DOM the user sees: command
   palette, quick open, typing into the editor. Each scene's workspace copy is
   `git init`-ed and `demo/` is mounted read-only: the extension's repo-scoped
   features (include refresh, embed-all-in-repo) resolve a root by searching
   upward, and without a repository boundary at the workspace one scene reached
   out and rewrote the source fixtures under `demo/workspaces/`.
3. **ffmpeg `x11grab`** screen-records the display for exactly as long as the
   scene runs — started by the scene runner once the workbench is ready, so
   there is no dead footage to trim. `s.snap()` grabs single frames from the
   same source, so a still can never be framed differently from the video
   (`page.screenshot` captures the CSS viewport, which stops matching the window
   as soon as the zoom level is non-zero).
4. **ffmpeg `palettegen`/`paletteuse`** converts the master to a GIF.

**Pacing**: a take should spend its seconds on the extension. ipmt content types
at reading pace (`s.type()`, 55ms/char) and ordinary Markdown at a third of that
(`s.prose()`, 18ms — a heading is not what anyone came for). Quick-input text is
not typed at all: `palette()` and `quickOpen()` insert the whole string at once
and then hold it for 700ms. What a viewer needs is to see *which* command ran,
and the pause does that; watching 34 characters arrive one at a time only draws
the eye to the scaffolding.

**Editor title bar**: `Scene.editorActions` keeps only the named buttons, by
tooltip prefix — staging in the same spirit as hiding the activity bar. A
`.ipmt` file's title bar carries this extension's two preview buttons plus VS
Code's Split Editor Right and More Actions; in a shot about *these* buttons the
other two are noise. Implemented as a stylesheet, because the toolbar is rebuilt
whenever the active editor changes and CSS reapplies itself.

**Keystrokes**: VS Code's screencast mode narrates *everything*, including every
letter typed into the editor, which buries the two or three presses that matter.
It is off unless a scene sets `screencast: true`. Instead `s.key()` shows a small
orange badge in the corner for the deliberate commands — save, command palette,
quick open, go to line, problems (`KEY_LABELS` in
[`demo/src/scene.ts`](demo/src/scene.ts)) — and stays silent for navigation keys
and for everything `s.type()` sends. `s.caption()` adds
the narration: a card in the bottom-right, injected into the workbench DOM so it
is part of the captured frame with no post-processing. Its `#ff8000` is the
palette's event orange, with near-black text — white on that orange is about
2.6:1 and unreadable once the GIF is downscaled. Captions are shown and hidden
around each beat, so they appear in the video but never in the stills.

### Adding a scene

Drop a file in [`demo/scenes/`](demo/scenes/); it is picked up automatically.

```ts
import type { Scene } from '../src/scene.ts';

export default {
  id: 'my-scene',
  title: 'What this shows',
  async run(s) {
    await s.caption('Open the file');
    await s.quickOpen('notes.md');
    await s.type('e1 --> e2\n');
    await s.beat(1200);
    await s.snap('result');
  },
} satisfies Scene;
```

The stage API (`s`) is in [`demo/src/scene.ts`](demo/src/scene.ts) — `beat`,
`type`, `key`, `palette`, `quickOpen`, `caption`, `snap`, `click`, `waitFor`.

### Known limitations

- **There are no quick fixes to record.** Neither the extension nor `ipm-rpc`
  registers a code action provider (no `codeAction` anywhere in either), so the
  `diagnostics` scene corrects the line by typing. When code actions land, that
  scene is where the lightbulb belongs.

- **No visible mouse pointer.** Playwright dispatches synthetic input through
  CDP, which never moves the X cursor, so `x11grab` records with
  `-draw_mouse 0`. Clicks are still visible via screencast mode's click
  indicator, and `s.pointer()` draws a synthetic pointer that follows the
  dispatched events. Keyboard-driven scenes look best.
- **Timing is wall-clock**, not frame-locked. Scenes are written with explicit
  `beat()` pauses; the recording is smooth but two runs are not byte-identical.
- The demo workspace under `demo/workspace/` contains **live** ` ```ipmt `
  fences — they are meant to be rendered by the extension. No `md-embed` or
  `sync-test-cases` scanner runs over this repo, so they do not enter any test
  corpus.

### Publishing the result

The Marketplace README renders animated **GIF** but not video, and `vsce`
rewrites relative image links against the `repository` field — so check the
result with `npm run package` in the extension repo before releasing.
