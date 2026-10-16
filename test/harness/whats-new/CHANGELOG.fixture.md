# What's New screenshot fixture

The screenshots of What's New (`whats-new`, `whats-new-footer`,
`whats-new-highlights`) are rendered from this file, never from the real
`CHANGELOG.md`: a release adds notes and a version without moving a frame.
The two releases below are fixed. They hold every kind of part the builder
(`scripts/lib/whatsNewContent.mjs`) can turn release notes into, so the frames
show the page's whole layout; `test/unit/whatsNewFixture.test.mjs` fails when
the real notes use a kind this file lacks. Changing this file re-renders those
scenes (docs/RELEASING.md).

## [0.90.0] - 2026-01-15

A lead paragraph under the release heading, before any section: some releases open with one.

### Highlights

- **A highlight that opens something.** One sentence says what changed and a second one says where to find it, long enough to wrap at 320 px. <!-- try: command museSpark.modelsAndAgents -->
- **A highlight with a setting.** It names `museSpark.showWhatsNewOnUpdate`, the setting its button opens. <!-- try: setting museSpark.showWhatsNewOnUpdate -->
- **A plain highlight.** With _emphasis_, ~~removed words~~, `inline code` and a [link to the notes](https://example.test/notes).
- **Smaller fixes.** A fourth and a fifth highlight make the longest list a release may carry.
- **The fifth highlight.** Short.

### Added

- **A bold lead-in.** A bullet of ordinary length, with a path in code, `src/core/providers/configured.ts`, and a command, `npm run quality`.
- A bullet with a nested list:
  - a nested bullet with `code`;
  - a second nested bullet, whose text is long enough to wrap onto another line at the narrowest width;
    1. an ordered item on the third level;
    2. and its neighbour.
- A bullet with a very long unbroken word: Averyveryverylongunbrokenwordthatcannotwrapanywhereonitsown_0123456789_abcdefghijklmnopqrstuvwxyz, and an unbroken path, `test/unit/helpers/aVeryLongHelperFileNameThatDoesNotFitOnOneLineAtThreeHundredAndTwentyPixels.ts`.
- A bullet with two paragraphs.

  The second paragraph belongs to the same bullet.

1. A numbered step.
2. A second numbered step, with a [relative link](docs/RELEASING.md) that points at the repository.

### Changed

A paragraph outside any list, with **strong text**, a hard  
line break, a web address written out (https://example.test/written-out) and raw markup kept as text: <kbd>Ctrl</kbd>.

> A quoted note. Its second sentence makes the quote wrap.

```sh
npm run check:visual -- --update --review=A-REVIEW-NAME --archive=/var/tmp/an-archive-outside-the-repository
```

#### A heading inside a section

| Setting         | Default |
| --------------- | ------- |
| `museSpark.one` | `true`  |
| `museSpark.two` | `false` |

### Fixed

- A fix described in one sentence.
- A second fix, so the list under the last heading has more than one item.

## [0.89.2] - 2025-12-01

### Fixed

- An older release with a single section: the page shows two releases at most, and this is the second.
- Its second bullet.
