# Computer Use on macOS

One-time setup on a Mac. The contract and the operating loop are in [`SKILL.md`](../SKILL.md).

## One-time macOS setup

The host needs:

```json
"chat.agentHost.computerUse.enabled": true
```

The first activation may use `/computer on`. Grant `Copilot Computer Use.app`:

- **Privacy & Security -> Screen & System Audio Recording**
- **Privacy & Security -> Accessibility**

Fully quit and reopen the Copilot host after changing either permission. If macOS attributes the
helper to the parent process and the helper still reports a missing grant, grant the active host
(for example, VS Code Insiders) under the same two panes.

Do not request Input Monitoring, Full Disk Access, Contacts, Automation, Camera, or Microphone for
ordinary desktop control. After screenshots/reads and clicks work, `no_viable_candidate` is a
safe-targeting problem, not a missing-permission problem.
