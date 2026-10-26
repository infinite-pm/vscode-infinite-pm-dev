# Demo recording for the vscode-infinite-pm extension.
# Everything runs inside a podman container -- nothing is installed on the host.

IMAGE     ?= ipm-vscode-demo
EXT_REPO  ?= $(abspath $(CURDIR)/../vscode-infinite-pm)
TOOLS_REPO ?= $(abspath $(CURDIR)/../ipm-tools)
# Where the examples come from, recorded in the provenance.
DRAWIO_REPO ?= $(abspath $(CURDIR)/../ipm-drawio)
# Where rendered assets are published for other repositories to link to.
ASSETS_REPO ?= $(abspath $(CURDIR)/../vscode-infinite-pm-demo)
# Absolute base for the MP4 README: GitHub will not play a <video> from a
# repository-relative path, so those players need real URLs.
ASSETS_URL ?= https://raw.githubusercontent.com/infinite-pm/vscode-infinite-pm-demo/main

DEMO := $(abspath $(CURDIR)/demo)
OUT  := $(abspath $(CURDIR)/out)

# Newest .vsix in the extension repo, by build time rather than by version
# string: a just-rebuilt 0.4.1 must win over a stale 0.4.2 lying next to it.
VSIX := $(shell ls -t $(EXT_REPO)/*.vsix 2>/dev/null | head -1)

# Virtual display / master video geometry. The GIF is downscaled from this.
WIDTH  ?= 1600
HEIGHT ?= 900
FPS    ?= 25
# VS Code window zoom: 1.2x per step, applied to the whole workbench.
ZOOM   ?= 1

# Scene ids to record; empty means all of them.
SCENES ?=
# Multiplies every beat()/typing delay in a scene: 0.5 = twice as fast.
SPEED  ?= 1

# --userns=keep-id: the container process is the host user, not root. Root would
# put "[Superuser]" in VS Code's title bar -- on screen, in every frame.
# demo/ goes in read-only: the container has no business writing to the scene
# sources, and a scene once did exactly that (see initGitRepo in profile.ts).
# --memory: a hard ceiling on the recording container. Three laptop freezes in
# two days were machine-wide OOMs; a runaway VS Code + Chromium + ffmpeg inside
# the container should die at its own limit, not take the host down. A full
# recording run peaks around 2-3G; 6G is generous. --memory-swap equal to
# --memory means no swap for the container, so it dies fast instead of dragging
# the host into swap first.
MEM ?= 6g
PODMAN_RUN = podman run --rm --shm-size=1g --userns=keep-id --memory=$(MEM) --memory-swap=$(MEM) \
	-v "$(DEMO)":/work/demo:ro,z \
	-v "$(OUT)":/work/out:z \
	-e DEMO_WIDTH=$(WIDTH) -e DEMO_HEIGHT=$(HEIGHT) -e DEMO_FPS=$(FPS) \
	-e DEMO_SPEED=$(SPEED) -e DEMO_ZOOM=$(ZOOM) -e DEMO_ASSETS_URL="$(ASSETS_URL)" \
	-e DEMO_STATES="$(DEMO_STATES)" -e DEMO_IPM_RPC="$(DEMO_IPM_RPC)" \
	-e IPM_TEE_REAL="$(IPM_TEE_REAL)" -e IPM_TEE_OUT="$(IPM_TEE_OUT)" \
	--entrypoint /work/out/demo-entrypoint

.PHONY: help
help:
	@echo "Demo recording (podman, nothing installed on the host):"
	@echo "  image        - build the container image (VS Code is downloaded into it)"
	@echo "  demo         - record every scene   (SCENES=\"a b\" to pick, SPEED=0.7 to speed up)"
	@echo "  e2e          - run the extension's extension-host suite headlessly"
	@echo "  states       - drive the scenes with NO camera and capture every typed"
	@echo "                 diagram state into $(STATES_CORPUS) (SCENES=\"a b\" to pick)"
	@echo "  list         - list available scenes"
	@echo "  shell        - interactive shell in the image"
	@echo "  clean        - remove out/"
	@echo ""
	@echo "Current settings:"
	@echo "  IMAGE=$(IMAGE)  WIDTH=$(WIDTH) HEIGHT=$(HEIGHT) FPS=$(FPS) ZOOM=$(ZOOM)"
	@echo "  VSIX=$(VSIX)"

.PHONY: image
image:
	podman build -f demo/Containerfile -t $(IMAGE) .

# The .vsix under test is copied into out/ so the container needs no mount
# outside this repository.
.PHONY: vsix
vsix:
ifeq ($(VSIX),)
	@echo "No .vsix found in $(EXT_REPO) -- run 'npm run package' there first." >&2
	@exit 1
endif
	@mkdir -p "$(OUT)"
	cp -f "$(VSIX)" "$(OUT)/ext.vsix"
	@echo "using $(VSIX)"
	@stale=$$(find "$(EXT_REPO)/src" "$(EXT_REPO)/package.json" -newer "$(VSIX)" 2>/dev/null | head -1); \
	if [ -n "$$stale" ]; then \
		echo "warning: $(EXT_REPO) has sources newer than $(notdir $(VSIX)) ($$stale)"; \
		echo "warning: the recording would show the previous build -- run 'make ext' first"; \
	fi

# Rebuild the extension from source. Not a dependency of `demo`: a webpack
# production build on every recording iteration is a cost you did not ask for,
# and `vsix` warns when the build is behind the source anyway.
.PHONY: ext
ext:
	cd "$(EXT_REPO)" && npm run package

# The language server. A locally built .vsix carries no ipm-rpc (only CI's
# target-qualified builds do), and the extension then falls back to
# ipm.serverPath -- which is what the scene profiles point here. CGO_ENABLED=0
# because the host's glibc is newer than the image's.
.PHONY: rpc
rpc:
	@mkdir -p "$(OUT)"
	cd "$(TOOLS_REPO)" && CGO_ENABLED=0 go build -trimpath -o "$(OUT)/ipm-rpc" ./cmd/ipm-rpc

# The extension's extension-host suite (npm run test:e2e), headless, in the
# recording image -- so it can be run before a push on a machine with no X
# server, and without VS Code windows appearing over whatever you are doing.
# CI runs the same suite under xvfb; this is the local equivalent.
#
#   make e2e                        # all of it
#   make e2e E2E_ARGS="--label e2e" # pass flags through to vscode-test
E2E_ARGS ?=
.PHONY: e2e
e2e: ext-rpc
	podman run --rm --shm-size=1g --userns=keep-id --memory=$(MEM) --memory-swap=$(MEM) \
		-v "$(EXT_REPO)":/work/ext:z \
		-v "$(TOOLS_REPO)":/work/ipm-tools:ro,z \
		-v "$(DEMO)":/work/demo:ro,z \
		--entrypoint bash $(IMAGE) /work/demo/bin/run-e2e.sh $(E2E_ARGS)

# The suite uses the bundled server exactly as a user's install would --
# no ipm.serverPath -- so the extension repo needs one at the path
# resolveServer looks in. bin/<GOOS>-<GOARCH>, not the vsce target name:
# serverPath.ts maps process.arch x64 -> amd64. CI builds it the same way.
.PHONY: ext-rpc
ext-rpc:
	@mkdir -p "$(EXT_REPO)/bin/linux-amd64"
	cd "$(TOOLS_REPO)" && CGO_ENABLED=0 go build -trimpath -o "$(EXT_REPO)/bin/linux-amd64/ipm-rpc" ./cmd/ipm-rpc

# Re-embed the fixtures that ship already embedded. One --in per file, never a
# --root walk: embed-on-save's answer.md must stay un-embedded, since that scene
# exists to show the marker and the SVG being created.
.PHONY: fixtures
fixtures:
	cd "$(TOOLS_REPO)" && go run ./cmd/md-embed \
		--root "$(DEMO)/workspaces/md-live-refresh" \
		--in "$(DEMO)/workspaces/md-live-refresh/life.md"
	cd "$(TOOLS_REPO)" && go run ./cmd/md-embed \
		--root "$(DEMO)/workspaces/include-refresh" \
		--in "$(DEMO)/workspaces/include-refresh/page.md"

# What produced these assets: the commit of every repo that fed the render, and
# whether its tree was dirty. Runs on the host because the container cannot see
# the sibling checkouts -- it mounts demo/ read-only and out/, nothing else.
.PHONY: provenance
provenance:
	@mkdir -p "$(OUT)"
	@go run ./cmd-dev/provenance --out "$(OUT)" --ext "$(EXT_REPO)" \
		--tools "$(TOOLS_REPO)" --examples "$(DRAWIO_REPO)"

# The container entrypoint, built here rather than baked into the image so the
# image holds only what rarely changes -- the same arrangement as ipm-rpc.
.PHONY: entrypoint
entrypoint:
	@mkdir -p "$(OUT)"
	CGO_ENABLED=0 go build -trimpath -o "$(OUT)/demo-entrypoint" ./cmd-dev/entrypoint

.PHONY: demo
demo: vsix rpc entrypoint provenance
	$(PODMAN_RUN) $(IMAGE) $(SCENES)

# ---------------------------------------------------------------------------
# States: the same scenes, driven to CAPTURE what they type rather than to film
# it. See docs/states-corpus.md.
#
# Every keystroke reaches the language server as a full buffer (sync=Full), so
# the states the scenes type are already on that wire; ipm-rpc-tee sits in
# front of the real server and writes them down. Nothing changes in the
# extension, and nothing dev-only ships: the tee is a separate binary the
# recording points DEMO_IPM_RPC at.
#
# A capture run writes no video, no gif and no stills, so it can never be
# mistaken for -- or overwrite -- a publishable take.
#
#   make states                    # every scene
#   make states SCENES=ipmt-preview
#   make states-curate             # re-curate an existing raw capture
STATES_RAW     ?= $(OUT)/states-raw
STATES_CORPUS  ?= $(DEMO)/states

.PHONY: tee
tee:
	@mkdir -p "$(OUT)"
	cd "$(TOOLS_REPO)" && CGO_ENABLED=0 go build -trimpath -o "$(OUT)/ipm-rpc-tee" ./cmd-dev/ipm-rpc-tee

.PHONY: states
states: vsix rpc tee entrypoint
	@rm -rf "$(STATES_RAW)" && mkdir -p "$(STATES_RAW)"
	$(MAKE) states-run
	$(MAKE) states-curate

# The scenes, camera off, server proxied. In-container paths: /work/out is the
# bind mount of $(OUT), and DEMO_IPM_RPC is what the profile writes into
# ipm.serverPath -- so the extension launches the tee, and the tee launches the
# server named by IPM_TEE_REAL.
.PHONY: states-run
states-run:
	$(MAKE) demo-container \
		DEMO_STATES=1 \
		DEMO_IPM_RPC=/work/out/ipm-rpc-tee \
		IPM_TEE_REAL=/work/out/ipm-rpc \
		IPM_TEE_OUT=/work/out/states-raw

.PHONY: demo-container
demo-container:
	$(PODMAN_RUN) $(IMAGE) $(SCENES)

# Raw capture -> committed corpus: content-addressed .ipmt per state, a
# manifest in typing order, and signatures.txt (the tripwire: regenerate after
# an engine change and the diff names every state whose layout moved).
.PHONY: states-curate
states-curate:
	cd "$(TOOLS_REPO)" && go run ./cmd-dev/states-curate \
		--in "$(STATES_RAW)" --out "$(STATES_CORPUS)"

# Copy the rendered assets into the assets repository, which is the thing other
# repositories link to. Nothing is committed here: what lands is for a human to
# read and commit, and the provenance file says what produced it.
.PHONY: publish
publish:
	@test -d "$(ASSETS_REPO)" || { echo "no assets repo at $(ASSETS_REPO) -- set ASSETS_REPO=" >&2; exit 1; }
	@test -f "$(OUT)/README.md" || { echo "nothing rendered yet -- run 'make demo' first" >&2; exit 1; }
# A scene that failed leaves a partial mp4 and a FAILURE still next to the good
# ones from the last run, and this target copies the directory wholesale. Refuse
# rather than publish a mixture nobody can tell apart. ALLOW_PARTIAL=1 to
# override deliberately -- e.g. republishing prose changes while one scene is
# known-broken.
ifndef ALLOW_PARTIAL
	@test ! -f "$(OUT)/FAILED" || { \
		echo "refusing to publish: these scenes failed in the last run:" >&2; \
		sed 's/^/  /' "$(OUT)/FAILED" >&2; \
		echo "re-record them, or set ALLOW_PARTIAL=1 if you mean it." >&2; exit 1; }
endif
	mkdir -p "$(ASSETS_REPO)/video" "$(ASSETS_REPO)/stills"
	rsync -a --delete "$(OUT)/video/" "$(ASSETS_REPO)/video/"
	rsync -a --delete "$(OUT)/stills/" "$(ASSETS_REPO)/stills/"
	cp -f "$(OUT)/README.md" "$(ASSETS_REPO)/README.md"
	cp -f "$(OUT)/README-mp4.md" "$(ASSETS_REPO)/README-mp4.md"
	cp -f "$(OUT)/provenance.json" "$(ASSETS_REPO)/provenance.json"
	@echo "published into $(ASSETS_REPO) -- review and commit there"

# Carry the featured GIFs from the assets repository into the extension README.
.PHONY: dist
dist:
	go run ./cmd-dev/assets-dist --assets "$(ASSETS_REPO)" --ext "$(EXT_REPO)"

.PHONY: dist-check
dist-check:
	go run ./cmd-dev/assets-dist --assets "$(ASSETS_REPO)" --ext "$(EXT_REPO)" --check

# Regenerate the published READMEs from the reports already on disk -- for when
# the wording around the recordings changes and the recordings have not.
.PHONY: index
index:
	@$(PODMAN_RUN) $(IMAGE) --index

.PHONY: list
list:
	@mkdir -p "$(OUT)"
	@$(PODMAN_RUN) $(IMAGE) --list

.PHONY: shell
shell:
	@mkdir -p "$(OUT)"
	podman run --rm -it --shm-size=1g --userns=keep-id \
		-v "$(DEMO)":/work/demo:z \
		-v "$(OUT)":/work/out:z \
		--entrypoint bash $(IMAGE)

.PHONY: clean
clean:
	rm -rf "$(OUT)"

# Rendered-colour test: the real VS Code, the .vsix under test and a freshly
# built ipm-rpc, colours read from the DOM. See docs/colours-e2e.md.
#
#   make colours-e2e EXT_REPO=... TOOLS_REPO=... IMAGE=ipm-vscode-demo-new
#   make colours-e2e VSIX=/path/to/other.vsix   # e.g. the previous release
COLOURS_RUNS ?=
COLOURS_SETTINGS ?=
.PHONY: colours-e2e
colours-e2e: vsix rpc
	podman run --rm --shm-size=1g --userns=keep-id --memory=$(MEM) --memory-swap=$(MEM) \
		-v "$(DEMO)":/work/demo:ro,z \
		-v "$(OUT)":/work/out:z \
		-e DEMO_IPM_RPC=/work/out/ipm-rpc -e COLOURS_SETTINGS='$(COLOURS_SETTINGS)' \
		--entrypoint bash $(IMAGE) /work/demo/bin/run-colours.sh $(COLOURS_RUNS)
