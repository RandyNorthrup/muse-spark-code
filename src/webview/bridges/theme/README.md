# Companion and native theme consumer

This is M114 C's consumer of the frozen [token contract](../../../../design/tokens/README.md).
`loadThemeBridge` imports the consumer lazily. It takes a scoped `HTMLElement`,
an injected `ThemePort`, a fixed invalid-snapshot notification and the
surface's `AbortSignal`. Aborting before load prevents subscription; aborting
after load restores the root and unsubscribes. Calling the returned disposer
does the same. One caller owns a root at a time.

The port supplies complete internal snapshots with `mode` (`light`, `dark`,
`hc-light`, `hc-dark`) and `roles` keyed by
`design/tokens/generated/consumers.json.hostRoles`. Missing roles use the
generated palette; a later snapshot removes earlier omitted overrides.
Colours are literal CSS colours checked by the browser; UI/code families and
positive pixel sizes use their corresponding CSS parsers. Unknown keys,
CSS-wide keywords, variable references and invalid values refuse the entire
snapshot, without changing the last valid theme. Snapshot validation never
logs values. The port's `subscribe` must return an unsubscribe function;
`current` reads the latest snapshot after the subscription is installed.

These are internal dependency contracts, **not MHP wire types**. M104 owns
parsing the captured theme frame, converting it to semantic roles, supplying
the initial value and emitting full replacements. The same consumer serves
the companion and all native hosts. The companion's empty role map selects
a Muse palette and installed/system font stack; native roles override colours
and editor fonts. Existing shared components also get compatibility
`--vscode-*` variables from the generated map. Raised surface wins the alias
it shares with overlay; both semantic roles remain independently settable.

The lazy `themeEntry.ts` imports `tokens.css`, `host-roles.css`, `muse.css`,
then the scoped surface rule. **The host must load the emitted stylesheet
after the shared panel stylesheet before mounting.** esbuild extracts CSS;
a dynamic JavaScript import alone does not load that stylesheet. Use only
packaged, host-authorized asset URLs under the existing CSP. There are no
remote assets, fonts, listeners, settings or changes to the VS Code bootstrap
here. The matching generated accessibility rules remain in CSS; the port
cannot override elevation, motion, transparency or blur.

The owning [certification](../../../../docs/certification/m114-c-companion-and-native-webviews.md)
names the missing M104 binding, build/budget wiring and real-editor capture
work. The browser suite builds the actual lazy closure and checks separate
25 KiB JavaScript and 25 KiB CSS caps, without increasing any existing cap.
Run the two owning files on a rig:

```sh
npx vitest run test/unit/themeBridge.test.ts test/unit/themeBridgeBrowser.test.mjs --maxWorkers=3
```
