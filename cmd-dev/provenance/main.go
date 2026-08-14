// Command provenance collects what the host knows about a render, before the
// recording container starts.
//
// Everything here needs the sibling checkouts and their .git directories, which
// the container deliberately cannot see — it mounts demo/ read-only and out/,
// nothing else. So the host writes what git knows, the run adds the versions
// only the container can report (VS Code, ipm-rpc), and the two are merged into
// out/provenance.json.
//
// Dirty is recorded, never hidden. An asset rendered from a working tree with
// uncommitted changes cannot be reproduced from its commit alone, and the page
// that ships it should say so.
//
//	go run ./cmd-dev/provenance --out out --ext ../vscode-infinite-pm \
//	    --tools ../ipm-tools --examples ../ipm-drawio
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// RepoState is one checkout at render time.
//
// Named and (where it has one) pointed at its remote, never at its path on
// disk: this file is published, and where someone's checkout happens to live is
// both meaningless to a reader and nobody else's business.
type RepoState struct {
	Name       string `json:"name"`
	Remote     string `json:"remote,omitempty"`
	Available  bool   `json:"available"`
	Commit     string `json:"commit,omitempty"`
	Short      string `json:"short,omitempty"`
	Subject    string `json:"subject,omitempty"`
	Committed  string `json:"committed,omitempty"`
	Branch     string `json:"branch,omitempty"`
	Dirty      bool   `json:"dirty"`
	DirtyFiles int    `json:"dirtyFiles"`
}

// VsixInfo is the extension build that was recorded, with the evidence that it
// matches the commit recorded beside it: "extension at commit X" is only true
// if the build postdates X's sources.
type VsixInfo struct {
	Available      bool   `json:"available"`
	Name           string `json:"name,omitempty"`
	Bytes          int64  `json:"bytes,omitempty"`
	SHA256         string `json:"sha256,omitempty"`
	BuiltAt        string `json:"builtAt,omitempty"`
	NewestSourceAt string `json:"newestSourceAt,omitempty"`
	BuildIsCurrent bool   `json:"buildIsCurrent"`
}

type extension struct {
	Name      string    `json:"name,omitempty"`
	Version   string    `json:"version,omitempty"`
	Publisher string    `json:"publisher,omitempty"`
	Repo      RepoState `json:"repo"`
	Vsix      VsixInfo  `json:"vsix"`
}

type provenance struct {
	RenderedAt string    `json:"renderedAt"`
	Extension  extension `json:"extension"`
	IpmTools   RepoState `json:"ipmTools"`
	Examples   RepoState `json:"examples"`
	Harness    RepoState `json:"harness"`
}

func main() {
	out := flag.String("out", "out", "output directory (also the harness repo's out/)")
	ext := flag.String("ext", "../vscode-infinite-pm", "extension repository")
	tools := flag.String("tools", "../ipm-tools", "ipm-tools repository")
	examples := flag.String("examples", "../ipm-drawio", "repository the example graphs come from")
	flag.Parse()

	outDir, err := filepath.Abs(*out)
	if err != nil {
		fatal(err)
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		fatal(err)
	}

	extDir := abs(*ext)
	p := provenance{
		RenderedAt: time.Now().UTC().Format(time.RFC3339),
		Extension: extension{
			Repo: repoState(extDir),
			Vsix: vsixInfo(outDir, extDir),
		},
		IpmTools: repoState(abs(*tools)),
		Examples: repoState(abs(*examples)),
		Harness:  repoState(filepath.Dir(outDir)),
	}
	p.Extension.Name, p.Extension.Version, p.Extension.Publisher = extensionVersion(extDir)

	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outDir, "provenance.host.json"), append(data, '\n'), 0o644); err != nil {
		fatal(err)
	}

	var dirty []string
	for _, r := range []struct {
		name  string
		state RepoState
	}{
		{"extension", p.Extension.Repo},
		{"ipm-tools", p.IpmTools},
		{"examples", p.Examples},
		{"harness", p.Harness},
	} {
		if r.state.Dirty {
			dirty = append(dirty, r.name)
		}
	}
	state := "all clean"
	if len(dirty) > 0 {
		state = "DIRTY: " + strings.Join(dirty, ", ")
	}
	fmt.Printf("provenance: extension %s, ipm-tools %s -- %s\n",
		orQuestion(p.Extension.Repo.Short), orQuestion(p.IpmTools.Short), state)
}

func repoState(dir string) RepoState {
	state := RepoState{Name: filepath.Base(dir)}
	if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
		return state
	}
	state.Available = true
	state.Remote = remoteURL(dir)
	state.Commit = git(dir, "rev-parse", "HEAD")
	state.Short = git(dir, "rev-parse", "--short", "HEAD")
	state.Subject = git(dir, "log", "-1", "--format=%s")
	state.Committed = git(dir, "log", "-1", "--format=%cI")
	state.Branch = git(dir, "rev-parse", "--abbrev-ref", "HEAD")
	if status := git(dir, "status", "--porcelain"); status != "" {
		state.Dirty = true
		state.DirtyFiles = len(strings.Split(status, "\n"))
	}
	return state
}

func vsixInfo(outDir, extDir string) VsixInfo {
	file := filepath.Join(outDir, "ext.vsix")
	info, err := os.Stat(file)
	if err != nil {
		return VsixInfo{}
	}
	bytes, err := os.ReadFile(file)
	if err != nil {
		return VsixInfo{}
	}
	sum := sha256.Sum256(bytes)
	v := VsixInfo{
		Available: true,
		Name:      filepath.Base(file),
		Bytes:     info.Size(),
		SHA256:    hex.EncodeToString(sum[:]),
		BuiltAt:   info.ModTime().UTC().Format(time.RFC3339),
	}
	if newest, ok := newestSource(extDir); ok {
		v.NewestSourceAt = newest.UTC().Format(time.RFC3339)
		v.BuildIsCurrent = !info.ModTime().Before(newest)
	}
	return v
}

// newestSource is the last time anything the build reads was touched.
func newestSource(extDir string) (time.Time, bool) {
	var newest time.Time
	seen := false
	for _, target := range []string{filepath.Join(extDir, "src"), filepath.Join(extDir, "package.json")} {
		_ = filepath.WalkDir(target, func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil //nolint:nilerr // a missing tree is not fatal here
			}
			info, err := d.Info()
			if err != nil {
				return nil
			}
			if info.ModTime().After(newest) {
				newest, seen = info.ModTime(), true
			}
			return nil
		})
	}
	return newest, seen
}

func extensionVersion(extDir string) (name, version, publisher string) {
	data, err := os.ReadFile(filepath.Join(extDir, "package.json"))
	if err != nil {
		return "", "", ""
	}
	var pkg struct {
		Name      string `json:"name"`
		Version   string `json:"version"`
		Publisher string `json:"publisher"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return "", "", ""
	}
	return pkg.Name, pkg.Version, pkg.Publisher
}

// remoteURL is origin as a browsable https URL, so the record points at the
// project rather than at a checkout. Empty when there is no remote yet.
func remoteURL(dir string) string {
	url := git(dir, "remote", "get-url", "origin")
	if url == "" {
		return ""
	}
	if rest, ok := strings.CutPrefix(url, "git@"); ok {
		// git@github.com:owner/repo.git -> https://github.com/owner/repo
		host, path, found := strings.Cut(rest, ":")
		if found {
			url = "https://" + host + "/" + path
		}
	}
	return strings.TrimSuffix(url, ".git")
}

func git(dir string, args ...string) string {
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func abs(path string) string {
	resolved, err := filepath.Abs(path)
	if err != nil {
		return path
	}
	return resolved
}

func orQuestion(s string) string {
	if s == "" {
		return "?"
	}
	return s
}

func fatal(err error) {
	fmt.Fprintf(os.Stderr, "provenance: %v\n", err)
	os.Exit(2)
}
