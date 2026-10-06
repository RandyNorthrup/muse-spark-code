# The desktop companion's art

The opt-in desktop companion of Muse Desktop (D91.30, M111 lane PE) is the
owner's own character: an electric penguin, charcoal with a cream face and
belly and a white penguin mark, orange ear tufts, beak and toe claws, blue
armour plates with yellow lightning bolts, and glowing cyan nodes on the
collar and flippers. It is not a Meta character, name or likeness (rule 11).

Nothing here ships in the VS Code extension: the VSIX packages an allow-list
(`.vscodeignore`), and `design/` is not on it.

## Files

| Path                         | What it is                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `source/reference-sheet.jpg` | The owner's character sheet (front, side, jump, charge, beam and angry poses), as he supplied it on 2026-10-05.   |
| `anim/<name>.png`            | One horizontal strip per animation, 240 px tall, frames left to right, transparent background.                    |
| `anim/manifest.json`         | Per animation: `frames`, the frame width `w` and height `h` in pixels, the playback rate `fps`, and `loop`.       |
| `tools/penguin-slice.py`     | Keys the chroma-green sheets, slices each grid into frames, aligns rows and writes the strips and the manifest.   |
| `tools/penguin-cut.py`       | Cuts the six reference poses out of `source/reference-sheet.jpg` (used to check the strips against the original). |
| `prompts.md`                 | The exact twelve image prompts that produced the sheets.                                                          |

## The twelve animations

| Name     | Frames | fps | Loops | Used for                                                       |
| -------- | -----: | --: | :---: | -------------------------------------------------------------- |
| `walk`   |      8 |  10 |  yes  | Walking along the status bar (facing right; mirrored for left) |
| `idle`   |      6 |   5 |  yes  | Standing, with a blink                                         |
| `peek`   |      6 |   4 |  no   | Peeking up from behind the status bar while hidden             |
| `talk`   |      6 |   8 |  yes  | Answering                                                      |
| `wave`   |      6 |   7 |  yes  | Greeting                                                       |
| `think`  |      6 |   4 |  yes  | Waiting for an answer                                          |
| `hop`    |      6 |   9 |  yes  | A finished turn (when agent reactions are on)                  |
| `sleep`  |      6 |   3 |  yes  | Inactivity                                                     |
| `charge` |      6 |   9 |  yes  | Working (a long task running)                                  |
| `alert`  |      6 |   8 |  yes  | Something needs the person (points to a waiting approval)      |
| `turn`   |      6 |   6 |  no   | Turning from facing right to facing left                       |
| `beam`   |      6 |   8 |  no   | Celebrating (a merge, a green check)                           |

The sheets were drawn at slightly different scales. The preview applies a
display scale per animation, measured from the span of the orange ear tufts
against `walk`: `peek` 0.46, `talk` 0.83, `wave` 0.80, `think` 0.83, `hop`
0.93, `sleep` 0.71, `charge` 1.17, `alert` 0.72, the rest 1. Lane PE either
bakes these scales into re-cut strips or keeps them in the manifest; either
way the character must be one size on screen in every animation.

## How the sheets were made

1. The owner's reference sheet was uploaded to an image-generation chat in
   his own ChatGPT account, at his direction, on 2026-10-05.
2. Each prompt in `prompts.md` asked for one sprite sheet in a fixed grid
   (walk 4 × 2, the others 3 × 2) on a flat chroma-key green (#00B140), with
   the same character size, camera and baseline in every frame, and no
   shadows, text or grid lines.
3. `tools/penguin-slice.py` removed the green, cut the grid, aligned each row
   by its lowest opaque pixel and mean centre, cropped every frame to the
   union box of its animation, and wrote the strips at 240 px.

Under OpenAI's terms of use the person who prompts owns the output; the
character itself is the owner's. Lane AR records this provenance in
`THIRD_PARTY_NOTICES.txt`'s desktop section when the art ships, and re-checks
the white belly mark against publishers' penguin logos before release
(D91.30).

The raw 1536 × 1024 sheets are kept outside the repository (19 MB) in the
lead's archive on the Kubuntu rig, `~/archive/companion-sheets/`. Re-running
the slicer needs them; the strips here are the build input.

## Still to do (lane PE and lane AR)

- 2× strips (480 px) for high-density displays, regenerated from the sheets
  with the same slicer, or re-prompted at a larger size if 2× upscaling blurs.
- A left-facing `walk` is the mirrored strip; check that the lightning bolts
  and the belly mark read correctly when mirrored, or draw a left sheet.
- A high-contrast outline variant and a reduced-motion still for each pose
  (D91.30's accessibility rules).
