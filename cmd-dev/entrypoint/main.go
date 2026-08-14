// Command entrypoint brings up a virtual display inside the recording
// container, then runs the scene recorder under it.
//
// Xvfb is started directly rather than through xvfb-run: xvfb-run waits for the
// server's SIGUSR1 readiness signal, which never lands when it runs as PID 1 in
// a container, so it hangs forever before ever starting the command. Polling
// xdpyinfo is both reliable and gives us a fixed display number that ffmpeg's
// x11grab can be pointed at.
//
// Built on the host (CGO_ENABLED=0, into out/) and run from the mount rather
// than baked into the image, the same way the ipm-rpc under test is: the image
// then holds only things that rarely change.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"
)

func main() {
	width := env("DEMO_WIDTH", "1600")
	height := env("DEMO_HEIGHT", "900")
	display := env("DEMO_DISPLAY", ":99")

	if err := os.MkdirAll("/work/out", 0o755); err != nil {
		fatal(err)
	}
	// Xvfb's xkbcomp keysym warnings are pure noise; keep them out of the run
	// log but on disk in case a display problem needs diagnosing.
	logFile, err := os.Create(filepath.Join("/work/out", "xvfb.log"))
	if err != nil {
		fatal(err)
	}
	defer logFile.Close()

	xvfb := exec.Command("Xvfb", display, "-screen", "0",
		fmt.Sprintf("%sx%sx24", width, height), "-nolisten", "tcp", "-noreset")
	xvfb.Stdout, xvfb.Stderr = logFile, logFile
	if err := xvfb.Start(); err != nil {
		fatal(fmt.Errorf("starting Xvfb: %w", err))
	}
	defer func() {
		_ = xvfb.Process.Kill()
		_, _ = xvfb.Process.Wait()
	}()

	if err := waitForDisplay(display, 10*time.Second); err != nil {
		fatal(err)
	}

	run := exec.Command("/node_modules/.bin/tsx", append([]string{"/work/demo/src/run.ts"}, os.Args[1:]...)...)
	run.Stdout, run.Stderr, run.Stdin = os.Stdout, os.Stderr, os.Stdin
	run.Env = append(os.Environ(), "DISPLAY="+display)
	if err := run.Run(); err != nil {
		var exit *exec.ExitError
		if ok := asExitError(err, &exit); ok {
			os.Exit(exit.ExitCode())
		}
		fatal(err)
	}
}

// waitForDisplay polls until the X server answers, which is the only reliable
// signal that it is ready to be drawn on.
func waitForDisplay(display string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if exec.Command("xdpyinfo", "-display", display).Run() == nil {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("Xvfb did not come up on %s within %s", display, timeout)
}

func asExitError(err error, target **exec.ExitError) bool {
	exit, ok := err.(*exec.ExitError)
	if ok {
		*target = exit
	}
	return ok
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		if _, err := strconv.Atoi(value); err == nil || name == "DEMO_DISPLAY" {
			return value
		}
	}
	return fallback
}

func fatal(err error) {
	fmt.Fprintf(os.Stderr, "entrypoint: %v\n", err)
	os.Exit(1)
}
