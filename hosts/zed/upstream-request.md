# Zed extension panels and commands — owner submission draft

**Title:** Add extension-owned panels and commands for companion agent UIs

**Problem:** Muse Spark Code (Unofficial) uses Zed's supported custom ACP
agent registration and a companion task. The extension API cannot register
a native command opening a rich agent panel or embed that panel. Users must
switch between Zed's Agent Panel, task terminal and an external browser for
chat, approvals, diffs, usage and settings belonging to the same session.

**Reproduction:** Register a custom ACP agent and create a workspace task
that launches its loopback companion. Start the agent, request its fresh
same-session panel link, and open it in a browser. There is no supported
extension panel/command route to replace this manual interaction. Our
current registration and task generator are in `hosts/zed/register.py`.

**Requested API:** Let a user-installed extension register named commands
with keybindings and create or focus an extension-owned panel. The panel
needs a bounded, typed message bridge, lifecycle notifications, keyboard
and accessibility support, and theme/locale information. A browser-backed
view could host bundled assets or an explicitly approved loopback companion;
the editor should retain ownership of navigation and the view's lifecycle.
Custom ACP registration remains a useful independent route.

**Security:** Require user consent before installing or launching runtimes;
restrict navigation and remote origins; enforce CSP and bounded messages.
Do not expose API keys or bearer tokens to extension settings or logs.
A one-time fragment link can pair a panel with its existing ACP session;
an in-memory per-window bearer authenticates the companion's requests.
Stop must remain available independently of the agent's request queue.

**Current equivalent:** The supported custom-agent/task route opens the
shared companion in a browser; Zed's native terminal cancellation supplies
the task Stop route. Embedded panels, native commands, editor-service and
full-functionality qualification remain pending. This is a request draft,
not a claim that those APIs exist or that Zed endorses the extension.

**Submission:** The repository owner reviews and submits this draft to
Zed's feature-request channel. No request has been submitted by this lane.
