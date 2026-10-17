# The desktop companion: research for an opt-in pet in Muse Desktop (2026-10-06)

Research for an opt-in companion character that lives at the bottom of the
screen in Muse Desktop (D91, M111: Qt 6 Quick on Hyprland, Debian 13), keeps
out of the way, and answers questions. Facts were checked on 2026-10-05 (the
date of the research run; the file is named for the 2026-10-06 plan round).
Every outside fact names its source in §11. Nothing here is built. No model
was called, nothing was installed and nobody was signed in to write it.

**Amended 2026-10-06 (the lead), in PLAN D91.30:**

- **The art is sprite strips, not a part rig.** This replaces §2.2's and
  §2.4's recommendation. The owner rejected the hand-drawn rig. The
  character is now twelve strips cut from sheets generated from his own
  sheet; `design/companion/README.md` records how they were made. Qt
  Quick's `AnimatedSprite` plays them. §2.3's reasoning against Lottie and
  Rive stands. Spike C1 becomes "the strips in `AnimatedSprite`, side by
  side with the preview".
- **Open question 6 is decided:** the status bar is lane SH1's layer
  surface, and the workbench feeds it its items (§3.4, option A).
- **Owner questions 1–5** are now PLAN Q-M111 items 7–10. Defaults: "the
  companion" until he names it; keep the belly mark after a look-alike
  check; text only; offered in onboarding and off until chosen; peeking,
  tucking while sharing and agent reactions on once he turns it on.

## 0. The recommendations in one place

| Question               | Recommendation                                                                                                                                                                                                                                                                                                                                        | Section  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Character              | The owner's own electric penguin, rigged from the lead's SVG prototype. No Meta character, name or art                                                                                                                                                                                                                                                | §1, §2.6 |
| How parts ship         | **Pre-rasterised part layers at 1× and 2×** (and 3× for scale above 2), cut from the SVG rig at build time, plus a small `parts.json` of pivots and z-order. Qt Quick Shapes (`PathSvg`, CurveRenderer) only for effects that must stay crisp at any size, such as the beams                                                                          | §2.2     |
| Animation engine       | **Native QML**, driven by one keyframe timeline exported from the prototype and stepped by a `Timer`. No Lottie: Qt Lottie Animation is GPL-3.0 only (excluded by D91.4's amendment), and the LGPL Lottie path needs Qt 6.10, which Debian 13 lacks. No Rive: a third-party plugin and a proprietary authoring tool                                   | §2.3     |
| Cost                   | Nothing animates while it sits still: zero frames per second at idle. Short micro-actions. Walking capped at 24–30 frames per second by stepping, never at the display's rate. Animate part transforms, never path data                                                                                                                               | §2.4, §5 |
| Surface                | A **LayerShellQt** surface on the **Top** layer (never Overlay), namespace `muse-companion`, keyboard interactivity **None**, click-through outside the character through Qt's input mask                                                                                                                                                             | §3       |
| Sitting above the bar  | A separate small layer surface with exclusive zone 0, so the compositor stacks it just above a bar that has a positive exclusive zone. Hiding and peeking happen by sliding the rig below its own surface's bottom edge, which is the bar's top edge, so it looks as if it goes behind the bar. This needs the status bar to be a shell layer surface | §3.4     |
| Walking                | A small surface moved by its margin, if Hyprland applies margin changes smoothly; otherwise a full-width strip with an input mask. Spike C3 decides                                                                                                                                                                                                   | §3.5     |
| Staying out of the way | Unmap on fullscreen, while a screen share runs, in Do Not Disturb, focus or presenting mode, under reduced motion (no peeks or walks), and at the governor's throttle level. Excluded from every capture by `no_screen_share`. Sleep after inactivity. Never takes focus. Never covers the composer, the caret or the terminal prompt                 | §4       |
| Answering              | The user's chosen backend through the harness, in a dedicated "Companion" session with an answers-only tool profile, and **Continue in chat** to hand off. Instant answers from the `/help` reference first. A small local model only as an opt-in pull. The local judge only for triage, never for answers. Never answers an approval                | §6       |
| Voice                  | Text first. Push-to-talk as the first voice mode, with the bar's microphone indicator and a "Listening" pose with a text label. A wake word only as a separate opt-in, local, with an always-visible indicator. Each engine waits on the owner's ruling, because his M9 voice rules forbid third-party engines and API cost                           | §6.3     |
| Accessibility          | A text-only mode (no character, the same ask box and answers), a keyboard summon, `Accessible.announce` for answers, high-contrast outline, reduced motion from the desktop's one setting, and flash limits under WCAG 2.3.1                                                                                                                          | §7       |
| Hyprland access        | Through the existing `CompositorPort` (one IPC client for the whole shell), extended with per-monitor fullscreen, active-window geometry, on-demand cursor position and share state. The companion never asks for screencopy                                                                                                                          | §4.1     |

## 1. The owner's words and the scope

The owner asked first for "an opt in optional desktop pet that lives at the
bottom of the screen intelligently stays out of the way but is there to answer
your questions like muse the meta character". He then narrowed it: "this would
only be for in the os". Then he decided: "lets skip straight to just creating
our own cute character". He supplied that character himself: an electric
penguin, charcoal with a cream face and belly and a white penguin mark on the
belly, orange ear tufts, beak and toe claws, blue armour plates with yellow
lightning bolts, glowing cyan nodes on the flippers and collar, and lightning
powers (charging, and beams from the flipper tips). He wants it to walk, do
different things, and peek up now and then from behind the status bar while
it is hidden. The lead has an SVG rig prototype with separately animated parts
(feet, flippers, beak, eyes, tufts and the lightning effects).

So the scope is Muse Desktop only. The VS Code extension, the companion page,
other editors and Windows or macOS trays are out of scope.

**What was found before the scope changed, recorded and dropped.** Meta's
Muse assistant has a default avatar called Jolly, a cream plush creature shown
at Meta Connect 2026. The gadget SDK ships a "Jollybot avatar" whose files the
SDK's README says "the Apache License does not cover". The Gadget SDK token
terms allow "personal, non-commercial use with your own Muse account". They
forbid any device "that you advertise, offer, or list publicly or through any
marketplace or application store", and say "You may not represent in any way
that the device is made by or endorsed by Meta". The Linux gadget service gives
the cloud assistant `system.run`, `file.read` and `file.write` with the
installing account's rights, and its pairing "can't prevent an active
man-in-the-middle attack". So none of it is usable for a shipped OS feature, and
D71's "never a gadget" rule stands (§11, group M).

## 2. The character as a Qt Quick rig

### 2.1 Parts and pivots

The prototype's parts map onto one QML item each, nested so that a parent's
transform carries its children. Each part has a pivot: the point it rotates
about.

| Part                           | Pivot                         | Typical motion                                    |
| ------------------------------ | ----------------------------- | ------------------------------------------------- |
| Body (root of the rig)         | between the feet              | waddle roll (±4°), bob, squash on landing, mirror |
| Belly and belly mark           | fixed to the body             | none; the mark is counter-mirrored (§2.4)         |
| Head (face, beak, eyes, tufts) | neck                          | tilt, glance, peek                                |
| Eyes (lids as a separate part) | eye centre                    | blink (lid scale), gaze (pupil translate)         |
| Beak (upper and lower)         | hinge                         | open while "speaking" or "charging"               |
| Ear tufts (left, right)        | tuft root                     | twitch, perk up for "listening"                   |
| Flippers (left, right)         | shoulder                      | swing while walking, raise to charge or beam      |
| Feet with claws (left, right)  | heel                          | step cycle                                        |
| Armour plates and bolts        | fixed to the body or flippers | brighten while charging                           |
| Cyan nodes (collar, flippers)  | fixed                         | glow (opacity of a pre-rendered halo)             |
| Beams and sparks               | flipper tip                   | short effect sequences (§2.5)                     |

States the rig needs, as a small state machine: `asleep`, `idle`, `walk`,
`peek`, `listening`, `thinking`, `speaking`, `happy`, `concerned`, `charge`,
`beam`, `tucked` (unmapped). Idle actions ("doing different things") are
short timelines played from `idle`: preen, look around, sit, stretch a
flipper, a tiny spark between the flippers, a yawn before `asleep`.

### 2.2 Three ways to ship the parts

| Way                                                                         | How                                                                                                                                                                                                                                              | Cost per frame                                                                                                                                                                                                                                                                                                                        | Fit                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pre-rasterised layers** (recommended)                                     | A build script renders each part's SVG group to PNG at 1× and 2× (3× above scale 2), trimmed, with its pivot and z-order in `parts.json`. QML shows each as an `Image` with `sourceSize` set, picking the set by the screen's `devicePixelRatio` | One textured quad per part. Qt Quick puts small images in a texture atlas, so the rig batches into few draw calls                                                                                                                                                                                                                     | Cheapest on the Pi 4 and 5 (V3D) and on integrated GPUs. Fractional scales (1.25, 1.5) use the 2× set scaled down with smoothing and mipmaps                                                                                                            |
| Qt Quick Shapes (`Shape`, `ShapePath` with `PathSvg`)                       | Each part's path data in QML; `preferredRendererType: Shape.CurveRenderer` for GPU curves and anti-aliasing                                                                                                                                      | Qt's docs: geometry generation "happens entirely on the CPU" and any change to path elements or their properties leads to "retriangulation of the affected paths on every change". Transforms of the item do not retriangulate. The Qt 6.8 blog notes a "more complex geometry and fragment shader than simple textured quad display" | Crisp at any scale. Good for the beams and bolts. Heavier per pixel than a quad                                                                                                                                                                         |
| `svgtoqml` at build time (Qt 6.8, `qt6-declarative-dev-tools` in Debian 13) | Converts each part's SVG to a QML file of Shapes (`--curve-renderer`, `--optimize-paths`)                                                                                                                                                        | As Shapes                                                                                                                                                                                                                                                                                                                             | Saves hand-writing paths. It "supports most of the static features of the SVG Tiny 1.2 profile"; "Interactive features and animations are not supported", so the prototype's animation does not carry over, and SVG filters (glow, blur) must be redone |

**Recommendation:** pre-rasterised layers for the body parts, and Shapes only
for the beams and sparks, whose paths are short. One source stays true: the SVG
rig. The build step emits the PNG sets, `parts.json` and the timeline (§2.3),
and a check fails the build if a part in the SVG has no pivot or a state names
a part that does not exist. The rasteriser runs at build time only (for example
`rsvg-convert` from librsvg) and ships nothing.

### 2.3 The animation engine: native QML, not Lottie or Rive

| Engine                                      | Licence and availability on Debian 13 (Qt 6.8.2)                                                                                                                                                                                                                | For                                                                                         | Against                                                                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Native QML** (recommended)                | Qt Quick, LGPL-3.0 (D91.4's amendment)                                                                                                                                                                                                                          | Parts animate exactly as in the prototype; states and transitions in QML; no new dependency | We write a small timeline player                                                                                                                                   |
| Qt Lottie Animation                         | "available under commercial licenses from The Qt Company. In addition, it is available under the GNU General Public License, version 3" (Qt 6.8 docs). Debian ships `qt6-lottie` 6.8.2                                                                          | Designer tools export Lottie                                                                | GPL-only, which D91.4's amendment already excludes. Qt's own blog says it renders through QPainter (software) and has not had feature updates since it was created |
| VectorImage's Lottie backend, `lottietoqml` | Qt 6.10, "tech preview" (Qt 6.10 notes)                                                                                                                                                                                                                         | GPU-rendered Lottie through Qt Quick                                                        | Not in Debian 13's Qt 6.8.2; a preview                                                                                                                             |
| Rive                                        | `rive-runtime` (C++) is MIT. Qt integrations are community plugins: RiveQtQuickPlugin2 (MIT, Qt 6.6 and newer), rive-qt-plugin (MIT), basysKom's RiveQtQuickPlugin (LGPL-3.0 or later). Read from search listings; the plugin pages themselves were not fetched | State machines suit an interactive character                                                | A third-party renderer inside the shell; `.riv` files are made in Rive's own editor, a hosted product; one more thing to pin and audit                             |

**The timeline format** is neutral JSON: for each state or idle action, a list
of tracks `{part, property, keys: [{t, value, ease}]}` with `property` one of
`x`, `y`, `rotation`, `scale`, `opacity` and `frame` (for sprite-strip
effects). The web prototype and the QML player read the same file, so the
motion is designed once.

### 2.4 Driving the rig cheaply

- **Step the timeline; do not run animations at the display's rate.** Qt
  Quick renders only when something calls for an update, and "animations are
  now synchronized with rendering" (Qt 6 scene graph docs). A running
  `NumberAnimation` therefore asks for a frame on every vsync: 60 a second, or
  144 on a 144 Hz monitor. Instead, one `Timer` at the state's rate (24–30 per
  second while walking, 12 for effects, nothing while still) samples the
  timeline and sets the part properties. Frames then follow the timer, whatever
  the monitor's rate. Easing is computed in the sampler.
- **Still means still.** No breathing loop at idle. A blink is about 150 ms,
  every 2–6 seconds at random, and costs a handful of frames. Spike C4 measures
  whether a blink at 12 steps a second reads well enough.
- **Transforms, never paths.** Move, rotate, scale and fade parts. Never
  animate `PathSvg` data, which retriangulates on the CPU on every change.
- **Mirror the rig, not the mark.** Walking left is `Scale { xScale: -1 }` on
  the body. Any mark on the belly (the owner's penguin mark, or our squiggle-m
  if he picks it, §2.6) gets a counter-flip, or a squiggle-m would read
  backwards.
- **Stop everything while unmapped.** The timer stops whenever the surface is
  hidden, tucked, asleep or under reduced motion.

### 2.5 Effects: charging, beams and glow

- **Glow** on the cyan nodes is a pre-rendered halo PNG whose opacity changes.
  `MultiEffect` blur or shadow would add offscreen render passes on every frame.
- **Charging** is a short sequence: the plates' bolts brighten, the nodes pulse
  two or three times, the tufts perk up.
- **Beams** from the flipper tips are a strip of 6–8 pre-drawn bolt frames
  played at 12 a second, or a Shape polyline with a few jittered points
  regenerated at the same rate (a short path, so the retriangulation is cheap).
- **Flash safety (WCAG 2.2 SC 2.3.1, level A):** nothing may flash "more than
  three times in any one second period" unless the flash is "below the general
  flash and red flash thresholds" (an area limit of about a 341 × 256 px
  rectangle at 1024 × 768). The rule: at most 3 bright pulses a second, beams
  short and small, and no saturated red. Under reduced motion there are no
  beams or pulses at all; a static "charged" pose replaces them.

### 2.6 Design cautions for the art

- **Ours alone.** No resemblance to Meta's Jolly, no Muse name and no Meta
  marks. In public the OS is "Muse Node OS (Unofficial)" (rule 11); the
  companion needs its own name (§10).
- **Tux.** A charcoal penguin with a pale belly and an orange beak and feet
  recalls Linux's Tux. That is fine: Larry Ewing's licence reads "Permission
  to use and/or modify this image is granted provided you acknowledge me
  lewing@isc.tamu.edu and The GIMP if someone asks". Ours is an original
  design anyway; the licence matters only if Tux's own art is used.
- **Other penguins.** An electric penguin in blue armour should be checked by
  eye against well-known characters, such as the penguin line in a large
  monster-collecting franchise, before it ships. The "white penguin mark on
  the belly" should not resemble a publisher's penguin logo. Replacing it with
  our squiggle-m mark avoids the question (§10).
- **Branding rule.** Never the four-point sparkle, in any effect: sparks,
  glints and charge-up stars use bolts, dots or rings instead.

## 3. The surface on Wayland

### 3.1 LayerShellQt on Debian 13

Debian 13 (trixie) ships `layer-shell-qt` 6.3.4 with Qt 6.8.2 and Hyprland
0.55.2 from trixie-backports. LayerShellQt's `window.h` at v6.3.4 carries
`SPDX-License-Identifier: LGPL-2.1-only OR LGPL-3.0-only OR
LicenseRef-KDE-Accepted-LGPL`. Its `LayerShellQt::Window` (also a QML attached
type, `org.kde.layershell`) offers:

- `setAnchors`, `setExclusiveZone`, `setExclusiveEdge`, `setMargins`,
  `setKeyboardInteractivity` (None, Exclusive, OnDemand), `setLayer`
  (Background, Bottom, Top, Overlay), `setScope` (the namespace, which Hyprland's
  layer rules match), `setScreenConfiguration`, `setCloseOnDismissed`.
- **Not in 6.3.4** (present on master): `setScreen`,
  `setWantsToBeOnActiveScreen`, `setDesiredSize`, `setActivateOnShow`. On
  6.3.4 the output comes from `QWindow::screen()` (`ScreenFromQWindow`, the
  default), and the size is the window's size.

The protocol (`zwlr_layer_shell_v1` version 5) takes the output only when the
surface is created ("You may pass NULL for output to allow the compositor to
decide"). There is no request to change it, so moving to another monitor
means a new surface (§3.6).

### 3.2 Which layer: Top, never Overlay

- **Overlay costs games and video their direct scanout.** Hyprland refuses
  direct scanout for a fullscreen window "whenever any overlay-layer surface
  exists on that output", whether or not it draws anything. The report
  (omapager #30, 2026-09-21, Hyprland 0.56.2's `isSolitaryBlocked`) measured
  about 3% more frames (147.8 against 152.5) and 16 W less GPU power with the
  overlay hidden.
- **A hidden Top surface can still eat clicks.** A bar hidden behind a
  fullscreen window kept taking the clicks in its strip (omarchy #14079,
  2026-10-02). The issue's own analysis, which is not yet confirmed: Hyprland
  fades Top layers out under fullscreen and skips layers whose alpha is 0 in
  hit-testing, and a bar with `no_anim` never reached alpha 0.
- **Hyprland may change Top's behaviour.** Draft pull request #15937 ("Top
  layers go below fullscreen windows") adds
  `misc:allow_new_top_layers_over_existing_fullscreen`.
- **So:** the companion is a Top surface and is **unmapped** (the QWindow
  hidden, no buffer) whenever its monitor shows a fullscreen window. It never
  relies on Hyprland's fade, and it neither blocks scanout nor takes clicks.

### 3.3 Click-through: the input region in Qt Wayland 6.8.2

The protocol: "If you do not want to receive them, set the input region on your
surface to an empty region". Qt Wayland 6.8.2 (`qwaylandwindow.cpp`,
`updateInputRegion`):

- `QWindow::setMask(region)` becomes `wl_surface.set_input_region(region)`.
- The `Qt::WindowTransparentForInput` flag sends an **empty** region: fully
  click-through.
- **Gotcha:** an empty `QRegion` mask without that flag sends `nullptr`, which
  means the whole surface takes input. "Nothing clickable" must use the flag,
  never an empty mask.

The companion's mask is its body's bounding shape: a few rectangles following
the rig, updated when it moves, and never larger. QML has no mask property on
`Window`, so a small C++ helper sets it from an item, as Quickshell's
`mask: Region { item: … }` does (spritepet's notes).

### 3.4 Above the status bar, and hiding or peeking behind it

**Where the bar is today.** In PLAN.md the full-width status bar belongs to
the Electron workbench (D91.13's amendment, lane WB: "the status bar across
the whole desktop"). It is part of an ordinary window, not a layer surface.
The top menu bar is a layer surface (D91.8).

**The protocol's stacking rule for exclusive zones:** "If set to zero, the
surface indicates that it would like to be moved to avoid occluding surfaces
with a positive exclusive zone". Its own example is a notification that sets 0
"so that it is moved to avoid occluding the panel". Within one layer,
"ordering within a single layer is undefined", and Hyprland's `order` layer
rule sets space-reservation priority, not drawing order.

| Option                                                                                                | How it hides and peeks                                                                                                                                                                                                                      | For                                                                                  | Against                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Its own small layer surface, exclusive zone 0, stacked above a bar layer surface** (recommended) | The surface's bottom edge is the bar's top edge. The rig slides down past that edge and is clipped by the surface, so it seems to go behind the bar. A peek shows the tufts and eyes for 1.5–3 s, then it ducks and the surface is unmapped | No reliance on drawing order. Small buffers. The bar never redraws for the companion | Needs the status bar as a shell layer surface with a positive exclusive zone. The rig can never overlap the bar itself (no toes over its edge)                                                                                 |
| B. Drawn inside the bar's own Qt Quick scene                                                          | The bar's surface is taller than its exclusive zone (the bar strip plus room for the rig). Bar items draw above the rig in one scene graph: true "behind"                                                                                   | Real overlap; one surface                                                            | Every companion frame redraws the whole full-width bar surface. The bar's input mask must add the rig. A companion fault sits in the bar's own window                                                                          |
| C. A `wl_subsurface` of the bar's surface, placed below it                                            | True z-order behind the bar with its own buffer                                                                                                                                                                                             | Overlap without redrawing the bar                                                    | Qt Wayland 6.8.2's client sends `set_sync` and `set_desync` for subsurfaces but never `place_below`, so we would write it as an extension. Hyprland's handling of a subsurface below and outside a layer surface is unverified |
| D. Overlay layer above a Top bar, or same-layer stacking                                              | Draw over the bar                                                                                                                                                                                                                           | Simple                                                                               | Overlay blocks direct scanout (§3.2). Same-layer order is undefined by the protocol                                                                                                                                            |
| E. Keep the Electron bar and set a bottom margin equal to its height, reported over the bridge        | As A, with the margin in place of the exclusive-zone stacking                                                                                                                                                                               | No change to lane WB                                                                 | Holds only while the workbench is maximised on that monitor. On any other desktop (a browser, a terminal) there is no bar to sit on                                                                                            |

**Recommendation: A**, which needs one change from the lead. The status bar
the owner described ("the status bar should span the entire bottom of the
desktop") becomes a shell layer surface: Qt Quick, anchored bottom, left and
right, with a positive exclusive zone, owned by lane SH1. The workbench feeds
its items over the desktop bridge. That makes the bar desktop-wide on every
workspace, which is what the owner said, and gives the companion a stable edge.
If the lead keeps the bar in Electron, E is the fallback, and the companion
sits at the screen's bottom edge on desktops without the workbench. Spike C2
confirms that Hyprland 0.55.2 stacks an exclusive-zone-0 Top surface above a
bottom bar, and tries C as the upgrade path.

**While tucked**, the surface is unmapped and costs nothing. A small bolt
item in the status bar summons it, and shows a dot when it has something for
the user.

### 3.5 Walking along the bar

| Way                                                                                        | For                                                                                           | Against                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Small surface (about the rig's size) moved by `setMargins`** (try first)                 | Small buffer; the compositor recomposites a small area; the idle cost is the same as standing | Each step is `set_margin` plus a commit, and Hyprland re-arranges the monitor's layers. Whether the position and the new frame land in the same commit through LayerShellQt and Qt Quick's render thread is unknown: a jitter risk |
| Full-width strip (anchored left, right and bottom), the rig moving inside, mask on the rig | Smooth by construction; one configure                                                         | The documentation found shows no partial-update path in Qt Quick, so a frame redraws and recomposites the whole strip: a 1920 × 160 px strip is about 12 times the pixels of a 160 × 160 surface, more again on 4K or at scale 2   |

The walk path is the bar's top edge. It skips **keep-out ranges** the
workbench publishes over the bridge: the chat composer, the terminal panel's
prompt line, and the focused caret's column. The companion never stops in one;
to cross one it ducks behind the bar and pops up on the far side. Walks are
short bouts (proposed: at most 10 s, at 60–90 px/s; qs-vpets' default speed
is 120 px/s), triggered by a reason: moving away from the active window, the
user's "come here", or a short wander while the user is idle (§4.4).

### 3.6 Several monitors

- One companion, on one monitor at a time: its "home" (the workbench's monitor
  by default), or following the focused monitor if the user turns that on
  (Hyprland's `focusedmonv2`).
- Moving monitors means unmapping and creating a new surface on the target
  `QScreen`, because the layer surface's output is fixed at creation (§3.1).
  On `monitorremoved` (or the protocol's `closed` event, which LayerShellQt's
  `setCloseOnDismissed` handles), it recreates itself on a remaining monitor.
- Mixed scales: the part set (1×, 2×, 3×) is chosen per screen's
  `devicePixelRatio` when the surface is created.

### 3.7 Focus and the keyboard summon

- The companion surface is `KeyboardInteractivityNone` always, so it can never
  take focus from the user's work.
- **The ask box** is a separate short-lived layer surface on the Top layer
  with `KeyboardInteractivityExclusive`, as launchers do. It closes on Esc,
  on Enter after sending, or on a click elsewhere, and focus returns to the
  window that had it. LayerShellQt 6.3.4 lacks `setActivateOnShow`, so
  Exclusive is the reliable way to take focus at once (spike C5).
- **The summon key** is a binding in our generated Hyprland configuration
  that calls the shell through the `CompositorPort` or Hyprland's `global`
  dispatcher ("Activate a D-Bus global shortcut"). The key is chosen in the
  generated key table, whose duplicate-binding check (lane CP) keeps it from
  colliding with others.

## 4. Staying out of the way

### 4.1 What Hyprland tells us

Hyprland has two sockets under `$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/`:
`.socket.sock` for requests and `.socket2.sock` for `EVENT>>DATA` lines. The
wiki warns that requests are evaluated "completely synchronously", that any
unclosed connection "will cause Hyprland to freeze" until a five-second
timeout, and recommends "limiting the amount of info calls". The shell's
`CompositorPort` adapter (D91.3, research §2.2) already owns both sockets. The
companion consumes the port's events and never opens its own connection.

| Need                       | Source (Hyprland 0.55.2 source and the current wiki)                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active window changed      | `activewindowv2>>WINDOWADDRESS`; then one `j/activewindow` query for its `at` and `size`                                                                                                                       |
| Fullscreen on a monitor    | `fullscreen>>0/1` (the wiki: "A fullscreen event is not guaranteed to fire on/off once in succession"); then `j/workspaces` for each workspace's `hasfullscreen`, or `j/clients` for `fullscreen`              |
| Screen share or screencopy | `screencast>>STATE,OWNER` and `screencastv2>>STATE,OWNER,NAME` ("owner is monitor/window/region"). In Hyprland's current source, each screencopy session posts both once when it starts and once when it stops |
| Monitors                   | `monitoraddedv2`, `monitorremovedv2`, `focusedmonv2>>MONNAME,WORKSPACEID`                                                                                                                                      |
| Cursor position            | No event. `cursorpos` is a request: "gets the current cursor position in global layout coordinates"                                                                                                            |
| Our own layer              | `openlayer>>NAMESPACE`, `closelayer>>NAMESPACE`; `j/layers` lists namespaces                                                                                                                                   |
| User idle                  | Not Hyprland IPC: `ext-idle-notify-v1`, version 2 since Hyprland 0.52.1. `get_input_idle_notification` reports input idleness while "ignoring idle inhibitors". It carries no key contents                     |

The port gains: per-monitor fullscreen, active-window geometry, a throttled
on-demand cursor sample, and share state (§4.3). It never passes window titles
to the companion: geometry and a coarse app class only.

**The cursor.** Polling `cursorpos` is a synchronous request, so it runs only
while the companion is up (not tucked), only while the pointer's monitor is the
companion's, and at most 4 times a second. Most of the time the pointer-enter
event on the companion's own input region is enough: a hover of about 300 ms
without a click means "you are in the way", and it steps aside or ducks.

### 4.2 Fullscreen

On any fullscreen window on its monitor, the companion unmaps at once (§3.2),
and returns 2 s after fullscreen ends. Games, video, slideshows and the
desktop's own "Presenting" mode all go fullscreen, so this one rule covers
most of them.

### 4.3 Screen sharing, screenshots and presenting

- **Never in a capture.** Our generated Hyprland config gives the
  `muse-companion` namespace the layer rule `no_screen_share` ("Hides the layer
  from screen sharing"), so its bubbles and answers are not broadcast.
  Spike C6 checks whether screenshots through screencopy honour it too, and
  covers the ask box's namespace as well.
- **And out of sight while sharing** (a setting, on by default): it tucks
  away for the length of any share, so the presenter is not distracted either.
- **Which signal.** Our own desktop-pill thumbnails take screencopy frames
  (D91.15, rate-limited by `DESKTOP_THUMBNAIL_FPS`), and `screencast` carries
  no process id. The thumbnails could therefore look like a share. The
  companion follows the **same share state as the bar's screen-sharing privacy
  indicator** (D91.8): portal ScreenCast sessions (our shell draws the picker)
  and capture by other clients, minus the shell's own thumbnailer. Spike C6
  confirms on 0.55.2.

### 4.4 Behaviour rules

| Situation                                                                         | Behaviour                                                                                                                                                 |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First run                                                                         | Off. Offered in onboarding and in settings ("opt in optional": the owner's words)                                                                         |
| User typing or pointing (input not idle)                                          | Still. No walks, no peeks. Blinks only                                                                                                                    |
| Short pause in input (input idle ≥ 10 s, from `ext-idle-notify`)                  | The only time an unprompted peek or wander may happen                                                                                                     |
| Long inactivity (proposed 5 min; qs-vpets uses 300 s, deskpet sleeps after 120 s) | Falls asleep: one static frame, zero frames per second                                                                                                    |
| The active window under it, or the pointer approaching                            | Steps aside along the bar, or ducks behind it                                                                                                             |
| Keep-out ranges (composer, terminal prompt, caret)                                | Never stops there; crosses them hidden                                                                                                                    |
| Fullscreen, a share running, the screen locked                                    | Unmapped                                                                                                                                                  |
| Do Not Disturb (the notification server's, D91.10), focus or presenting mode      | Tucked. No bubbles, no peeks. Questions still work by summon                                                                                              |
| The camera or microphone in use by another app (the bar's privacy indicators)     | Tucked and silent (a call is likely)                                                                                                                      |
| Unprompted tips                                                                   | Off by default. If on: only at natural breakpoints (a turn finished, a check passed), a daily cap, and "don't show this kind again" on each               |
| Agent events (a turn finished, an approval waiting)                               | Off by default. If on: a small, silent reaction. For an approval it points to the app; **it never answers an approval** (D91.10's rule for notifications) |
| "Go away"                                                                         | For an hour, until tomorrow, or off. One click from its menu                                                                                              |
| Attention-seeking                                                                 | None. No "lonely" mechanic (deskpet's pets get "a bit lonely" after 10 minutes), no sounds by default, no escalation                                      |

### 4.5 What existing pets teach (licences read 2026-10-05)

| Project                             | Licence                                  | Technique                                                                                                                                                                                                                      | Lesson for us                                                                                                                |
| ----------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| qs-vpets (Quickshell, Hyprland)     | MIT                                      | Drive-based behaviour (rest, explore, social, comfort, play); "naps when you're idle"; "naturally retreats from fullscreen content"; reacts to window focus, workspaces and the cursor; `idleTimeout` 300 s                    | Hyprland-aware behaviour in QML is proven. Its "follow your cursor when they want attention" is the opposite of what we want |
| deskpet (GTK 3, gtk-layer-shell)    | MIT                                      | One transparent overlay per monitor whose "input region is only the pet's visible pixels"; "It never takes keyboard focus"; "It respects bars' reserved space"; chat through a local Ollama model that unloads after 5 minutes | Confirms the input-region pattern. Its full-monitor overlay is the costly variant of §3.5                                    |
| spritepet (Quickshell)              | MIT                                      | Parametric motion on a still image (bob, sway, hop); idle hops every 20–34 s; `mask: Region { item: … }`                                                                                                                       | Cheap motion from transforms                                                                                                 |
| wayland-vpets                       | MIT                                      | "Auto-hides in fullscreen apps"; idle and scheduled sleep (`idle_sleep_timeout`, 22:00–06:00); reacts to CPU. Reads the keyboard from `/dev/input` and needs the `input` group                                                 | **Do not copy:** raw input access is keylogger-class. We use `ext-idle-notify` and see no keys                               |
| wayneko                             | GPL-3.0 (bitmaps from the public domain) | "An animated neko cat on the bottom of an output" through layer shell                                                                                                                                                          | The bottom-edge placement has precedent. GPL: read for ideas, do not copy code                                               |
| Shijima-Qt                          | GPL-3.0; archived 2026-04-29             | Shimeji on Qt 6; Wayland window tracking on KDE Plasma 6 and GNOME 46 only                                                                                                                                                     | Qt 6 pets work; desktop-specific window tracking is fragile                                                                  |
| VPet, BongoCat, WindowPet, oneko.js | Apache-2.0, Apache-2.0, MIT, MIT         | Windows/web pets (WPF, Tauri, a browser)                                                                                                                                                                                       | Reference for animation sets only                                                                                            |

### 4.6 What the Office Assistant teaches

Horvitz's "Principles of Mixed-Initiative User Interfaces" (CHI '99) comes from
the Lumière work that, by his own account, became the basis of parts of the
Office '97 Assistant. Among its principles: consider "the status of a user's
attention in the timing of services", minimise "the cost of poor guesses about
action and timing", and allow efficient dismissal. The rules in §4.4 follow
them. The companion speaks when spoken to, offers at breakpoints only if the
user opted in, and goes away in one click. The quotes are from search
listings of the paper, not a fresh read of the PDF.

## 5. Cost: CPU, GPU, battery and the M107 governor

### 5.1 How Qt Quick spends frames

- **No frame without a change.** A frame starts when "a change occurs in the
  QML scene, causing `QQuickItem::update()` to be called" (Qt 6 scene graph
  docs). A still companion therefore renders nothing.
- **Animations follow vsync.** The threaded loop advances animations "during
  the preparation of a frame", so a running animation renders at the monitor's
  rate. §2.4's stepped timer caps that.
- **A frame redraws the window.** The documentation found shows no
  partial-update mechanism, so the surface's size multiplies every frame's
  cost (§3.5).
- **Pi light profile.** The Pi 4 and 5 (V3D) clear Hyprland's GLES 3.0 floor
  (research §2.3); speed is the open question. Textured quads beat curve
  shaders there (§2.2).

### 5.2 Idle and walking, and what to measure

Expected profile (to be measured; no figures here are measurements):

| State            | Frames per second              | CPU                                                  | GPU                              |
| ---------------- | ------------------------------ | ---------------------------------------------------- | -------------------------------- |
| Tucked or asleep | 0                              | Event wake-ups only (port events, the idle protocol) | None                             |
| Idle with blinks | 0, with bursts of a few frames | Near zero                                            | A few small quads per burst      |
| Peek (about 3 s) | 24–30 during the motion        | Timeline sampling and one frame each step            | Small surface                    |
| Walking          | 24–30                          | As peek, continuously for the bout                   | Small surface (§3.5's first way) |
| Beam or charge   | 12, for under 2 s              | As above                                             | Plus a Shape or a sprite strip   |

**Proposed budgets** (D6-style, set by lane HW from measurements on the rigs):
asleep and idle under 0.1% of one core averaged over a minute; walking under a
stated share of one core on each reference class (x86 laptop, Pi 5, Pi 4); and
no measurable change in a fullscreen game's frame rate, because the companion
is unmapped then. **How:** the shell's CPU from `/proc/<pid>/stat`; frames
from `QSG_RENDER_TIMING`; GPU busy from `gpu_busy_percent` (amdgpu) or the i915
PMU where present. The Pi's V3D has no busy file: use frame times and power at
the wall. Package power from RAPL (`powercap`) on x86, and battery drain
through UPower on laptops.

### 5.3 The governor's levels

D87 governs the processes the harness starts. The shell itself is not a
governed kind (D87.2), so the companion's own cost is a budget, not something
the governor throttles. But it **reads the governor's level** (each process
publishes it in M96's hint file, D87.12; the bar's meter shows the same) and
steps down by itself:

| Governor level     | Companion profile                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| normal             | Full behaviour within §4.4                                                                                                                                                  |
| throttle, relocate | No walks, no peeks, no effects; blinks at most; answers still work                                                                                                          |
| pause              | Tucked. A question still runs as foreground work: never deferred at throttle, and at pause it waits at most `RESOURCE_FOREGROUND_WAIT_MS` (20 s) behind **Run now** (D87.6) |
| On battery saver   | As throttle                                                                                                                                                                 |
| Light profile (Pi) | Walking at 24 steps a second or replaced by short hops; no Shapes effects                                                                                                   |

The governor samples the GPU only when the user sets
`museSpark.resourceGpuMaxPercent` (D87.3), so the companion never relies on a
GPU reading.

## 6. Answering questions

### 6.1 The paths

| Path                                                        | Fit under our rules                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The user's chosen backend through the harness** (default) | The companion is a thin client of the same runtime as the workbench's chat (the desktop bridge and MHP). Each question is a turn in a dedicated **Companion** session on whichever backend, provider and model the user picked (the CLI, the Model API or an M95 provider), with that backend's billing, permissions and approvals. Capability gating as for every feature (multi-vendor rule) |
| Model API, paid extras                                      | Normal turns bill as the backend does. Paid extras (web search, transcription, speech) follow the owner's ask-once rule: on by default, one question before the first charge naming the price and a daily budget, and a visible tally                                                                                                                                                          |
| A small local model (opt-in)                                | Offline answers from the same Ollama runtime as the local judge (D90.27's OSJ layer), with a general model pulled only with consent. Lower quality: labelled as local                                                                                                                                                                                                                          |
| The local judge (`tev1`)                                    | A decision model (D77: "local decision models"), not a chat model. Usable only for triage, such as whether a question is a quick help lookup or whether a breakpoint is a good moment for an opted-in tip. Never for answers                                                                                                                                                                   |
| Muse's own assistant through the gadget SDK                 | Dropped (§1)                                                                                                                                                                                                                                                                                                                                                                                   |

### 6.2 Recommendation

1. **Instant answers first, with no model.** Questions about the OS and the
   product ("how do I pin an app?", "what does Stop everything do?") are
   matched against the `/help` reference's feature catalogue, which the
   check:reference gate keeps current. The match shows the entry and its link,
   and the companion offers **Ask the model** if the entry is not enough.
2. **Then the user's backend,** in the Companion session with an
   **answers-only** tool profile by default: read, search and help, with no
   writes, no shell and no paid tools without the ask-once. **Continue in
   chat** moves the thread into the workbench with its full tools. A question
   is foreground work (§5.3).
3. **Cost note.** An earlier project measurement recorded many model-call
   attempts for one reply-only turn on the CLI backend (31, in the project's
   notes of 2026-09-22). One-line questions may be cheaper on a small model
   through the Model API or a provider. Re-measure before choosing the
   default model for the Companion session.
4. **Approvals are never answered** from the companion, its bubble or its ask
   box. It points to the app's own card (D91.10, D83.3).
5. **Live tests** use the contributor model, in an empty workspace, with
   attempts counted from the trace (project rules).

### 6.3 Voice

**Modes, in order:**

1. **Text** (the ask box): the default and the only mode until the owner rules
   on engines.
2. **Push-to-talk:** hold the summon key, or press and hold on the companion.
   The microphone opens only while held. The bar's microphone indicator
   (PipeWire's mic-in-use, D91.8) lights. The companion shows a distinct
   **listening** pose (tufts up and a cyan ring), with the text "Listening…"
   for screen readers. Releasing closes the microphone.
3. **Wake word:** a separate opt-in, off by default, local only. While it is
   armed, a persistent indicator sits in the bar. It is never armed on the
   lock screen or the greeter, and it disarms during a share or a call (§4.4).

**Engines, against the owner's M9 rules.** In M9 (2026-09-22) the owner
rejected API cost (Meta's Voice Transcribe at $0.18 an hour) and third-party
engines ("sherpa-onnx and friends rejected"), and Linux got a dimmed button
because "no distribution ships a recogniser". On our own OS those rules need
his ruling again (§10):

| Need           | Options found                                                                                                                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Speech to text | whisper.cpp (MIT; Debian packages 1.9.4 in forky and sid only, not trixie); Meta's transcription through the Model API (paid, ask-once)                                                                                                                           |
| Wake word      | openWakeWord: code Apache-2.0, but "all of the included pre-trained models are licensed under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0" license, so we would train our own. microWakeWord: Apache-2.0, a training framework made for ESPHome |
| Text to speech | speech-dispatcher (0.12.0) and espeak-ng (1.52.0) are already in Debian 13 for Orca, so spoken replies need no new engine. Off by default                                                                                                                         |

## 7. Accessibility

- **Text-only mode:** no character at all. The same summon key opens the same
  ask box, and answers appear as text in it. The mode suits screen-reader
  users and anyone who finds an animated figure distracting.
- **Screen readers:** the ask box and its answer are AT-SPI objects with names
  and roles. A new answer is announced with `Accessible.announce()` (Qt 6.8)
  at **Polite**; Qt's docs warn that Assertive "should not be used unless the
  interruption is imperative". The idle character itself is not announced.
  Whether Orca reads Qt Quick layer surfaces under Hyprland is the open
  question of M111's spike S2, so the companion's ask box joins that spike.
- **Keyboard:** summon, send, close (Esc), **Continue in chat** and the
  companion's menu (sleep, go away, settings) all work from the keyboard. Focus
  returns where it was. There are no traps.
- **High contrast:** a 2 px outline from the token source's high-contrast
  palette (D94) and solid bubble colours at 4.5:1 or better. Glow is never the
  only signal: listening also shows its text and shape.
- **Reduced motion:** from the desktop's one setting (D91.21). Qt 6.8 exposes
  no motion preference (`QAccessibilityHints` arrived in Qt 6.10 with contrast
  only), and Debian 13's xdg-desktop-portal 1.20.3 predates the Settings
  portal's `reduced-motion` key (1.21, January 2026), so our settings store is
  the source. Under it: no walks, peeks, beams or pulses; state changes are
  instant or a 120 ms crossfade (`--ms-motion-fast`); Hyprland's `no_anim`
  layer rule for its namespaces.
- **Text size:** bubble text follows the desktop's scaling to 200%.
- **Flashes:** §2.5.

## 8. Privacy and security

- **Off by default.** It needs no screencopy permission under Hyprland's
  `ecosystem:enforce_permissions` (D91.3): it never reads the screen.
- **What it knows:** window geometry and a coarse app class from the
  compositor port. No titles, no window contents, no keystrokes (input
  idleness only, from `ext-idle-notify`).
- **The microphone:** only while push-to-talk is held, or while an opted-in
  wake word is armed, and always with the bar's indicator lit.
- **Captures:** excluded by `no_screen_share`, and tucked while sharing.
- **Answers:** stay in the Companion session on the user's backend, under that
  backend's retention. Nothing goes to a third party beyond what the chosen
  backend already receives.
- **Never:** answers an approval, holds a secret in a bubble (M93's scrubber
  runs on its text as on the chat's), or shows on the lock screen.

## 9. Spikes before building

| Spike | Question                                                                                                                                                          | Pass                                                                  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| C1    | The rig in Qt Quick from the prototype: pre-rasterised parts, the stepped timeline player, a walk cycle, a peek and a beam                                        | Matches the prototype side by side in the screenshot harness          |
| C2    | Hyprland 0.55.2 stacks an exclusive-zone-0 Top surface above a bottom bar layer surface; then the subsurface-below variant (§3.4, C)                              | The rig's clip edge sits on the bar's top edge on every monitor scale |
| C3    | Walking by margins: smooth at 24–30 steps a second, with no tearing between position and frame; otherwise the strip                                               | No visible jitter in a 60 fps capture; the cost of both recorded      |
| C4    | Cost on the x86 laptop, Pi 5 and Pi 4, per §5.2's states; a blink at 12 steps a second reads well enough                                                          | Within the budgets lane HW sets                                       |
| C5    | Ask-box focus with `KeyboardInteractivityExclusive` on LayerShellQt 6.3.4, and focus returning on close                                                           | Typing works at once, and focus returns to the previous window        |
| C6    | `no_screen_share` hides the companion from portal shares and from screenshots; our thumbnailer's effect on `screencast`; the share state the bar's indicator uses | A share shows no companion; thumbnails do not tuck it                 |
| C7    | Orca reads the ask box and announces answers (joins M111's S2)                                                                                                    | Orca speaks the answer once, politely                                 |

## 10. Open questions

**For the owner:**

1. **The companion's name.** It cannot be "Muse" (rule 11, and §1).
2. **The belly mark:** keep his white penguin mark (after a quick look-alike
   check against publishers' penguin logos), or use our squiggle-m mark there?
3. **Voice on our own OS:** may the OS ship a local speech-to-text engine
   (whisper.cpp, not in trixie) or a wake-word engine, given his M9 rule
   against third-party engines? Or may it use Meta's paid transcription under
   the ask-once rule, which M9 rejected for API cost before that rule existed?
   Until he rules, the companion is text-only.
4. **Defaults:** is it offered in onboarding (off until chosen)? Should
   peeking and tucking-while-sharing be on once the companion is on?
5. **Agent reactions** (a small hop when a turn finishes, pointing to a
   waiting approval): wanted, and on or off by default?

**For the lead:**

6. **The status bar as a shell layer surface** (§3.4, A), so it spans every
   desktop as the owner described, with lane SH1 owning it and the workbench
   feeding its items over the bridge, or keep it in Electron and accept
   option E's limits.
7. **The Companion session's default model and tool profile** (§6.2), after
   the cost re-measurement.

## 11. Sources (checked 2026-10-05)

**H. Hyprland**

- Hyprland wiki, IPC: `hyprwm/hyprland-wiki` `content/ipc/_index.md` (last
  changed 2026-09-18; "latest git"), for the sockets, the synchronous-request
  warning, the events table (`activewindowv2`, `fullscreen`, `focusedmonv2`,
  `monitoraddedv2`, `openlayer`, `closelayer`, `screencast`, `screencastv2`,
  `minimized`) and the fullscreen-event note.
- Hyprland wiki, layer rules: `content/configuring/core/rules/layer-rules.md`
  (`no_screen_share` "Hides the layer from screen sharing", `no_anim`,
  `order`, `above_lock`; the Lua `hl.layer_rule` syntax). The rule was added
  in Hyprland 0.52 as `noscreenshare`, with a popup fix in 0.53.0 (release
  notes, from a search listing).
- Hyprland wiki, hyprctl and dispatchers: `using-hyprctl.md` (`cursorpos`,
  `activewindow`, `clients`, `monitors`, `layers`, `-j`, `--batch`, "limiting
  the amount of info calls"); `dispatchers.md` (`global`).
- Hyprland source v0.55.2, `src/debug/HyprCtl.cpp`: the `at`, `size` and
  `fullscreen` client fields, the `hasfullscreen` workspace field, the
  `cursorpos` command and layer `namespace`.
- Hyprland source on main, `src/managers/screenshare/ScreenshareSession.cpp`
  (last changed 2026-10-02): `screencast` and `screencastv2` posted at session
  start and stop. Releases: v0.56.2 on 2026-08-05.
- ryanrhughes/omapager issue #30 (2026-09-21): overlay surfaces block direct
  scanout (Hyprland 0.56.2, `isSolitaryBlocked`), 147.8 against 152.5 fps and
  16 W.
- omacom/omarchy issue #14079 (2026-10-02): a hidden Top bar still takes
  clicks over fullscreen when its alpha never reaches 0.
- hyprwm/Hyprland pull request #15937 (draft): "Top layers go below
  fullscreen windows", `misc:allow_new_top_layers_over_existing_fullscreen`.
- `ext-idle-notify-v1` on wayland.app: version 2,
  `get_input_idle_notification` "ignoring idle inhibitors"; Hyprland listed
  from 0.52.1.

**W. Wayland, Qt and Debian**

- `wlr-layer-shell-unstable-v1.xml` version 5, from layer-shell-qt v6.3.4:
  the output passed only at creation, the exclusive-zone semantics quoted in
  §3.4, the `closed` event, `set_layer`, and the empty input region. Also
  wayland.app's rendering of the protocol: the layers, "Fullscreen shell
  surfaces are typically rendered at the top layer", and `on_demand` since
  version 4.
- KDE layer-shell-qt v6.3.4, `src/interfaces/window.h` and
  `src/declarative/layershellqtplugin.cpp` (the GitHub mirror `KDE/layer-shell-qt`);
  master's `window.h` on invent.kde.org for the later API (`setScreen`,
  `setWantsToBeOnActiveScreen`, `setDesiredSize`, `setActivateOnShow`;
  `ScreenConfiguration` deprecated in 6.6).
- Qt Wayland v6.8.2, `src/client/qwaylandwindow.cpp` (`updateInputRegion`,
  `setMask`) and `src/client/qwaylandsubsurface.cpp` (`set_sync`,
  `set_desync`, no `place_below`).
- Debian sources API (sources.debian.org): `layer-shell-qt` 6.3.4-1 (trixie);
  `qt6-base` 6.8.2+dfsg-9+deb13u2; `qt6-declarative` 6.8.2+dfsg-7;
  `qt6-wayland` 6.8.2-4; `qt6-lottie` 6.8.2-2; `xdg-desktop-portal` 1.20.3
  (trixie), 1.22.1 (forky); `xdg-desktop-portal-hyprland` 1.4.1
  (trixie-backports); `hyprland` 0.55.2 (trixie-backports); `orca` 48.1
  (trixie), 51.0 (backports); `whisper.cpp` 1.9.4 (forky and sid only);
  `speech-dispatcher` 0.12.0 and `espeak-ng` 1.52.0 (trixie).
- packages.debian.org contents search (trixie): `/usr/lib/qt6/bin/svgtoqml`
  in `qt6-declarative-dev-tools`.
- Qt docs: Qt Quick Scene Graph (Qt 6; render loops, "animations are now
  synchronized with rendering", rendering on `QQuickItem::update()`);
  AnimatedSprite (6.8); Shape (6.8; renderers, CPU triangulation,
  retriangulation on change); svgtoqml (6.8; SVG Tiny 1.2 static features,
  no animations); Qt Lottie Animation (6.8; licences); Accessible QML type
  (`announce()` since 6.8, the politeness levels).
- Qt blog, "Vector Graphics in Qt 6.8", Eskil Abrahamsen Blomfeldt,
  2024-09-11: VectorImage, svgtoqml out of preview, the cost against a
  textured quad, Lottie through QPainter.
- Qt 6.10: "What's New in Qt 6.10" and "Animated Vector Graphics in Qt 6.10"
  (from search listings): `lottietoqml` and VectorImage's Lottie backend as
  tech previews; `QAccessibilityHints` with `contrastPreference`.
- xdg-desktop-portal, Settings: `org.freedesktop.appearance` keys
  `color-scheme`, `accent-color`, `contrast`, `reduced-motion` (portal docs, from a
  search listing); Phoronix, "XDG-Desktop-Portal 1.21 Released With Reduced
  Motion Setting", 2026-01-21.
- Rive (from search listings, pages not fetched): `rive-app/rive-runtime`
  (MIT); `jebos/RiveQtQuickPlugin2` (MIT, Qt 6.6 and newer);
  `hypernuclear/rive-qt-plugin` (MIT); basysKom's RiveQtQuickPlugin
  (LGPL-3.0 or later).

**P. Pets, guidance and licences**

- GitHub API and READMEs: `jesperls/qs-vpets` (MIT, created 2026-04-10),
  `rxvy-dev/deskpet` (MIT, created 2026-10-04), `CallMeBakugo/spritepet`
  (MIT, created 2026-10-03), `furudbat/wayland-vpets` (MIT),
  `pixelomer/Shijima-Qt` (GPL-3.0, archived 2026-04-29), `LorisYounger/VPet`
  (Apache-2.0), `ayangweb/BongoCat` (Apache-2.0), `SeakMengs/WindowPet` (MIT),
  `adryd325/oneko.js` (MIT); `Adrianotiger/desktopPet` (eSheep; no licence
  detected by the API).
- wayneko, `git.sr.ht/~leon_plickat/wayneko` (GPL-3.0; bitmaps from the
  public domain), from search listings.
- Horvitz, "Principles of Mixed-Initiative User Interfaces", CHI '99 (ACM DL
  10.1145/302979.303030), and erichorvitz.com/lumiere.htm, from search
  listings.
- W3C, Understanding WCAG 2.2, SC 2.3.1 Three Flashes or Below Threshold.
- openWakeWord (`dscripka/openWakeWord`; code Apache-2.0, pre-trained models
  CC BY-NC-SA 4.0) and microWakeWord (Apache-2.0), from search listings and
  the README excerpts they quote.
- `ggml-org/whisper.cpp` (MIT, GitHub API).
- Tux: Wikipedia, "Tux (mascot)", for Larry Ewing's permission text (from a
  search listing).

**M. Meta research, dropped (§1)**

- gadgets.muse.ai (read 2026-10-05) and `facebookincubator/muse-gadget-sdk`
  (created 2026-10-02, last push 2026-10-05): `README.md` ("The Apache License
  does not cover the Jollybot avatar"), `linux/README.md` (the four commands;
  "Muse gets the same access to the machine as the account you install it
  for"; the man-in-the-middle warning), `esp32/AGENTS.md` (the avatar files
  "carry only a Meta copyright line").
- "Muse Gadget SDK Token Terms of Use", gadgets.muse.ai/sdk-terms (no date on
  the page). The muse.ai/sdk-terms address returned HTTP 401.
- "Muse Supplemental Terms of Service", muse.ai/terms, "Last updated:
  September 8, 2026".
- The Jolly mascot: search listings for Dezeen (2026-09-25), PC Gamer and
  others. PC Gamer's article body could not be read.

**Plan**

- PLAN.md D71 (never a gadget), D77 (the local judge), D87 (the governor:
  2, 3, 6 and 12), D90.27 (the judge at install), D91 (3, 4 and its
  amendment, 8, 10, 13 and its amendment, 15, 21, 26), Q4 and M9 (voice
  rules); `docs/research/muse-desktop-2026-10-05.md` §2.2, §2.3, §3, §9,
  §13.4 and §15.
