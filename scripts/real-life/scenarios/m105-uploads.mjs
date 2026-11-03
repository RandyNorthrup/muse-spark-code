// M105 lane F: the editor lists and deletes uploaded files locally.
//
// Deleted titles (docs/real-life/unproven.md, test/unit/acpUploads.test.ts):
// - `lists the ledger files, says empty, and ignores other text`
// - `refuses zero and other invalid one-based selectors with a sentence`
// - `refuses a leading-zero selector even when its number is listed`
// - `says so and deletes nothing without the ledger`
//
// A local command: no model turn, no charge. The ledger half (uploads,
// provider deletes, foreign files) needs provider files and is a lead-only
// run: the index names its steps.
//
// Expected model attempts: 0. Dollar cap: $0.00.
const EMPTY = 'No uploaded files.'
const USAGE = '/uploads [delete <file> | delete-all]'

/** What an editor is shown for one prompt: the answer, or the request's error. */
async function shownTo(session, text) {
  try {
    const turn = await session.prompt(text)
    return `${turn.stopReason}: ${turn.said}`
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export default {
  title: '/uploads lists nothing and refuses bad selectors with a sentence',
  acp: {
    claims: ['ref/slash/uploads', 'ref/feature/uploads'],
    requests: 0,
    maxUsd: '0.00',
    async run(person, see) {
      const editor = await person.openEditor()
      const session = await editor.newSession()
      const listed = await session.prompt('/uploads')
      see(
        'the listing ends as a finished turn',
        listed.stopReason === 'end_turn',
        listed.stopReason,
      )
      see('an empty ledger says so exactly', listed.said.trim() === EMPTY, listed.said)
      // With no ledger at all the same sentence answers instead of the
      // not-found one (src/acp/uploads.ts): both refuse and delete nothing.
      const zero = await shownTo(session, '/uploads delete 0')
      see(
        'selector 0 is refused with a sentence',
        zero.includes('No uploaded file 0 is listed.') || zero.includes(EMPTY),
        zero,
      )
      const leadingZero = await shownTo(session, '/uploads delete 007')
      see(
        'a leading-zero selector is refused with a sentence',
        leadingZero.includes('No uploaded file 007 is listed.') || leadingZero.includes(EMPTY),
        leadingZero,
      )
      const bad = await shownTo(session, '/uploads frobnicate')
      see('anything else answers the usage line', bad.includes(USAGE), bad)
    },
  },
}
