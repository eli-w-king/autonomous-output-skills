---
name: automation-windows-os
description: "Automation: Windows OS. Run autonomous build, launch, interaction, validation, and demo workflows on Windows, either directly or through a Windows VM in UTM. Use when another skill needs optional Windows-specific execution, native UI automation, screenshots or video, build provenance checks, or reversible guest modification."
---

# Automation: Windows OS

Use this skill as the Windows platform adapter for a larger autonomous workflow. The calling skill owns the product goal: research, design, implementation, performance investigation, bug verification, or demo creation. This skill owns the reliable execution of that goal on Windows.

Examples:

- An autonomous design/build skill implements a new VS Code UI, then invokes this workflow to test it on Windows.
- A PR-verification workflow needs to reproduce Windows-only behavior and capture evidence.
- A performance workflow needs to run a repeatable scenario in a Windows build.
- A user asks the agent to operate an existing Windows application in a UTM VM without taking over the macOS pointer.

## Operating Principles

1. **Use the least fragile control surface.** Prefer commands and application APIs over UI interaction. Prefer semantic UI automation over coordinates.
2. **Prove the tested build.** Record the executable version and commit before interpreting results.
3. **Keep human input independent.** For UTM, do not rely on the host mouse when the user may also be using it.
4. **Make test state explicit.** Record settings, theme, window state, scaling, and expected completion signals.
5. **Verify outcomes, not actions.** A click being sent is not evidence that the requested operation completed.
6. **Make all guest changes reversible.** Back up modified files, settings, and state; restore them and verify hashes.
7. **Leave evidence.** A successful autonomous run produces logs, screenshots, machine-readable results, and optionally a video.

## Compose With Other Skills

This skill does not replace feature-area or product-development skills.

When building or changing VS Code UI, also use the relevant skills:

- `accessibility`
- `ux-css-layout`
- `ux-theming`
- `component-fixtures`
- `sessions` for the Agents window
- `hygiene`
- `unit-tests`, `integration-tests`, or `smoke-tests`

The product skill should:

1. define the behavior and test matrix;
2. implement and validate the source change;
3. provide a Windows build or artifact;
4. hand the executable scenario to this skill;
5. consume the evidence and decide whether to iterate.

This skill should:

1. establish the Windows transport;
2. deploy and launch the intended build;
3. drive Windows-specific states;
4. capture and validate evidence;
5. restore the environment.

## Choose the Windows Transport

### Native Windows host

Run commands directly. Use existing Windows-native tools for process control, UI Automation, screenshots, and recording.

### Windows through UTM on macOS

Prefer UTM's guest agent:

```bash
/Applications/UTM.app/Contents/MacOS/utmctl
```

Useful operations:

```bash
utmctl list
utmctl status <vm>
utmctl exec <vm> --cmd <command> ...
utmctl file push <vm> '<guest-path>'
utmctl file pull <vm> '<guest-path>'
```

If `utmctl` reports Apple event error `-1743`, the calling process lacks permission to automate UTM. Running `utmctl` from Terminal.app is a proven fallback when Terminal has permission under **Privacy & Security → Automation**.

Example:

```applescript
tell application "Terminal"
	do script "/Applications/UTM.app/Contents/MacOS/utmctl list"
end tell
```

Do not assume:

- the VM is named `Windows`;
- the signed-in user has a particular name;
- UTM is installed in the default location;
- the VM display is the main display;
- the guest uses x64 rather than ARM64;
- VS Code is installed per-user rather than system-wide.

Discover each value.

## Preflight

Before changing or driving anything, collect:

- host OS and architecture;
- Windows version and architecture;
- VM name and status, when applicable;
- signed-in Windows user;
- guest-agent availability;
- target process and executable path;
- application version and commit;
- display bounds, scale, and target monitor;
- active settings/profile;
- requested output directory;
- expected success and failure signals.

For UTM:

```bash
utmctl list
utmctl exec <vm> --cmd cmd.exe /c whoami
```

`utmctl exec` can run as `NT AUTHORITY\SYSTEM`. Confirm this rather than assuming the command is in the interactive user's desktop session.

## Build Provenance

Before a verification run, answer:

> Does the Windows executable being tested contain the requested change?

Preferred sources, in order:

1. official PR or CI Windows artifact;
2. a Windows build produced from the exact source commit;
3. a locally built and deployed development build;
4. a narrowly scoped runtime patch for focused visual investigation.

The fourth option is not equivalent to testing a packaged PR build. If used:

- patch only code corresponding to the reviewed source change;
- verify unique patch anchors;
- preserve the original file;
- record the base build commit and patch;
- label the result as focused runtime validation;
- restore and hash-check the original.

Never report a PR as tested merely because a newer Insiders build was installed. Check commit ancestry or inspect the artifact metadata.

## Command and File Operations

Prefer guest commands for:

- installing or launching software;
- reading version and process data;
- changing test fixtures;
- copying settings;
- querying logs;
- starting test runners;
- restoring files.

Prefer guest file transfer for:

- helpers and wrappers;
- logs and summaries;
- build metadata;
- screenshots captured inside Windows;
- backup and restore artifacts.

Write command output to a guest file when `utmctl exec` does not return stdout reliably:

```cmd
tasklist /v /fo csv > C:\Windows\Temp\task-list.csv
```

Then pull the file.

## Interactive Windows Execution

Commands launched by a guest agent may run outside the signed-in user's interactive desktop. A helper that needs visible UI must run in the user's session.

A proven bridge is a temporary interactive scheduled task:

```cmd
schtasks /Create ^
	/TN TemporaryWindowsAutomation ^
	/TR C:\Windows\Temp\automation\run.cmd ^
	/SC ONCE ^
	/ST 23:59 ^
	/RU <interactive-user> ^
	/IT ^
	/F

schtasks /Run /TN TemporaryWindowsAutomation
```

Rules:

- discover the interactive username;
- use a unique task name;
- log startup, state transitions, and exit status;
- ensure the helper can be stopped independently;
- delete the task during cleanup;
- do not embed credentials;
- avoid wrappers that leave a terminal visible in demo recordings.

If a visible wrapper is unavoidable during development, replace it with a windowless launcher before the final recording. Validate the launcher with a short smoke run.

## UI Automation Hierarchy

Use this order:

### 1. Application commands and test APIs

Examples:

- VS Code command-line arguments;
- extension commands;
- smoke-test driver;
- remote debugging or CDP;
- application configuration files;
- a purpose-built test endpoint.

### 2. Windows UI Automation

Use semantic properties:

- process;
- window title;
- automation ID;
- control type;
- accessible name;
- supported patterns such as `InvokePattern`.

Verify the expected control was found exactly once before invoking it.

### 3. Win32 window messages

Electron and custom-rendered controls may not appear in the Windows accessibility tree. A small native helper can:

- enumerate visible top-level windows;
- filter by process and title;
- inspect client bounds;
- send a targeted message to the selected window.

This is appropriate for a known control in a known build when semantic automation is unavailable. Log the selected process, title, bounds, and message coordinates.

### 4. Guest pointer and keyboard input

Use guest-local input only when the prior methods cannot represent the interaction.

For UTM, host pointer injection is a poor default:

- macOS has one shared pointer;
- the user's movement races the automation;
- inactive-window clicks can activate rather than interact;
- Retina and multi-display coordinates can differ;
- UTM absolute-tablet mapping can add another offset.

If pointer input is required, inject it inside the Windows interactive session, not from the host.

### 5. Host mouse automation

Treat this as a last resort and require an idle host pointer. Never use it during an unattended autonomous workflow if a guest-local option exists.

## Develop the Automation Before Recording

Treat the scenario driver as a test.

1. Run the cheapest possible smoke.
2. Confirm the target process and window.
3. Exercise one state.
4. Write a result log before waiting.
5. Capture one screenshot.
6. Inspect the screenshot and log.
7. Fix selectors, timing, or window discovery.
8. Run the complete matrix without recording.
9. Record only after the dry run is boringly reliable.

Prefer observable completion signals:

- process starts or exits;
- expected window appears;
- setting is persisted;
- title or UI state changes;
- progress disappears;
- output file is created;
- driver writes `RESULT: completed`.

Use arbitrary sleeps only to provide stable presentation time after a state has already been observed.

## Windows UI Test Matrix

Derive the matrix from the feature. Common dimensions:

- light, dark, and high-contrast themes;
- active and inactive windows;
- hover, pressed, focused, and disabled states;
- minimize, maximize, close, restore, and fullscreen states;
- primary and auxiliary windows;
- keyboard-only interaction;
- screen-reader and accessible-name behavior;
- 100%, 125%, 150%, and 200% scaling where relevant;
- small, standard, and maximized window sizes;
- live configuration changes;
- restart and restore behavior.

For comparison bugs, show the surfaces side-by-side. A single “after” window is insufficient when the regression is a difference between two window types.

## Building a New VS Code UI

When another autonomous skill is creating a new VS Code UI:

1. **Baseline**
   - capture existing behavior on Windows;
   - note theme, scale, layout, and window type.
2. **Implement**
   - follow the feature-area, accessibility, layout, and theming skills;
   - add component fixtures or tests where applicable.
3. **Compile before testing**
   - typecheck the changed source;
   - fix all compile errors before launching Windows validation.
4. **Produce a real build**
   - prefer a packaged artifact or source-built Windows executable;
   - record its commit.
5. **Deploy**
   - use an isolated profile when possible;
   - preserve the user's existing installation and settings.
6. **Dry-run**
   - execute the full interaction matrix;
   - inspect screenshots and logs.
7. **Iterate**
   - make product changes, rebuild, and rerun the same states.
8. **Record**
   - add visible state labels;
   - show baseline, result, and edge states;
   - avoid terminals, warnings, or automation scaffolding obscuring the UI.
9. **Restore**
   - restore the guest installation and user state;
   - verify restoration.

The goal is not merely to make the UI appear. The goal is a source change that builds, behaves correctly on Windows, meets accessibility and theming requirements, and has reviewable evidence.

## Evidence Contract

Write evidence to a user-requested directory or a clearly named output folder:

```text
<feature>-windows-verification/
├── demo.mov
├── 01-baseline.png
├── 02-primary-state.png
├── 03-edge-state.png
├── run.log
├── build-info.json
└── verification-summary.txt
```

### Video

- Record only the relevant display or window.
- Include visible labels for each state.
- Keep each state visible long enough for review.
- Show baseline and comparison surfaces when relevant.
- Avoid accidental host UI, terminals, and notifications.
- Decode the entire output before reporting success:

```bash
ffmpeg -v error -i demo.mov -f null -
```

### Screenshots

- Capture milestone states during the run, or extract frames from the final video.
- Verify each screenshot's visible label.
- Do not rely on fixed-delay filenames without checking the resulting frame.
- Use OCR or direct inspection to detect drift between intended and captured states.

### Logs

The driver should log:

- start time;
- build version and commit;
- settings applied;
- each state entered;
- errors;
- final result.

### Summary

The verification summary must state:

- verified, not verified, or inconclusive;
- exact build or focused patch tested;
- environment and architecture;
- completed matrix;
- observed failures;
- evidence filenames;
- restoration status.

## Verification Standard

Do not report success until all of the following are true:

- the correct build was tested;
- the scenario driver reached every required state;
- screenshots show the requested UI;
- the final video opens and fully decodes;
- logs contain a successful terminal result;
- expected persistent effects are present;
- temporary helpers and tasks are removed;
- modified files and settings are restored or intentionally retained;
- restoration hashes match backups when byte-for-byte restoration is expected.

If any item is missing, report the run as incomplete or inconclusive.

## Cleanup and Restoration

Before modifying guest files:

1. stop processes that hold them open;
2. copy backups to a stable guest directory;
3. pull critical backups to the host when practical;
4. calculate hashes.

After testing:

1. stop the scenario helper;
2. close owned application processes;
3. restore binaries, bundles, settings, and state;
4. restore or remove temporary configuration;
5. delete scheduled tasks;
6. delete guest helper files;
7. relaunch the original application if appropriate;
8. compare restored hashes;
9. remove superseded host artifacts.

Do not delete user-created files or profiles. Keep restoration scoped to files changed by the automation.

## Troubleshooting

| Symptom | Likely cause | Response |
| --- | --- | --- |
| `utmctl` returns `-1743` | macOS Automation permission denied | Run through an authorized foreground app such as Terminal or grant permission |
| Guest command works but no UI appears | Command runs as `SYSTEM` or in a non-interactive session | Launch a temporary `/IT` task as the signed-in user |
| UI Automation cannot find an Electron control | Control is custom-rendered or not exposed | Use application APIs, CDP, smoke driver, or a narrowly targeted Win32 helper |
| Host click lands at the wrong point | Multi-display, Retina, inactive-window, or UTM tablet mapping | Stop using host coordinates; move automation into the guest |
| File pull says the file is in use | Producer or application still holds it | Wait for a completion signal, stop the process if safe, or copy to a stable temp file first |
| Screenshot filename does not match visible state | Fixed-delay capture drifted | Inspect/OCR the frame and extract a correctly timed frame from the video |
| Integrity warning appears after a focused bundle patch | Product checksum detects the intentional test modification | Disclose the patch; suppress only for the isolated test after backing up storage; restore afterward |
| Recording exists but may be corrupt | Capture process ended unexpectedly | Run a complete decode and inspect metadata before reporting success |

## Safety

- Assume the VM and host are real user environments, not sandboxes.
- Avoid destructive commands unless explicitly requested.
- Never copy credentials, tokens, or private user data into evidence.
- Keep auth-bearing profiles and state databases out of committed artifacts.
- Use throwaway workspaces and profiles where possible.
- Do not interact with unrelated windows.
- Never close or overwrite user work merely to simplify automation.
- Stop if restoration cannot be proven after modifying an existing installation.

## Learnings

- On UTM, host and guest pointer control ultimately competes with the user's single macOS pointer. Guest-agent commands plus an interactive Windows helper provide reliable concurrent automation.
- UTM guest execution may run as `NT AUTHORITY\SYSTEM`; visible UI automation must be bridged into the signed-in user's desktop session.
- Electron title-bar and custom-rendered controls may not expose usable Windows UI Automation nodes. Prefer application-level APIs, but a narrowly scoped Win32 helper can be a valid fallback when its target and outcome are independently verified.
- A polished recording is not sufficient evidence. Build provenance, complete state logs, accurate screenshot labels, full video decoding, and verified restoration are part of the result.
