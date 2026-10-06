# M114 S screenshots, visual regression and docs

Kubuntu, 2026-10-06. Lane S integrates P2 `871597b49` and F `c33755507`
with the brief's explicit `--no-ff` merges. Plan conflicts were resolved
additively. Hooks exist at `.husky/_/pre-commit`; all commits use them.
No credentials, live/paid calls, shared installation changes or other lane's
production UI edits. The common lane brief prohibits aggregate quality;
scoped checks run here and the lead owns that final integration gate.

## First completed piece: inherited host-API handoff

The old scanner saw only the webview directory after CSS moved into imports.
`collectThemeVariables` now follows local CSS imports recursively, normalizes
Windows separators, terminates cycles and refuses an import outside the tree.
The generated record includes the actual importing files and F's new Node
uses: **332 VS Code APIs, 31 import files, 25 Node built-ins, 62 theme variables**.
Both `node scripts/check-host-api.mjs --write` and its read-only check exit 0.

`themeInventory.test.mjs`: **2/2 passed**, repository default timeout,
three workers. Disabling `pending.push(relative)` failed both named tests:
“follows nested CSS imports, terminates cycles and normalizes Windows paths”
and “records the real generated host roles imported by both polished surfaces”.
The source was restored byte-exact, SHA-256
`a7aa377f9c6e0a106e8f9a3bce8bc2288a8d379bd34b4f5a2a4079114c62274d`.
Log: ignored `temp/m114-s-theme-import-red.txt`.

The first synthetic-file run also encountered a transient `/tmp` write quota
error. Test scratch now uses this lane's ignored `temp/`; no rig-wide cleanup
or setting was performed. A mistaken test expectation put widget-shadow in
the extended roles; it correctly belongs to `tokens.css`. The regression
still specifically checks the imported placeholder role.

Visual implementation and integrated capture verification are in progress;
this first-piece record claims only the completed host-inventory handoff.
