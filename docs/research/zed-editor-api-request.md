# Zed panels and edit-prediction providers — owner submission draft

Title: Add extension-owned agent panels, commands and completion providers

The checked-in [editor research](editor-parity-2026-10-05.md#22-zed-stable-1220-2026-09-30--ui-route-c)
identifies two upstream gaps: Rust extensions cannot create a rich embedded
panel/command, or register an edit-prediction provider. This lane has not
rechecked online APIs: network is prohibited by its rig brief. The owner
should verify the current API before submitting this draft as a Discussion;
Zed's recorded contribution policy requires an owner submission. Nothing has
been sent upstream.

Muse Spark Code (Unofficial) can register an ordinary language server and
use custom ACP plus quoted tasks. Its external companion holds chat,
approvals, diffs, usage and settings. The extension needs an editor-owned
panel with a typed bounded message bridge, lifecycle notifications,
keyboard/accessibility support and theme/locale information, plus a command
to focus it. It also needs a registered invoked completion provider whose
response can be displayed as edit-prediction ghost text without placing a
provider key in editor settings.

Please expose registration and cancellation APIs for these extension
services. An editor should be able to ask the same session runtime for a
versioned completion, reject stale results and keep Stop callable outside a
blocked request. Panel navigation must remain restricted and use CSP. Our
runtime can own paid-use consent and daily admission; a one-time fragment
code pairs the companion and the per-window bearer stays in memory.

Reproduction: configure the ordinary `muse_spark` language server and custom
ACP agent, then launch its companion task. Completion items can use the LSP
route, but an extension cannot register the dedicated prediction provider or
embed the rich companion under the researched API. A separately quoted Stop
task now supplies an independent Stop control route.

Our missing B controller, unavailable local SDK and unrun GUI tests are
integration/qualification work, not upstream API defects. Ordinary LSP and
approved workspace edits have a route already and are not requested as new
editor APIs. No Meta or Zed endorsement is implied.
