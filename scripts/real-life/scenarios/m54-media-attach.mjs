// M54/M105: an attached file reaches the model; audio bytes that are not
// audio never do.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/e2e/modelApi.live.e2e.test.ts, `live Model API sweep > case04 images:
//   one attached, one read by read_file (M54)` and `case05 PDFs: one attached,
//   one read by read_file (M54)` (the attach path; real image and PDF bytes
//   are a lead-only run: the index names it)
// - test/unit/mediaLimits.test.ts, `M105 media admission > refuses
//   empty/invalid metadata before admission`
// - test/unit/acpMedia.test.ts, `ACP media admission > sniffs a media path
//   with no media suffix instead of trusting its name` (here the inverse: a
//   media suffix with plain-text bytes is refused before admission)
//
// Expected model attempts: 4. Dollar cap: $0.10.
const NOTE = 'real-life-note.txt'
const NOT_SOUND = 'real-life-not-sound.mp3'

export default {
  title: 'An attached file is delivered; fake audio is refused unsent',
  exec: {
    claims: ['ref/cli/exec/exec---attach-value', 'ref/feature/media-attach'],
    requests: 4,
    maxUsd: '0.10',
    async run(person, see) {
      const marker = person.marker()
      const staged = await person.exec(
        `Write two files in the workspace with your file tool, then reply with the one word DONE. ` +
          `The file ${NOTE} holds the single line ${marker}. ` +
          `The file ${NOT_SOUND} holds the single line This file only claims to be audio. ` +
          `Write them exactly; do not explain.`,
        { mode: 'acceptEdits', maxRequests: 2 },
      )
      see('the staging turn completed', staged.code === 0, `exit ${String(staged.code)}`)
      see(
        'both files are on disk',
        person.file(NOTE)?.includes(marker) === true &&
          person.file(NOT_SOUND)?.includes('claims to be audio') === true,
        `${NOTE}: ${person.file(NOTE) ?? 'missing'}; ${NOT_SOUND}: ${person.file(NOT_SOUND) ?? 'missing'}`,
      )
      const delivered = await person.exec('Quote the attached file in full, then stop.', {
        args: ['--attach', NOTE],
      })
      see(
        'the attached turn completed',
        delivered.code === 0,
        `exit ${String(delivered.code)}, status ${String(delivered.result?.status)}`,
      )
      see(
        'the answer carries the attached word',
        delivered.result?.finalMessage?.includes(marker) === true,
        delivered.result?.finalMessage ?? delivered.result?.error?.message ?? delivered.stderr,
      )
      const refused = await person.exec('Quote the attached file in full, then stop.', {
        args: ['--attach', NOT_SOUND],
      })
      see(
        'no model request was made for the fake audio',
        (refused.result?.usage?.requests ?? 0) === 0,
        `${String(refused.result?.usage?.requests ?? 0)} request(s), exit ${String(refused.code)}`,
      )
      see(
        'the refusal says why',
        `${refused.result?.error?.message ?? ''} ${refused.stderr}`.trim() !== '',
        `${refused.result?.error?.message ?? ''} ${refused.stderr}`.trim(),
      )
    },
  },
}
