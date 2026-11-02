// M34/M44: paid image generation and image edits through the terminal agent.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/e2e/modelApi.live.e2e.test.ts, `live Model API sweep > case12 images:
//   one generated, then edited, each confirmed (M34, M44)`
//
// Headless confirmation is the explicit --image-generation flag with edits
// allowed and the run's hard budget (AGENTS.md rule 12): no popup opens.
// Only on the Meta route, where the run's Model API key pays: provider
// routes carry their provider's key, not one the image feature bills.
//
// Expected model attempts: 8. Dollar cap: $0.30.
const IMAGE = 'real-life-red-square.png'

export default {
  title: 'An image is generated, then edited, each confirmed',
  only: (route) => route.kind === 'meta',
  exec: {
    claims: ['ref/cli/exec/exec---image-generation', 'ref/feature/images'],
    requests: 8,
    maxUsd: '0.30',
    async run(person, see) {
      const made = await person.exec(
        `Generate a small image of a solid red square and save it in the workspace ` +
          `as ${IMAGE}. Then reply with the one word DONE.`,
        { mode: 'acceptEdits', maxRequests: 4, args: ['--image-generation'] },
      )
      see('the generation completed', made.code === 0, `exit ${String(made.code)}`)
      const first = person.file(IMAGE)
      see(
        'the generated image is on disk and not empty',
        first !== undefined && first.length > 0,
        first === undefined ? 'no such file' : `${String(first.length)} characters read`,
      )
      const edited = await person.exec(
        `Edit ${IMAGE} to add a blue border, saving over the same file. ` +
          `Then reply with the one word DONE.`,
        { mode: 'acceptEdits', maxRequests: 4, args: ['--image-generation'] },
      )
      see('the edit completed', edited.code === 0, `exit ${String(edited.code)}`)
      const second = person.file(IMAGE)
      see(
        'the edit changed the file bytes',
        second !== undefined && first !== undefined && second !== first,
        second === undefined ? 'no such file' : 'bytes differ',
      )
      see(
        'the run was charged for the image work',
        Number(made.result?.usage?.costUsd?.settled ?? '0') > 0 ||
          Number(edited.result?.usage?.costUsd?.settled ?? '0') > 0,
        `$${String(made.result?.usage?.costUsd?.settled)} then $${String(edited.result?.usage?.costUsd?.settled)} settled`,
      )
    },
  },
}
