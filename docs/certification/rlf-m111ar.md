# RLF-M111AR — M111 lane AR: Art (D91.11, D91.30's art)

Base: cc/int9 `5ec754534` (M111 lanes 0, WB, ED, TH, IN merged). Rig: linuxlt.
Date: 2026-11-02.

Lane AR builds D91.11 (pointer, icons, fonts, wallpapers, Plymouth, GRUB,
greeter art, all from SVG sources and the tokens) and D91.30's art share
(the companion's 2× strips, variants and provenance note). It consumes TH's
palettes (`pointer.json`, `icons.json`), recipe (`wallpapers.json`) and boot
values (`boot/boot.json`), all read, never copied by hand.

## Status

- [x] Research (formats verified against their own sources, below).
- [x] `@resvg/resvg-js` 2.6.2 (rule 9 record in PLAN.md D3).
- [x] Cursor sources, `scripts/build-cursors.mjs`, three themes, tests.
- [x] Icon sources, `scripts/build-icons.mjs`, four themes, tests.
- [x] Fonts (Inter + JetBrains Mono), fontconfig, `packages.conf`, notices.
- [x] Wallpapers and greeter art.
- [x] Plymouth and GRUB theme packaging.
- [x] Companion variants, manifest, provenance; flash measurement.
- [ ] Chromium looks (light + dark + boot).
- [ ] PLAN status, CHANGELOG, gates, red/green drills, LANE DONE.

## Sources read (research first)

- hyprcursor `MAKING_THEMES.md` + `hyprcursor-util/src/main.cpp` + `libhyprcursor`
  (cloned 2026-11-02, v0.1.13): the working state (`manifest.hl`/`.toml` +
  `hyprcursors/<shape>/{meta,images}`), compiled `.hlc` zips (meta + images
  at the zip root, UTF-8 names), the lib loading regular files only (dirs do
  not load), SVG-or-PNG per shape (never mixed), 1:1 aspect, animation as
  repeated same-size entries with a millisecond timeout, TOML allowed for
  every `.hl` file.
- libXcursor (`xcursor.h.in`, `file.c`, cloned 2026-11-02) and xcursorgen
  (`xcursorgen.c`): magic `0x72756358`, LE u32s, TOC + image chunks
  (type `0xfffd0002`, subtype = nominal size, width/height/hotspot/delay +
  ARGB pixels), premultiply with `div_255(x) = ((x + 0x80 + ((x + 0x80) >>
8)) >> 8)`, config lines `size xhot yhot file [delay]`, default delay 50.
- freedesktop icon-theme and icon-naming specs (fetched 2026-11-02):
  `index.theme` (`[Icon Theme]` + one section per directory, `Size` required,
  `Type=Scalable` with `MinSize`/`MaxSize`), the four contexts and their
  standard names.
- The rig's own `/usr/share/icons/Adwaita/cursors` symlinks (28 aliases,
  read 2026-11-02): the de-facto X11-to-freedesktop alias vocabulary, adopted
  except where a CSS shape we ship canonically contradicts it (`move`).
- The rig's Adwaita/Ubuntu status icons: the de-facto level names
  (`network-wireless-signal-*`, `network-cellular-signal-*`, `network-vpn*`,
  `bluetooth-*`, `battery-level-*`), adopted for the bar's indicators.
- GRUB 2.16 manual (Theme file format, `menuentry`) + `icon_manager.c` /
  `gui_list.c` (fetched 2026-11-02): global properties, component
  construction, `boot_menu`/`progress_bar`/`label`/`image` properties,
  `--class` icons from `icons/<class>.png` (hard-coded extension), scaled to
  `icon_width`/`icon_height`.
- Plymouth sources (cloned 2026-11-02): the `script` plugin's reference
  theme (`themes/script/script.script`: progress, message, password dialog
  with bullets, quit), the `.plymouth` descriptor (`[Plymouth Theme]` +
  `[script]` with `ImageDir`/`ScriptFile`), the C-verified call set
  (`Window.*`, `Image`/`Image.Text`/`Scale`/`Crop`, `Sprite` + `SetX/Y/Z`,
  `SetImage`, `SetOpacity`, `GetWidth/Height`, `Plymouth.Set*Function`),
  `SetDisplayPasswordFunction(prompt, bullets)` for the LUKS passphrase.
- Approved mockups (`docs/design/m111-mockups/`, viewer): the background
  language (`--ms-surface` + the giant squiggle-m watermark in
  `--ms-brand-mark` at 0.07 opacity) and the icon language (24-grid,
  `fill:none;stroke:currentColor;stroke-width:1.75;round caps/joins`).
- M114 (`design/tokens/README.md`, `design/fonts/README.md`): one token
  source, radius/spacing/motion scales, font preference defaults Inter +
  JetBrains Mono (which AR adopts for the image).

## Design decisions (the plan leaves these to AR)

1. **One rasterizer: pinned resvg.** `@resvg/resvg-js` 2.6.2 renders every
   PNG from the committed SVG sources, in-process and byte-deterministic
   (rendered twice here: identical bytes). Headless Chrome stays the
   second engine for the looks only. Build-time devDependency, never
   bundled.
2. **Cursors: three themes, background-agnostic art.** `Muse` (dark accent),
   `Muse-Large` (strokes ×1.5, same geometry and hotspots) and
   `Muse-HighContrast` (pure black/white, strokes ×2). Every element is an
   outline+fill pair, so one theme reads on light and dark alike; that is
   why there is no separate light theme. 34 CSS shapes (`auto` aliases
   `default`; `none` is the toolkit hiding the cursor, not a glyph) +
   28 X11 aliases as real copies (no symlinks: they break Windows
   checkouts). Xcursor carries 24/32/48/64/96 px per shape; hyprcursor is
   SVG (size ignored) with compiled `.hlc` zips (fixed timestamps,
   deflated, UTF-8 names, meta + images at the root, mirroring
   `hyprcursor-util --create`). `wait` and `progress` animate (8 frames,
   80 ms).
3. **Icons: four themes, one per appearance mode.** `Muse` (dark),
   `Muse-Light`, `Muse-HC-Dark`, `Muse-HC-Light`, from one SVG source set
   in the mockups' stroke language. Status carries the spec names plus the
   de-facto level sets the bar needs; apps, places and mimetypes carry the
   spec names the desktop uses plus our three app icons. SVG-only is valid
   per the spec (`Type=Scalable`); Qt (Svg module) and GTK (librsvg)
   render it.
4. **Fonts: Inter + JetBrains Mono, no Noto Sans/Mono.** The product's
   own defaults (M114 F), both OFL, both in Debian trixie (`fonts-inter`
   4.1, `fonts-jetbrains-mono` 2.304, verified on packages.debian.org
   2026-11-02). Noto Sans/Mono do not ship: the gate is green without them
   and `fonts-noto` is a pull-everything metapackage. The CJK and emoji
   faces stay. The slots are aliases in `59-muse-desktop.conf`: after
   49-sansserif (absent requests fall back to our UI face) and 50-user
   (the person's aliases accumulate first and keep winning), before
   60-latin (our faces accumulate first and win the requested generics).
   A strong match would hijack every request (49 appends weak sans-serif
   to all of them); an alias at 64 loses to 60-latin. Both proven below.
5. **Wallpapers follow the mockups + TH's recipe.** Base-to-deep wash, the
   brand gradient glow, the squiggle-m watermark at the mockups' opacity,
   at 1920×1080, 2560×1440 and 3840×2160 per mode. The greeter reuses the
   dark wallpaper language; SS consumes the files named here.
6. **Boot themes are complete in the repo, fonts bake at assembly.**
   `os/desktop/plymouth/muse/` (descriptor, script from `boot.json` values
   - logo/dialog art + TH's progress PNGs, byte-guarded) and
     `os/desktop/grub-theme/muse/` (`theme.txt` from `boot.json` values,
     background, `muse-*` class icons) are finished here; the GRUB `.pf2`
     bakes at image assembly from the pinned Inter (the bytes depend on the
     image's font version, so committing them would pin a lie). The bake
     command is proven on this rig and recorded here; QEMU boot proof is
     M111os/IQ's, per the plan.
7. **Companion: derive everything from the 1× strips.** The raw sheets
   stay outside the repo (lead's archive), so the 2× set is a Keys-bicubic
   upscale of the committed 1× strips — arithmetic only, bit-deterministic,
   and downsampling it reproduces the 1× paint within 1.2/255 per channel,
   so no re-prompt was needed. HC outline variants (white inner, black
   outer ring, 2 px each at 1× and 4 px at 2×, reads on any bar),
   reduced-motion stills (the median-area frame of loops, the peak-area
   frame of one-shots), the `variants.json` contract lane PE reads, the
   WCAG 2.3.1 flash measurement at manifest fps (all twelve compliant),
   and the provenance note in `os/desktop/notices/companion.md` (the VSIX
   notices file covers npm bundles only; this art never ships in it).
8. **No new strings.** Art carries no UI text; `check:l10n` stays at 0.

## Proof

- resvg 2.6.2 renders the same SVG to identical bytes twice (this rig,
  2026-11-02); `npm audit` implicates nothing in its tree (24 pre-existing
  moderates elsewhere).
- Cursors: `test/unit/desktop/artCursors.test.mjs`, 17 tests, all green
  (2026-11-02). Independent Xcursor/zip readers parse every committed file;
  the committed pixels match a fresh resvg render within premultiply
  rounding; the hotspot pixel is painted on the aimed shapes; the planted
  stale file is named and only it.
- Cursors vs the reference tools (Ubuntu .debs, 2026-11-02):
  `hyprcursor-util` 0.1.13 `--create` on a working state unpacked from my
  `.hlc` parses every meta (right override/size counts) and emits
  byte-identical contents. `xcur2png` 0.7.1 loads every image with the
  spec's sizes, hotspots and delays; its pixels match resvg's except full
  white, which that version renders black on Adwaita's own cursor too
  (tool quirk, reproduced on the control).
- Cursors caught by the drill: the first writer set the Xcursor
  header-length field to 76 (header + TOC); `xcur2png` then found 0
  images. libXcursor's own writer always sets 16 (its reader skips
  `header - 16`), so the writer now sets 16 and the test's reader asserts
  it. Recorded here so the regression stays dead.
- Icons: `test/unit/desktop/artIcons.test.mjs`, 45 tests, all green
  (2026-11-02). Every committed SVG renders to real paint; every painted
  colour is its mode's palette; the planted stale file is named and only
  it. `gtk-update-icon-cache` and `gtk4-update-icon-cache` both build a
  cache from the committed theme (exit 0, this rig).
- Icons caught by the build: the palette key is `warning` with an `accent`
  beside it (not `warn`); folders, home, the launcher mark and the
  workbench icon use the accent, functional blue stays info.
- Fonts: `test/unit/desktop/artFonts.test.mjs`, 7 tests, all green
  (2026-11-02). The gate's image set is pinned (Inter, JetBrains Mono,
  CJK ×4, emoji, with styles and packages); the shipped fontconfig parses
  as well-formed XML and binds the three slots to those faces with LCD
  rendering and no forced size or dpi; the notices name every face with
  its source package and the OFL.
- Fonts vs fontconfig itself (debs extracted without sudo, 2026-11-02):
  with only the image's four font packages visible (99 faces), the shipped
  `59-muse-desktop.conf` resolves sans-serif/serif to Inter Regular,
  monospace to JetBrains Mono Regular, bold requests to the Bold faces,
  and absent Arial/Times/Courier New to Inter/Inter/JetBrains Mono. The
  person's own XDG alias still wins (CJK over Inter). The alias-at-64
  draft lost to 60-latin (Noto Sans), and the strong-match draft hijacked
  direct requests (JetBrains Mono resolved to Inter) because
  49-sansserif.conf appends a weak sans-serif to every pattern; both
  drafts died here so the regressions stay dead.
- The real font gate is green on the image set: `node
scripts/check-font-coverage.mjs` with `FONTCONFIG_FILE` at the
  image-fidelity config and HarfBuzz 12.3.2 reports `13 fonts, 2688
codepoints; 0 problems` (exit 0, this rig, 2026-11-02).
- Wallpapers: `test/unit/desktop/artWallpapers.test.mjs`, 11 tests, all
  green (2026-11-02). One template, TH's recipe, 15 PNGs (four modes plus
  the greeter at 1920x1080, 2560x1440, 3840x2160): every committed PNG
  matches a fresh resvg render byte-for-byte, every PNG carries its
  claimed IHDR size, the corners are the wash (dark: exactly #181818 top
  and #242832 bottom) and the centre the glow, a repainted recipe moves
  the pixels (no hardcoded colours), and the greeter halves the glow and
  drops the mark to 0.05. The watermark math checks out: the mark pixel
  lifts its glow-symmetric mirror by exactly the 0.07 blend of #3d8bff
  (+2,+7,+13). The recipe's `rule` key is not painted: it is the focus
  colour SS's on-wallpaper UI reads from the same recipe.
- Boot: `test/unit/desktop/artBoot.test.mjs`, 11 tests, all green
  (2026-11-02). `os/desktop/plymouth/muse/` carries the descriptor, the
  script (TH's progress/message core plus the logo, the passphrase dialog
  with bullets and keyboard layout, quit and message hiding, after
  upstream's reference theme), the five dialog PNGs rendered from
  boot.json, and TH's two progress PNGs byte-identical. The script shows
  only packaged files, paints only boot.json colours (within float
  rounding) in Inter 13, registers seven callbacks that all name defined
  functions, and calls only the script API transcribed from upstream
  Plymouth b79b1786. `os/desktop/grub-theme/muse/` carries theme.txt (TH's
  colours and geometry plus the background, icon wiring and Inter faces),
  the background byte-identical to the dark 1080p wallpaper, and the
  32x32 muse class icon in brand paint. The first red drill missed: it
  renamed a callback argument the test did not check, so the suite stayed
  green; the test now proves every registered callback is defined, and
  the re-run drill fails exactly that test.
- GRUB bake drill (grub-mkfont 2.14, this rig, 2026-11-02): one style per
  file, because a two-file run merges the glyphs under one name (proven:
  Regular+Bold baked together name only "Inter Bold 16"). Assembly runs
  `grub-mkfont -o <theme>/fonts/inter-regular.pf2 -s 16
<fonts-inter>/Inter-Regular.otf` (94 KiB, names "Inter Regular 16")
  and the same for Bold (97 KiB, "Inter Bold 16"); M111os loadfonts both.
  No .pf2 is committed: the bytes depend on the image's font version.
  QEMU boot proof stays M111os/IQ's, per the plan.
- Companion: `test/unit/desktop/artCompanion.test.mjs`, 12 tests, all
  green (2026-11-02). 61 files from `scripts/build-companion-art.mjs`
  (in `check:art`): the 2x, HC, HC-2x and still sets at both scales plus
  `anim/variants.json`. Every derived PNG matches a fresh render
  pixel-exact (freshness compares pixels, not bytes: deflate bytes vary
  with the zlib build); the HC set keeps every source pixel and adds only
  pure black and white (walk: +15,768 white, +13,589 black, 0 other
  diffs); the stills are their recorded frames; the flash numbers match a
  fresh measurement and every animation is compliant (highest rate hop at
  3.00/s, largest area peek at 18,054 of the 87,296 threshold, zero red
  pairs). An independent numpy reimplementation of the flash method
  matches all twelve animations exactly.

## Commits

- `70545f0fe` research, design record, resvg 2.6.2 (+ PLAN.md D3 rule 9).
- `4c29dc13d` the pointer themes (`check:art` joins `quality:gates`).
- `27da2d767` the icon themes.
- `1eafb9798` the image fonts, slot-59 fontconfig and notices.
- `258307b35` the wallpapers and greeter art.
- `f7ac2afe8` the Plymouth and GRUB themes.
- (Companion commit SHA lands here at commit time.)

## Gates

- (Exit codes on the final tree.)

## Red/green drills

- (Each: break, non-zero exit, restore, green.)
- Fonts (2026-11-02): `Inter` → `Noto Sans` in the shipped
  `59-muse-desktop.conf` fails 2 of the 7 artFonts tests (the sans-serif
  prefer list and the image-fonts-only rule); restored, 7 green.
- Wallpapers (2026-11-02): the mark placeholder → `0.5` in the template
  makes `build-desktop-art.mjs --check` exit 1 naming all 15 PNGs;
  restored, exit 0 with 15 fresh.
- Boot (2026-11-02): the password registration → a missing callback fails
  the registrations test (10 of 11 pass); restored, 11 green. The drill's
  first run stayed green and grew the test (see above).
- Companion (2026-11-02): seven garbage bytes over a committed still make
  `build-companion-art.mjs --check` exit 1 naming only that file;
  restored, exit 0 with 61 fresh.
