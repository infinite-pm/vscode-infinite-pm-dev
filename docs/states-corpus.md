# states — the scenes as a layout corpus

`make states` drives the same scenes as `make demo`, with the camera off, and
keeps **every diagram state they type** instead of a video.

```bash
make states                      # every scene
make states SCENES=ipmt-preview  # one
make states-curate               # re-curate the existing raw capture
```

Result: [`demo/states/<scene>/`](../demo/states/) — committed, and the input to
the layout engine's regression tooling in the sibling `ipm-tools` checkout.

## What it is for

The scenes type real ipmt into real VS Code. Every keystroke is a diagram the
layout engine either did lay out or would if asked — and a diagram
*mid-construction* is exactly what ipm-tools' own corpora cannot contain: a
fixture there is authored to pin a rule, so it is always a finished document.

The first capture of `ipmt-preview` produced 88 states that lay out and 5 the
parser rejects, from a graph of 9 to 14 nodes. One of them is the document with
`Ea` on its last line — "Earth", two characters in.

## How it works

Every keystroke reaches the language server as a **complete buffer** (the
server advertises sync=Full), so the states are already on that wire.
`ipm-rpc-tee` — built from the sibling `ipm-tools` — sits in front of the real
server and writes them down:

```
VS Code ──► out/ipm-rpc-tee ──► out/ipm-rpc
                  │
                  └──► out/states-raw/session-<pid>.jsonl ──► demo/states/
```

Nothing in the extension changes, and nothing dev-only ships: the recording
already redirects the server through `DEMO_IPM_RPC`, and the Makefile points
that at the tee.

Two things a states run does differently from a take:

- **No camera.** No ffmpeg, no GIF, no stills, no reports, no provenance — so a
  capture cannot be mistaken for, or quietly overwrite, a publishable
  recording. `out/video` and `out/stills` are never touched.
- **`ipm.liveRefreshDebounceMs: 0`**, which the extension documents and unit
  tests as "render on every change". The engine then really lays out every
  keystroke, so the capture records states that were RENDERED rather than
  merely passed through. A take keeps the shipped 150 ms, because that is what
  a viewer gets.

Scene attribution needs no plumbing: each scene runs in its own workspace
(`out/workspaces/<scene>/`), so the URI on every captured line already says
which scene it came from.

## What lands in git

Per scene, under `demo/states/<scene>/`:

| file | |
|---|---|
| `<hash>.ipmt` | one state, named by the hash of its own source |
| `invalid/<hash>.ipmt` | a state the parser rejects — a half-typed line is a real state, kept with the reason in the manifest |
| `signatures.txt` | state hash → layout hash, nodes, edges, bounds |
| `manifest.json` | typing order, cadence, source file or markdown block, errors |

Content-addressed on purpose: a re-capture that types the same thing produces
the same filenames and **no diff**, so a `git diff` shows a real change rather
than the fact that a recording was re-run. Timestamps stay in the raw capture
(`out/`, gitignored) and never reach the corpus.

States whose layout is identical to one already kept are dropped — typing a
label one character at a time changes the graph but not the picture. `--all`
on `states-curate` keeps everything.

Re-captures are a **generated** commit of their own, never mixed with
hand-written changes.

## Running regressions over it

From the `ipm-tools` checkout — full detail in its
`docs/dev-tools/states-corpus.md`:

```bash
# 1. the tripwire: regenerate, and the diff names every state that moved
cd ../vscode-infinite-pm-dev && make states-curate && git diff demo/states

# 2. the universal invariants, same check the fixture corpora ratchet on
go run ./cmd-dev/layout-debug --check --totals ../vscode-infinite-pm-dev/demo/states/ipmt-preview

# 3. what changed and how it looks, old engine beside new
go run ./cmd-dev/layout-audit --old <ref> ../vscode-infinite-pm-dev/demo/states/ipmt-preview
```

## What it is not

Not a fitness catalogue. A fixture in ipm-tools pins a rule; a captured state
pins nothing — it is evidence. When one exposes a real bug it gets reduced to
an abstract twin and pinned there as a proper case, and the captured state goes
back to being an ordinary member of the sweep.

And it is narrow: 88 states of essentially one graph. Deep in state-space,
narrow in model-space — a good source of transitional diagrams, a poor source
of diverse ones. Adding scenes for coverage would work against the demo's own
rule that every graph in it is one of ours, used verbatim.
