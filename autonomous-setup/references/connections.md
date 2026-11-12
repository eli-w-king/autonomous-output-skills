# Work IQ, Playwright and Computer Use

The detail behind steps 5 to 7 of the interview: how each connection is installed, the one real test that proves it
works, and what to do when it doesn't. The rules for using them later are in
[`autonomous-computer-use`](../../autonomous-computer-use/SKILL.md).

## Work IQ

Work IQ lets agents read the person's Microsoft 365 mail, calendar, Teams and files (only what they can already see),
and send things they approve. It's a hosted connection, so nothing runs locally.

**Install.** Two official plugins from `microsoft/work-iq`: `workiq` (the connection and its skill) and
`workiq-productivity` (read-only report recipes). You install them from your own shell, never through the person's
terminal: `copilot plugin marketplace add microsoft/work-iq`, `copilot plugin install workiq@work-iq`,
`copilot plugin install workiq-productivity@work-iq`. When `copilot` isn't there, or it's only VS Code's shim (the
check's `copilot_cli` and `copilot_cli_is_vscode_shim`; the shim can only install Copilot CLI from an interactive
terminal), install Copilot CLI first with `npm install -g @github/copilot` (`npm.cmd` on Windows).

An existing install: `copilot plugin update workiq`. The check finds Copilot plugins in `~/.copilot/config.json` and
VS Code's agent plugins in `~/.vscode-insiders/agent-plugins/installed.json`.

**New tools need a new chat.** A chat's tools are fixed when it starts. After installing, record the step as pending
("installed; test it in the next chat"), install the Playwright MCP server too, then start the next chat yourself
with `create_session` (SKILL.md, "The next chat": no `model`, so it keeps Claude Opus 5.5, Max, 1M, Autopilot and
Allow all). That chat runs both tests.

**The test (Try it): the check-in.** Load the `workiq` skill first and follow its routing and tool names (the host may
prefix them, for example `workiq-fetch`). When the setup prompt passed in a check-in chat (`checkInChat`), the Try-it
prompt asks to post "Work IQ is set up" in that meeting chat. The person typing that prompt is their okay for that one
message. Find the meeting chat by its name on their calendar or in their chats (if more than one matches, ask which),
send the one message through the `workiq` skill's Teams reference, then read the chat back and confirm exactly one
copy is there. A timeout or unclear result is never a reason to send again: read first. Without a check-in chat, the
test is a read instead: their next meeting's subject (the `fetch` tool on `/me/calendarView` for the next seven days,
`$top=1`, `$select=subject,start`, ordered by start), shown to them and kept out of every file. Then
`check-setup.py mark workiq ok` and `check-setup.py tested workiq`.

**When it fails.**
- "MCP authentication required" for workiq, with **Authenticate**: it shows as soon as a chat with the plugins starts
  (the server asks for sign-in when it connects). They click Authenticate and finish the Microsoft 365 sign-in in the
  browser; never click or type for them. Until they do, Work IQ's tools aren't there, and the rest of the chat works.
- Consent ("admin consent", "AADSTS65001", "Need admin approval"): their tenant has to consent once. Mark the step
  `blocked` with "needs tenant admin consent" and point to the admin guide in the plugin repo
  (https://github.com/microsoft/work-iq, `ADMIN-INSTRUCTIONS.md`).
- License: Work IQ needs a Microsoft 365 Copilot license. Mark `blocked` with "needs a Microsoft 365 Copilot
  license" and who to ask (their manager or IT).
- No tools in the next chat: check `copilot plugin list`; missing tools alone don't prove a sign-in problem.
- A `null` reply with no error: retry once with the URL checked, then report it as unexplained. Never guess a cause,
  never switch to another connection to get around a denial.

## Playwright

Playwright drives a real browser: agents use it to open a page, click around, fill forms and take screenshots. Setup
gives everyone the same route: the **Playwright MCP server** (`@playwright/mcp`) in Copilot's MCP config
(`~/.copilot/mcp-config.json`, which the Agents window's Copilot sessions and Copilot CLI both read), running on the
Chrome or Edge they already have. No project needed, and no browser download.

**Why this route.** "Take a screenshot of this page" works from one prompt. `--browser chrome` (or `msedge`) uses the
installed browser channel, so nothing downloads. It comes through npm like everything else, so Microsoft's package
feed works. Projects that need the Playwright library for scripts (the workshop's example repo does) bring their own.

**Add it.**
```
<py> <skill>/scripts/mcp-servers.py add playwright --dry-run --json
<py> <skill>/scripts/mcp-servers.py add playwright --json
```
It picks `chrome` when Chrome is installed, `msedge` otherwise, keeps a backup of the file, and never adds a second
Playwright server (an existing one counts). It pins the newest release: Microsoft's npm feed points `latest` for
`@playwright/mcp` at a March 2025 alpha that has no `--browser` option, so `@latest` would get an old build there. On
Windows the entry runs `cmd /c npx ...`. Chats that start after it pick it up.

**The test (Try it, in the next chat):** "Use Playwright to open https://code.visualstudio.com, take a screenshot and show it to
me." A browser window opens (the server runs headed by default), and the screenshot shows up in chat.
Then `check-setup.py mark playwright ok` and `check-setup.py tested playwright`.

**When it fails.** No Playwright tools in the session: it was added after the session started; start a new one. "No
browser": install Chrome (macOS) or repair Edge (Windows). npm can't reach a registry: see
[machine](machine.md), "Node, npm and Yarn".

## Computer Use

Computer Use lets an agent work in desktop apps in the background (for example, writing notes in Notes) without
taking over the mouse or keyboard. Each app asks for approval the first time.

**Turn it on.**
1. The setting `"chat.agentHost.computerUse.enabled": true` (the workshop settings include it). It takes effect
   after a restart, and VS Code offers one ("A setting has changed that requires a restart to take effect", with
   **Restart**). Ask whether Insiders has restarted since the settings went in. If not, save progress with
   `check-setup.py mark computer-use pending --note "restart Insiders"`, ask them to click **Restart** (or quit and
   reopen Insiders), reopen this session from the session list, and say "continue my setup".
2. They type `/computer on` in the chat. "Turn on Computer Use?" appears; they choose **Turn On**. It stays on for
   Copilot, including the Copilot CLI, until `/computer off`. The plugin downloads on first use.
3. **macOS only:** a card says "Computer Use needs permission to control apps and capture their windows." They
   click **Set Up Computer Use**. The dialog lists two permissions for "Copilot Computer Use": **Screen Recording**
   ("See app windows") and **Accessibility** ("Click and type in apps"). For each, **Allow in Settings** opens
   System Settings, where they switch on Copilot Computer Use (or drag it into the list). Back in the dialog,
   **Check Again** until it says "Computer Use is ready." Copilot continues once macOS confirms both. If macOS asks
   to quit and reopen an app, they do. If a permission still shows as off, grant VS Code Insiders in the same two
   places too. No other permission is needed (no Input Monitoring, no Full Disk Access).
4. **Windows:** no OS permissions; steps 1 and 2 are all.

**In Autopilot.** The agent can't turn Computer Use on for them (the host reports the request as unattended), and the
approval prompt an app shows the first time is cancelled. So they type `/computer on` themselves, and they switch the
picker to **Interactive** for the test below, then back to Autopilot.

**The test (Try it): one harmless action.** On a Mac: "Use Computer Use to write "Computer Use works" in a new note
in Notes." On Windows: "Use Computer Use to open Notepad and type "Computer Use works". Don't save it." They approve
the app when asked. Tell them what you did, then `check-setup.py mark computer-use ok` and
`check-setup.py tested computer_use`.

**When it fails.** Tools missing after `/computer on`: wait for the plugin download, then start a new session. A
refused or unclear action is not permission to try another way; stop the step and say what happened.
