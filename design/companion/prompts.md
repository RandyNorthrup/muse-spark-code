# The companion's image prompts

The exact prompts typed into the owner's ChatGPT image chat on 2026-10-05,
in order. Each was sent with the owner's reference sheet
(`source/reference-sheet.jpg`) attached to the chat. See `README.md` for how
the sheets became the strips in `anim/`.

## `walk`

Use the attached image as the exact character reference: this same electric penguin, with identical proportions, colours, outlines and cel shading. Charcoal body, cream face and belly with the small white penguin mark, orange ear tufts, orange beak and orange toe claws, blue armour plates with yellow lightning bolts and glowing cyan nodes on the collar and flippers. Create a SPRITE SHEET for a 2D desktop-pet animation: a side-view WALK CYCLE facing right, 8 frames, in 2 rows of 4 (read left to right, top row first). It is a looping penguin waddle: contact, down, passing and up for the left foot, then the same for the right foot. The body bobs gently and tilts side to side, and the flippers swing a little. Rules for every frame: the same character size and the same camera; feet on the same baseline; the character centred in its cell with empty space around it; frames evenly spaced and never overlapping or touching; a flat pure chroma-key green background (#00B140) everywhere; no ground shadow, no text, no numbers, no grid lines, no borders. Landscape 3:2 image.

## `idle`

Same character (the attached penguin, exactly as the reference) and exactly the same sprite-sheet rules as before: same size and camera in every frame, feet on one baseline, centred cells, never overlapping, flat pure chroma-key green background (#00B140), no shadow, no text, no numbers, no grid, no borders, landscape 3:2. Now: FRONT-VIEW IDLE WITH BLINK, 6 frames in 2 rows of 3 (left to right, top row first): frame 1 relaxed idle; frame 2 tiny breathing rise; frame 3 eyes half closed; frame 4 eyes fully closed (blink); frame 5 eyes half open; frame 6 back to relaxed idle. Only the eyes and a very slight breathing change between frames; everything else stays identical.

## `peek`

Same character and exactly the same sprite-sheet rules as before. Now: PEEK FROM BEHIND A BAR, front view, 6 frames in 2 rows of 3 (left to right, top row first). In every frame imagine an opaque horizontal bar covering the bottom of the cell: draw only what shows above it, with the character cut off cleanly by a straight horizontal line at the same height in every frame. Frame 1: only the tip of the head feathers shows. Frame 2: head feathers and the tops of the orange ear tufts. Frame 3: up to the eyes, eyes looking left. Frame 4: up to the eyes, eyes looking right. Frame 5: up to the beak, a small happy smile, eyes forward. Frame 6: ducking back down, only the ear tufts and head feathers showing.

## `talk`

Same character and exactly the same sprite-sheet rules as before (front view, full body, green #00B140 background). Now: TALK, 6 frames in 2 rows of 3: a friendly talking loop. The beak opens and closes in a natural rhythm (closed, half open, open, half open, closed, small open), with a slight head bob and one flipper gesturing a little. Eyes friendly and engaged.

## `wave`

Same character and exactly the same sprite-sheet rules as before (front view, full body, green #00B140 background). Now: WAVE, 6 frames in 2 rows of 3: a cheerful wave with the right flipper. The flipper rises up beside the head, waves side to side twice, then comes back down; a happy face with slightly squinted eyes and a smile; the body leans a tiny bit into the wave.

## `think`

Same character and exactly the same sprite-sheet rules as before (front view, full body, green #00B140 background). Now: THINK, 6 frames in 2 rows of 3: thinking hard about a question. Eyes look up and to the side, one flipper taps the beak, the head tilts slightly, a small spark of electricity flickers at one cyan node as an idea forms, then the eyes brighten in the last frame as if it got the answer.

## `hop`

Same character and exactly the same sprite-sheet rules as before (front view, full body, green #00B140 background). Now: HAPPY HOP, 6 frames in 2 rows of 3: a joyful little jump. Frame 1 crouch with a squash; frame 2 take-off; frame 3 top of the jump with both flippers raised and eyes closed in happy arcs; frame 4 starting to fall; frame 5 landing squash; frame 6 standing tall and proud with a big smile. Keep the feet baseline the same for frames 1, 5 and 6; frames 2 to 4 are above it.

## `sleep`

Same character and exactly the same sprite-sheet rules as before (front view, full body, green #00B140 background). Now: SLEEP, 6 frames in 2 rows of 3: dozing off. Frame 1 eyes heavy and half closed; frame 2 head nodding down; frame 3 asleep, eyes closed, head tilted, flippers relaxed; frames 4 to 6 a slow breathing loop while asleep (belly rises a little, then falls). A peaceful, content face. No "z" letters; we add those in code.

## `charge`

Same character and exactly the same sprite-sheet rules as before (front view, full body, green #00B140 background). Now: CHARGE UP, 6 frames in 2 rows of 3, matching the electric style of the reference: yellow and cyan lightning crackling around the body, the cyan nodes glowing, glowing orbs at the flipper tips. The intensity builds from a few small sparks (frame 1) to a full crackling aura (frame 4), then pulses (frames 5 and 6 alternate) so it can loop. A focused, determined face. Keep the lightning inside each cell so frames never touch.

## `alert`

Same character and exactly the same sprite-sheet rules as before (front view, full body, green #00B140 background). Now: NEEDS YOU (alert), 6 frames in 2 rows of 3: trying to get the user's attention, like the glowing determined crouch in the reference but friendly, not angry. It bounces on the spot, flaps both flippers, has a soft cyan glow outline, and has an eager, urgent face with its beak open as if calling out. Frames loop smoothly.

## `turn`

Same character and exactly the same sprite-sheet rules as before (green #00B140 background). Now: TURN AROUND, 6 frames in 2 rows of 3, full body, turning in place from facing right to facing left: frame 1 side view facing right (as in the walk sheet); frame 2 three-quarter view right; frame 3 front view; frame 4 three-quarter view left; frame 5 side view facing left; frame 6 side view facing left with a small happy hop. The feet stay on the same baseline.

## `beam`

Same character and exactly the same sprite-sheet rules as before (green #00B140 background). Now: CELEBRATE WITH A BEAM, 6 frames in 2 rows of 3, side view facing right like the reference's beam pose: frame 1 winding up, sparks gathering at the right flipper; frame 2 flipper extended, a small bright flash; frames 3 and 4 a short electric beam (yellow and cyan) shooting to the right, kept INSIDE the cell and not touching the next frame; frame 5 the beam fading to sparks; frame 6 a proud pose with a few fading sparks.
