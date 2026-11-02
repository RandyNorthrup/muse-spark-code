# Muse Desktop font notices (M111, D91.11)

The image installs four font families from Debian trixie, all under the SIL
Open Font License 1.1. The full licence text ships in each package under
`/usr/share/doc/<package>/copyright`; the families and their sources:

| Family           | Debian package           | Role                            |
| ---------------- | ------------------------ | ------------------------------- |
| Inter            | `fonts-inter`            | UI face (`sans-serif`, `serif`) |
| JetBrains Mono   | `fonts-jetbrains-mono`   | Code face (`monospace`)         |
| Noto Sans CJK SC | `fonts-noto-cjk`         | CJK coverage behind both faces  |
| Noto Sans CJK TC | `fonts-noto-cjk`         | CJK coverage behind both faces  |
| Noto Sans CJK JP | `fonts-noto-cjk`         | CJK coverage behind both faces  |
| Noto Sans CJK KR | `fonts-noto-cjk`         | CJK coverage behind both faces  |
| Noto Color Emoji | `fonts-noto-color-emoji` | Emoji behind `sans-serif`       |

The role bindings live in `os/desktop/fontconfig/59-muse-desktop.conf`; the
package list in `os/desktop/packages.conf` installs exactly this set, and the
font gate (`scripts/check-font-coverage.mjs`) shapes every UI string with
HarfBuzz against every face and fails a codepoint no face covers.
