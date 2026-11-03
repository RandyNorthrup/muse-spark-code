# Muse Desktop companion provenance (M111, D91.30)

The opt-in desktop companion is the owner's own character: an electric
penguin, charcoal with a cream face and belly and a white penguin mark,
orange ear tufts, beak and toe claws, blue armour plates with yellow
lightning bolts, and glowing cyan nodes on the collar and flippers. It is
not a Meta character, name or likeness.

The twelve animation strips in `design/companion/anim/` were cut from
sprite sheets drawn from the owner's own character sheet
(`design/companion/source/reference-sheet.jpg`, supplied 2026-10-05). The
sheets were generated in an image-generation chat in the owner's own
account, at his direction, on 2026-10-05, from the exact prompts in
`design/companion/prompts.md`; `design/companion/tools/penguin-slice.py`
keyed the chroma green and sliced the grids. Under OpenAI's terms the
person who prompts owns the output; the character itself is the owner's.

Lane AR derived, without redrawing anything: the 2x strips (Keys-bicubic
upscale of the 1x strips, in `design/companion/anim-2x/`), the
high-contrast strips (the same paint with a white-then-black outline ring
at both scales, `anim-hc/` and `anim-hc-2x/`), the reduced-motion stills
(one frame per animation at both scales, `anim-still/` and
`anim-still-2x/`), and the `anim/variants.json` manifest naming every file
with its still frame, display scale and WCAG 2.3.1 flash measurement. All
twelve animations measure flash-compliant; see the lane record
`docs/certification/rlf-m111ar.md`.
