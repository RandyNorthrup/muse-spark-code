# Accessibility gate: focus emulation and scenario readiness (2026-10-05)

Branch `fix/a11y-focus-emulation`, from `main` at `834df660`. Found while
merging main into M81 (PR #87, `docs/certification/mg87c.md`). Tests and
tooling only; the product is unchanged. No live model call.

## The failure

`npm run test:a11y` failed now and then on Kubuntu with
`scrollable-region-focusable (serious)` on `<theme>/slash-commands: :root`,
the theme changing from run to run. It failed 3 of 13 full runs on M81's
merge, and with three full suites at once it failed both runs of unchanged
`main` (`048d153f`): all four `slash-commands` pages, then one.

**Root cause.** Headless Chrome, started per page with `--dump-dom`, does
not keep a window's focus. When the window lost it while axe ran, the
composer's `/` menu, shown only while focus is within the composer, closed
under the scan. axe had already matched the menu as a scrollable region, so
the detached node was reported as `:root` with no focusable content, which
the listbox exemption cannot find. A captured failing page (its state read
after axe): the draft still `/co`, the caret at 3, the textarea still the
active element, no menu, and `inputFocusChanged` the webview's last message.
Closing a menu when the window loses its focus is the product's intended
behaviour; the gate's browser was the problem.

Ruled out: the order of pages and a shared profile (one sequential worker,
`rtl` then `slash-commands`), CPU load alone (10 busy loops: 0 of 8 failed
under virtual time), and the tooling (axe-core 4.13.0, playwright-core
1.63.0). Chrome's anti-backgrounding flags did not help: under the same
load most `--dump-dom` pages reported `document.hasFocus()` false.

## The fix

`scripts/a11y.mjs`, `test/harness/index.html`. No axe rule, exemption or
scenario changed.

- Each worker runs one Playwright persistent context on its own profile (as
  the `share-narrow` page already did), two pages at a time (one on
  Windows), and each page turns on Chrome's focus emulation
  (`Emulation.setFocusEmulationEnabled`) before it loads: the page keeps its
  focus whatever the machine does with the window. The viewport is the
  690 x 673 the old 690 x 760 window left for the page; `share-narrow` keeps
  its 320 x 760.
- Every page is scanned only once ready: fonts loaded, no finite animation
  or transition running (an infinite one, the caret's blink or a spinner,
  is a steady state), and two frames, each also over after 50 ms so that a
  window that paints none cannot hold it. `slash-commands` also waits for
  `.slash-menu` with its options. A page not ready within 10 s fails with
  "scenario X never became ready"; nothing asks for the window's real focus.
- A scan during which the window still loses its focus or is hidden is
  void and fails the page with that reason, instead of reporting a bare
  `:root`.
- The harness's 5 s settle now runs in real time (it ran on Chrome's virtual
  time before).

## Proof

Kubuntu (10 cores), the same production build for every tree, other lanes'
tests sharing the rig (load average 7 to 57). Fix snapshot `8abac31b` (this
change on `834df660`); "today" is `834df660` unchanged. Log:
`scratchpad/rig-gate/logs/a11yf.log`.

| Run                                                                                   | Result                                                                                                                       | Time each |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------- |
| Fix, one suite alone                                                                  | 1 of 1 passed: 448 pages, 0 violations, 44 exempt                                                                            | 229 s     |
| Today, one suite alone                                                                | 1 of 1 passed: 448 pages, 0 violations, 44 exempt                                                                            | 151 s     |
| Fix, three suites at once, three rounds                                               | **9 of 9 passed**, each 0 violations, 44 exempt, 0 pages without a result                                                    | 246–252 s |
| Red drill: today, three suites at once                                                | **3 of 3 failed**: `slash-commands` on `:root` in 3, 4 and 4 themes; 4 and 5 pages of two runs never rendered their scenario | 498–499 s |
| Fix with `Emulation.setFocusEmulationEnabled` off from its own session, three at once | 3 of 3 passed (see below)                                                                                                    | 244–245 s |

- **Run time.** Alone the gate is 78 s slower (229 s against 151 s): the
  harness's 5 s settle runs in real time now, two pages to a worker. Under
  load it is twice as fast (about 247 s against 498 s), since Chrome's
  virtual time stretched with the machine's load.
- **The focus-off drill does not remove focus emulation.** Playwright itself
  sends `Emulation.setFocusEmulationEnabled { enabled: true }` on its own
  session for every main frame (`playwright-core` 1.63.0, `coreBundle.js`);
  disabling it from a second session leaves Playwright's on. The page's
  focus is therefore Playwright's default as well as this script's request,
  and the red drill that removes the fix is today's runner, which failed 3 of
  3 under the same load (and unchanged `main` 2 of 2 before, with the merge
  for M81).
- Lint (`eslint --max-warnings=0`) and Prettier pass on the changed files.
