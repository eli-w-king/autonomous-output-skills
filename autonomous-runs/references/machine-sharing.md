# Sharing a machine with other agents

Read before launching or driving any window on a machine where other agents also work.

---

## Sharing the Mac with other agents: off-screen windows, input guards, shared state

- **Install an invisible-instance guard at the actual Electron main entry, not Node's first
  bootstrap pause.** With `--inspect-brk`, an early `require('electron')` can fail during bootstrap.
  Set `Debugger.setBreakpointByUrl` on `Resources/app/out/main.js`, resume bootstrap, then patch
  `BrowserWindow.show` to `showInactive`, opacity 0, non-focusable and ignored mouse events before
  any window opens. Also no-op `focus`, hide only that process's dock icon, and disable background
  throttling. Separate profile, extensions and inspector/CDP ports are mandatory; verify the
  inspector's `process.pid` before exiting an owned instance. Renderer CDP captures remain real.
- **Preserve quick-input provider prefixes.** Filling a command-palette field with a command name
  alone removes `> ` and silently becomes file search. Debug launch pickers similarly need
  `debug `. Match the exact observed `.label-name` row rather than pressing Enter on a fuzzy
  recent-command match. Multi-root Quick Open often needs the path relative to a root, without
  the `repo/src/` prefix. Monaco search controls may be `.native-edit-context`, not HTML inputs.
- **A "spare display" is not safe.** Another agent later opened its own Code OSS window in the same spot, and
  both of our windows were closed (a stray Cmd+W or click landed on them). Keep demo windows past the right
  edge of the last display: from the main inspector, hook `app.on('browser-window-created')` and
  `setBounds()` each new window off-screen. macOS keeps about 40 px visible, and `screencapture -l` still
  returns the full 3104x2024 frame.
- **Attach before the first window shows.** Parse `--inspect=<port>` from `launch.sh` stderr, install the hooks
  (about 1.5 s after launch), and for the first 45 s give focus straight back to the previously front app
  whenever the new instance activates itself.
- **Guard keys in the main process.** `webContents.on('before-input-event')` plus `preventDefault()` blocks page
  keys and menu shortcuts. Always swallow Cmd+Q/W/M/H unless the driver sets an allow flag, and swallow
  everything while briefly holding focus for a capture. Activate only after 3 s of HID idle
  (`ioreg -c IOHIDSystem`, `HIDIdleTime`).
- **Some state escapes `--user-data-dir`.** Agent plugins install into `~/.vscode-oss-dev/agent-plugins`
  (shared by every Code OSS dev instance), Copilot CLI plugins in `~/.copilot/installed-plugins` are listed
  too, and agent-host sessions land in the real `~/.copilot/session-state` unless `COPILOT_HOME` is set at
  launch. Uninstall demo plugins right after capture and delete only folders you created.
