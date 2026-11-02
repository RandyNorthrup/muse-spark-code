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
- [ ] Cursor sources, `scripts/build-cursors.mjs`, three themes, tests.
- [ ] Icon sources, `scripts/build-icons.mjs`, four themes, tests.
- [ ] Fonts (Inter + JetBrains Mono), fontconfig, `packages.conf`, notices.
- [ ] Wallpapers and greeter art.
- [ ] Plymouth and GRUB theme packaging.
- [ ] Companion variants, manifest, provenance; flash measurement.
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
  `--ms-brand-mark` at 8–9%) and the icon language (24-grid,
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
4. **Fonts: Inter + JetBrains Mono.** The product's own defaults (M114 F),
   both OFL, both in Debian trixie (`fonts-inter` 4.1, `fonts-jetbrains-mono`
   2.304, verified on packages.debian.org 2026-11-02). The font-coverage
   gate decides whether Noto Sans/Mono stay; the CJK and emoji faces stay
   regardless.
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
7. **Companion: build what this rig can prove.** HC outline variants (black
   - white double outline, reads on any bar), reduced-motion stills (the
     median-area frame of loops, the peak frame of one-shots, measured
     below), the `variants.json` contract, the flash measurement at manifest
     fps, and the desktop-section provenance text. 2× strips need the raw
     sheets (lead's Kubuntu archive) or a fresh model generation: neither is
     available in this lane, so they stay open for the lead.
8. **No new strings.** Art carries no UI text; `check:l10n` stays at 0.

## Proof

- resvg 2.6.2 renders the same SVG to identical bytes twice (this rig,
  2026-11-02); `npm audit` implicates nothing in its tree (24 pre-existing
  moderates elsewhere).
- (Per-part proof lands with its commit, below.)

## Commits

- (Landed commits, with their part.)

## Gates

- (Exit codes on the final tree.)

## Red/green drills

- (Each: break, non-zero exit, restore, green.)
