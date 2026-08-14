# cmd-dev tools

Go microtools for the demo harness. Everything that can be Go is Go; the one
exception is documented below.

## provenance

What produced a render: the commit, subject and dirty state of every repository
that fed it (extension, ipm-tools, the examples, this harness), the extension
version, and the `.vsix` hash with the evidence that the build postdates its
sources. Writes `out/provenance.host.json`, which the run merges with the
versions only the container can report.

Runs on the host because the container cannot see the sibling checkouts — it
mounts `demo/` read-only and `out/`, nothing else.

```bash
go run ./cmd-dev/provenance --out out --ext ../vscode-infinite-pm \
    --tools ../ipm-tools --examples ../ipm-drawio
```

## assets-dist

Carries the featured GIFs from the assets repository into the extension's
`media/demo/` and rewrites a marked section of its README. Shaped after
`ipm-drawio/cmd-dev/logo-dist`: an explicit per-target list of what that target
actually asks for, copied never drawn, reported rather than assumed, and
refusing to guess where to splice when the markers are missing.

```bash
go run ./cmd-dev/assets-dist            # update + report
go run ./cmd-dev/assets-dist --check    # exit 1 if the extension is stale
```

## entrypoint

The container's PID 1: brings up Xvfb, waits for the display to answer, and runs
the recorder under it. Built on the host into `out/` and mounted, the same way
the `ipm-rpc` under test is, so changing it does not mean rebuilding the image.

Not `xvfb-run`: that waits for the X server's SIGUSR1 readiness signal, which
never lands when it runs as PID 1 in a container, so it hangs before ever
starting the command.

## Why the recorder itself is TypeScript

`demo/src/` drives real VS Code through Playwright, and Playwright's Electron
support exists only for Node — there is no Go binding that can launch an Electron
app and speak CDP to its workbench. Driving Chrome DevTools Protocol from Go by
hand would replace a supported dependency with a fragile reimplementation of it.
So the recorder stays TypeScript, and everything around it — provenance,
distribution, the entrypoint — is Go.
