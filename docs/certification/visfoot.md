# VISFOOT — the footer scene takes its states from the footer

Branch `fix/visual-footer-target` from `release/0.17.2` `635b8e814`,
2026-10-11, for the release train. Windows host for edits, Prettier,
changed-file ESLint and git; every Vitest run on the Mac mini. Hooks stayed
on. No push, pull request or tag. No cap, threshold or deadline changed.

## Why

REL0172's review of the baseline rendered with the What's New fixture
(`docs/certification/rel0172.md`) found that `whats-new-footer` no longer
drew the footer links' hover, focus and pressed states. The capture applied a
scene's states to the first control visible on its screen. With 0.17.1's
notes that was **Full Changelog on GitHub**; with the fixture it is the code
block at 320 px and a link in a paragraph at 690 px. Any real notes that end
with a link or a code block would have done the same.

## What changed

- `test/harness/goldens/capture.mjs`: a scene named for one part of a page
  takes its state target from that part (`STATE_SCOPE`:
  `whats-new-footer` → `footer`), whatever else the screen shows. A part
  that is missing is an error, never the whole page in its place.
- `test/unit/visualCapture.test.mjs` (the real capture driver, through the
  fixture) also captures `whats-new-footer` at 320 px and requires: default,
  hover, focus and pressed mark the link **Full Changelog on GitHub** inside
  `<footer>`; disabled marks the footer's checkbox; all four non-default
  states are applied.

## Results (Mac mini)

| Suite             | Result                         |
| ----------------- | ------------------------------ |
| `visualCapture`   | 12 of 12 (the new case is one) |
| `visualStability` | 108 of 108                     |
| `visualGate`      | 12 of 12                       |
| `m114Audit`       | 7 of 7                         |
| `whatsNewFixture` | 10 of 10                       |

## Red drill

`STATE_SCOPE` emptied, `visualCapture` on the Mac mini: 1 of 12 failed, exit
1, on the new case: "expected { state: 'default', tag: 'PRE', … } to deeply
equal { state: 'default', tag: 'A', … }", with `isInFooter` false and the
code block's text as the target. The file was restored byte for byte (same
SHA-256 before and after).

## What this commit does not hold

The baseline. It moves the frames of `whats-new-footer` in hover, focus and
pressed: three states, six themes, two widths, 36 frames; the default,
disabled and selected frames keep their pixels. At 320 px the recorded
target of 24 rows returns from `pre` to `a`. Until the manifest is rendered
again with this commit in place, `npm run check:visual` fails on those
frames, so the commit lands with a reviewed update, never alone: the release
train's baseline. The review of that update looks at the focus ring on
**Full Changelog on GitHub** clear of **README on GitHub** at 320 px in all
six themes, the check 0.17.1's review made and 0.17.2's baseline could not.
