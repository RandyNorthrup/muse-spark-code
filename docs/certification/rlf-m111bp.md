# RLF-M111BP — M111 lane BP, the bottom panel (D91.13 and its amendment)

Updated 2026-10-31 (lane RLF-M111BP on linuxlt, base rec/rlf-m111wb).

Base: lane WB (the Electron workbench, its D91.13 layout with the terminal
panel and tabbed footer, the desktop bridge). BP builds into WB's layout
slots and bridge; never a second layout.

## What is done

- **Dependencies** (D3 records in PLAN.md §2): `@xterm/addon-webgl`
  0.19.0, `@xterm/addon-search` 0.16.0, `@xterm/addon-web-links` 0.12.0,
  `@xterm/addon-unicode11` 0.9.0 (all MIT, no deps, no peers, published
  2025-12-22) and `node-pty` 1.1.0 (MIT, published 2026-10-23, the version
  `scripts/package-node-image.mjs` already expects). All dev-only: no VSIX
  metafile lists them; the desktop installer's notices travel with M111i's
  build. `node-pty`'s binding compiled from source at install; a probe
  spawn of `/bin/bash -c 'echo pty-ok; exit 3'` streamed `pty-ok` and
  reported exit code 3. Canonical `security:audit` exits 0 with them in
  the tree.
- **Design decisions** (this record is the working note until the lane
  lands; PLAN's M111 section carries the final status):
  - The PTY lives in `desktop/app/terminals.ts` (WB's module) on the same
    bridge channels — no new spawn path. D90's "node-pty lives only in
    the tool host" keeps it out of the node _service_ process; the
    desktop's main process is the local tool host, running as the person
    with `*_API_KEY` stripped from every child's environment.
  - The persisted layout moves v1 → v2 (WB's v1 migrates): per-tab slots
    (dock, floating window, footer), split trees, pin state, the panel
    view and floating bounds join WB's placement and sizes.
  - Problems renders M68's diagnostic shapes (`DiagnosticEntry`), Output
    renders channel logs; both are real stores and surfaces fed over new
    bridge channels. Their suppliers (ED's check runs, WS's dev servers,
    task runners) are later lanes' surfaces; until one publishes, the
    empty states are the honest ones.
  - Agents' tabs carry the agent label, command and run id, are read-only
    in the surface and in the session (H13), and stop through the same
    close channel. The Live-peek deep link is SB2's surface; the tab
    already carries the run id it will key on.

## What is next

Shared panel model → main-process PTY/stores → strings → renderer panel →
PTY staging → real-Electron proof → drills and gates.

## Proof

- `node-pty` probe (2026-10-31, linuxlt): real `/bin/bash` through the
  compiled binding, output and exit code observed (above).
- Canonical `security:audit`: exit 0 (2026-10-31).
