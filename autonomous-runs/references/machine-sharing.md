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
- **Native prompts take focus even from an invisible instance.** Code OSS's protocol-link confirmation
  ("An external application wants to open...") is an app-modal alert with no parent window. macOS activates
  the app to show it, and the user's next Return answers it. Set
  `security.promptForLocalFileProtocolHandling: false` for every take that doesn't film it, and film it only
  after 300+ s of HID idle. A launch activates the app too, because Electron shows a window as it creates it,
  before a `browser-window-created` patch runs. Treat every launch, and the first Agents window, as an
  activating step.
- **Log the front app, and restore it around activating steps.** Read it with `lsappinfo front` and
  `lsappinfo info -only bundleid <asn>`. Restore it with `osascript -e 'tell application id "<bid>" to activate'`,
  but skip the restore when the saved app has no bundle ID (an MDM `osascript` dialog). A one-second poller
  that logs every front-app change with HID idle names the culprit in seconds. Have it flag Code OSS,
  Terminal or SecurityAgent coming forward while the user is active.
- **IT dialogs belong to the user.** MDM agents (Intune, for example) open `osascript display dialog` prompts
  at any hour, and they come to the front. Never answer, move or close them; mention them in the morning
  report.
- **Overnight wake lock.** Hold `caffeinate -dims` around a loop that exits when a done-file appears, with a
  hard cap, so displays stay awake for capture until the run ends. While display sleep is prevented,
  loginwindow skips the screen saver ("PMNoDisplaySleepEnabled so do not launch screen saver"), so an MDM
  screen-saver lock doesn't start. Ask the user to leave the lid open and the screen unlocked.
- **Check Apple Events consent without a prompt.** Driving Terminal over AppleScript (VS Code's external
  terminal) needs Automation consent for the app that starts `osascript`. A small Swift tool can check it
  without ever showing a dialog. It calls
  `AEDeterminePermissionToAutomateTarget(addr, typeWildCard, typeWildCard, false)` and must run as a child of
  that app; for Electron, start it from the main process over the inspector with
  `process.getBuiltinModule('child_process').execFileSync(...)`. It prints 0 (granted), -1744 (would
  prompt), -1743 (denied) or -600 (not running).
- **Stop orphaned second instances.** Link openers that run `code.sh --open-url` can leave extra Code OSS
  processes on your profile (ppid 1, ignoring SIGTERM). Find them by `--user-data-dir` at cleanup and stop
  them by pid.
