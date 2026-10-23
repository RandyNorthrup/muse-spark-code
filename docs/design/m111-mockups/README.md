# Muse Desktop M111 mockups — the approved design reference

Approved by the owner on 2026-10-23 ("looks great"), which closes Q-M111 item 6
in PLAN.md and unblocks lanes SH1, SH2, WB and ST. Built per research §13.5
(`docs/research/muse-desktop-2026-10-05.md`). Every screen names the
`--ms-*` tokens it uses from `design/tokens/generated/muse.css` (M114/D94);
tokens marked "proposed" in the legends entered the token source in lane 0
(`design/tokens/muse.tokens.json`).

- `project/` — the design canvas sources (`.dc.html` sheets, `canvas.json`,
  `mock.css`, `muse.css`).
- `viewer/muse-desktop-mockups.html` — the readable standalone viewer.

## The 18 screens

| Sheet                                                             | Screen                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| `Main.dc.html`                                                    | 00 · Index                                                        |
| `Wb1920Dark.dc.html` / `Wb1920Light.dc.html` / `Wb1920Hc.dc.html` | 01–03 · Workbench · 1920×1080 · dark / light / high contrast dark |
| `Wb1280Dark.dc.html` / `Wb1280Light.dc.html` / `Wb1280Hc.dc.html` | 04–06 · Workbench · 1280×800 · dark / light / high contrast light |
| `BarSystem.dc.html`                                               | 07 · Top bar · system popovers                                    |
| `BarMuse.dc.html`                                                 | 08 · Top bar · Muse popovers                                      |
| `Launcher.dc.html`                                                | 09 · Launcher · every result kind                                 |
| `LauncherModes.dc.html`                                           | 10 · Launcher · modes                                             |
| `Greeter.dc.html`                                                 | 11 · Greeter (sign-in)                                            |
| `Lock.dc.html`                                                    | 12 · Lock screen (counts only, never content)                     |
| `Prompts.dc.html`                                                 | 13 · System prompts                                               |
| `Tiled.dc.html`                                                   | 14 · Tiled desktop                                                |
| `Onboarding.dc.html`                                              | 15 · Onboarding · pack list                                       |
| `Preview.dc.html`                                                 | 16 · Preview · device toolbar                                     |
| `Grid.dc.html`                                                    | 17 · Preview · multi-viewport grid                                |
| `Rtl.dc.html`                                                     | 18 · Pseudo-RTL mirror                                            |
| `Legend.dc.html`                                                  | Token sheet (legend component)                                    |
| `Workbench.dc.html`                                               | Workbench component (source of 01–06, 16–18)                      |

## One divergence, decided by PLAN

`Tiled.dc.html` draws the detached terminal joining the tiling; D91.13 calls
a detached terminal **floating**. D91.13 governs: the mockup is wrong there,
and the lane-0 contracts (`src/shared/desktopContracts.ts`) say floating.

Lane 0's component contracts, strings and token additions derived from these
screens are recorded in `docs/certification/rlf-m111l0.md`.
