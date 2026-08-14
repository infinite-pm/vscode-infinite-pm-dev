# Recording VS Code headlessly: what lies to you

Notes from debugging a scene that looked like an extension bug for a day and
was not one. Written 2026-08-13, from the `embed-on-save` scene.

## The symptom

`embed-on-save` opens a generated `_ipm/answer/100.ipm.svg` in a third pane, in
VS Code's built-in image preview. The scene then edits the fence and saves, so
`ipm.embed` rewrites that SVG on disk. In the recording, the pane kept showing
the picture it had been opened with — even six seconds later, even with the
write verified by content. Doing the same thing by hand on a desktop VS Code
worked every time.

## What it was not

Each of these was measured from inside a recorded run, not argued:

- **Not our extension.** No combination of file watchers registered by the
  extension changed anything.
- **Not the container's file watching.** A probe extension logged `create` and
  `change` events for the SVG, including from a watcher registered exactly the
  way media-preview registers its own, `RelativePattern(<the file>, '*')`.
- **Not our write pattern.** `mdembed` writes with `os.WriteFile` — an in-place
  truncate, which produces an ordinary modify event, not the rename that
  watchers famously miss.
- **Not renderer throttling.** All frames ticked at ~121 rAF per 2 s with 100 ms
  interval gaps.
- **Not a stalled webview content swap.** A fresh `./fake.html` iframe loaded in
  33-38 ms in every webview host.
- **Not a stale service worker or a cached image.** The controller was present
  and the `?version=` cache-buster advanced on every re-render.

## What it was

The image preview **did** reload, every time. Reading the webview host frames
through the Electron main process showed a complete new content cycle within
300 ms of the write — the four `webview/index.html/content/*` performance marks
going 1 → 2, and the `<img>` moving to a fresh `?version=<Date.now()>` URL.

The DOM was right and the captured pixels were not. Across eight runs the pane
showed fresh pixels in four and stale in five, with no code difference that
predicts which.

Three properties of this environment conspire:

1. Stills and video come off the X server with `ffmpeg x11grab`, never through
   the app — so the capture shows whatever the compositor last put in the
   framebuffer, which need not be what the DOM says.
2. There is no window manager and `--disable-gpu` is set, so compositing is
   software and nothing outside the app ever damages a region.
3. The markdown preview never showed this, because it patches its DOM in place.
   The image preview swaps in a **whole new iframe** — a fresh compositing
   surface is exactly what a software compositor is most likely not to flush.

## What we changed

- `demo/src/code.ts` passes `--disable-renderer-backgrounding`,
  `--disable-background-timer-throttling` and
  `--disable-backgrounding-occluded-windows`. Chromium treats a window nobody
  ever focuses — which is every window here, since no window manager grants
  focus — as backgrounded.
- `Stage.waitForImagePreview(fileName, since)` waits until the image preview's
  `<img>` carries a `?version=` newer than a timestamp taken before the action,
  then spends two animation frames in each webview host so a frame is actually
  produced. The scene now waits on that rather than on a `beat()`.

## What later runs added

Two follow-ups, once the scenes started asserting instead of hoping.

**Capture gets a nudge.** Every still now calls Electron's
`webContents.invalidate()` and waits two animation frames before grabbing. That
is the damage event a compositor with no window manager on top of it never
receives, and it costs a few milliseconds.

**And the honest part: that did not fix everything.** With the DOM readable
from the scenes, the remaining failures could be told apart — and VS Code's
image preview turns out to reload its file *unreliably here*, with the DOM (not
merely the captured pixels) still holding the previous render. Measured across a
dozen runs on 2026-08-14: reloaded in some, not in others, no code difference
between them. `waitForImagePreview` now names which of the two happened, and
`embed-on-save` waits, then reopens the file the way a person would, and calls
`s.note()` so the run log records that it limped.

That is not a diagnosis, it is a boundary: what we control is asserted, what we
do not is detected and worked around out loud.

## The rule this leaves

**Never take a still on a timer when the thing you are photographing can tell
you it is ready.** `waitForWorkspaceFile` was already doing this for disk
state; `waitForImagePreview` does it for the pane. A `beat()` that is usually
long enough produces a video that is usually right, and the harness cannot tell
a stale pane from a deliberate one — it dedupes identical frames and writes
"Nothing changed on screen" into the report, which reads like a finding rather
than a miss.

If another pane ever shows this, the diagnostic that settled it is worth
rebuilding: from a scene, `app.evaluate` over
`win.webContents.mainFrame.framesInSubtree`, filtered to frames whose URL
contains `index.html`, running `executeJavaScript` to read
`performance.getEntriesByType('mark')` and the child iframes' `img` src. Webview
hosts are out-of-process iframes; that path reaches them where Playwright's
frame attachment may not.
