# Composer prompt menu — 0.14.5 certification

**Scope.** 0.14.4 showed Save prompt, Share prompt and Use saved prompt as three
full-width buttons that covered the chat box. 0.14.5 moves them into one compact
menu behind a bookmark button on the composer toolbar. The menu reuses the
existing `PopoverMenu`, loaded lazily. The panel's right-click menu keeps
offering all three through the existing `webview/context` contribution.

## Behaviour and tests (`test/unit/Composer.test.tsx`)

- No full-width prompt buttons. The menu lists Save, Share and Use saved, runs
  each with the exact draft (CRLF kept), never submits, and closes with focus
  back on the input.
- An empty or whitespace-only draft offers Use saved only. Escape closes the menu.
- No bookmark button when no prompt action is available.
- Clicking the bookmark again closes the menu and returns focus to the input
  (review thread on PR #135).
- While the menu is open, the attached `/` list and the `@` mention list close,
  so two popups never share the footer (review thread on PR #135).
- `test/unit/App.test.tsx`: the composer rows of the M118 failure-notice table
  go through the menu.

The narrow-layout rule reserves room for three icon controls before the model
pill when the bookmark is present (`styles.css`, `:has(> .prompt-menu-button)`).
The whole toolbar therefore wraps as one unit below about 276 px, as before.

## Deliberate-failure drills (2026-10-06, Windows host)

Each mutation of `src/webview/components/Composer.tsx` ran its named test, which
had to fail. The file was then restored and its SHA-256 checked
(`6c4b6020…8fd64e1` before and after every drill).

| Drill                  | Mutation                                  | Test                                                                  | Result           |
| ---------------------- | ----------------------------------------- | --------------------------------------------------------------------- | ---------------- |
| Empty-draft gating     | Save offered without draft text           | keeps save and share out of the prompt menu while the draft is empty  | failed, restored |
| Hidden with no actions | Button rendered with no entries           | shows no prompt menu button when no prompt action is available        | failed, restored |
| Toggle close refocuses | Close without refocusing the input        | returns focus to the input when the prompt button closes its menu     | failed, restored |
| Slash list suppressed  | Prompt menu no longer closes the `/` list | closes the attached slash list while the prompt menu is open          | failed, restored |
| Exact draft to Share   | Share routed to Save                      | offers exact composer prompt text to the shared menus without sending | failed, restored |

One earlier version of the last drill trimmed the draft. That cannot change
the test's draft, so the test correctly passed. It was replaced by the
routing mutation above rather than counted.
