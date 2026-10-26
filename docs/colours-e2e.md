# Rendered-colour test (`make colours-e2e`)

A real VS Code (the image's, 1.143.1 for `ipm-vscode-demo-new`) is driven by
Playwright with the `.vsix` under test installed and an `ipm-rpc` built from
`TOOLS_REPO`. The test judges the colours the user sees by reading the DOM, never
an image: `getComputedStyle(span).color`, `fontWeight` and `backgroundColor` of
every token span Monaco paints (`.monaco-editor .view-line span span`), and of the
spans of the Markdown preview webview (`pre.ipmt-block span`).

```
make colours-e2e IMAGE=ipm-vscode-demo-new \
  EXT_REPO=/path/to/vscode-infinite-pm TOOLS_REPO=/path/to/ipm-tools
make colours-e2e VSIX=/path/to/older.vsix TOOLS_REPO=...   # test an older release
make colours-e2e COLOURS_RUNS=light                        # runs whose id contains "light"
make colours-e2e COLOURS_SETTINGS='{"editor.bracketPairColorization.enabled":false}'
```

`VSIX` defaults to the newest `*.vsix` in `EXT_REPO`; the server is always the
freshly built `out/ipm-rpc` (`DEMO_IPM_RPC`), never the one bundled in the vsix.
Build the vsix first (`npm run package` in the extension, with
`IPM_TOOLS_DIR=` pointing at the matching ipm-tools for the palette drift check).
The Go build needs `GOWORK=off` when `TOOLS_REPO` is a checkout inside a workspace.

## Runs

| run | theme | semantic tokens | preview |
|---|---|---|---|
| `light-2026-semantic` | Light 2026 | on | yes |
| `dark-modern-semantic` | Dark Modern | on | yes |
| `light-2026-textmate` | Light 2026 | off for `[markdown]` and `[ipmt]` | no |

Fixtures: `demo/workspaces/colours/colours.ipmt` and `colours.md` (the same four
lines, in a fence). Each file is opened with Quick Open; the test then polls the
DOM (no sleeps) until the rows pass or 25 s pass, and prints the last table.

## What is asserted

Per segment of each line, every non-space character: thing = green, event =
orange, concept = blue, `::t`/`::c` markers bold in the colour of their node, the
quoted title text and its two quote characters in the node colour (never the
string colour `#ce9178` dark, `#a31515` light), no token with a background, and
the `::t` marker colour equals the thing title colour. Light / dark values are
the extension's design (`#2d6e1f #a65300 #1a5f9e`, `#6fc24f #ff8000 #6c8ebf`).

The `-->` arrow is coloured by its relation in semantic mode (part-of = thing
colour, leads-to = event colour, `ipmArrow.*`); only the TextMate grammar has the
single arrow colour (`#404040` light, `#d4d4d4` dark). The test expects exactly
that. The aliased title `x::a "long title" ::t` has its own lighter colour; only
"not the string colour" is asserted for it.

The preview is found through `page.frames()`: the webview content is reachable.
A preview that does not appear within 25 s is a failed row, not a skip.

## Known finding

The quote characters are declared as `brackets` in the extension's
`language-configuration.json`, so VS Code's bracket-pair colourisation (on by
default) paints them `#ff1212` (the unexpected-bracket colour) in the editor, over
the node colour. With `COLOURS_SETTINGS` turning bracket-pair colourisation off
all three runs pass.
