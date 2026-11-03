// M118: saved prompts and sharing help without a model send.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/e2e/acpStdio.e2e.test.ts, `the ACP agent over stdio (M63) > binds saved
//   prompts and sharing help over real ACP stdio without a model send (M118)`
// - test/unit/promptLibrary.test.tsx, the save/list/use rows (a draft saved
//   under its id, listed by scope, used explicitly)
// - test/unit/promptStore.test.ts, the round-trip rows (exact Markdown kept,
//   both scopes shown; bounds withdrawn, proven elsewhere)
// - test/unit/promptImport.test.ts and test/unit/promptBridge.test.ts, the
//   preview/confirm rows (sharing previews before it releases anything)
//
// The release half (confirming a share, publishing it) is a lead-only run:
// the index names its steps. Prompt titles carry the cell's marker, so cells
// sharing one home never read each other's prompts by mistake. The ACP share
// step runs on a session with no model turns, so it proves the command's
// binding through its empty-chat refusal; the preview with content is
// proven through the CLI in m84-share-redaction.
//
// Expected model attempts: 0. Dollar cap: $0.00.
const SAVED = 'Save Prompt:'
const LIBRARY = 'Prompt Library'
const USER_SCOPE = 'All Workspaces'
const INSERTED = 'Insert Into Chat'
const EMPTY_CHAT = 'There is no conversation to export yet.'

/** The saved id from `Save Prompt: <title> (<id>)`, or undefined. */
const savedId = (text) => / \(([^()]+)\)\s*$/.exec(text.trim())?.[1]

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
  title: 'prompts save, list and use, and share is bound, with no model send',
  exec: {
    claims: ['ref/cli/prompts/prompts', 'ref/feature/prompts'],
    requests: 0,
    maxUsd: '0.00',
    async run(person, see) {
      const marker = person.marker()
      const title = `RL note ${marker}`
      const body = `Stand up and say ${marker}.`
      const saved = await person.command(['prompts', 'save', '--title', title], {
        stdin: `${body}\n`,
      })
      see('prompts save ends with exit code 0', saved.code === 0, `exit ${String(saved.code)}`)
      see(
        'the save names its title and id',
        saved.stdout.includes(`${SAVED} ${title} (`),
        saved.stdout.trim(),
      )
      const id = savedId(saved.stdout)
      see('the id reads back from the answer', id !== undefined, saved.stdout.trim())
      const listed = await person.command(['prompts', 'list'])
      see('prompts list ends with exit code 0', listed.code === 0, `exit ${String(listed.code)}`)
      see(
        'the list shows the library with the saved title in the user scope',
        listed.stdout.includes(LIBRARY) &&
          listed.stdout.includes(title) &&
          listed.stdout.includes(USER_SCOPE),
        listed.stdout.trim(),
      )
      if (id === undefined) {
        return
      }
      const used = await person.command(['prompts', 'use', id, '--confirm'])
      see(
        'prompts use prints the prepared text',
        used.code === 0 && used.stdout.includes(body),
        `exit ${String(used.code)}: ${used.stdout.trim()}`,
      )
    },
  },
  acp: {
    claims: ['ref/slash/prompt', 'ref/slash/share', 'ref/feature/prompts'],
    requests: 0,
    maxUsd: '0.00',
    async run(person, see) {
      const marker = person.marker()
      const title = `RL note ${marker}`
      const editor = await person.openEditor()
      const session = await editor.newSession()
      const saved = await session.prompt(
        `/prompt save --title "${title}" -- Stand up and say ${marker}.`,
      )
      see('the save ends as a finished turn', saved.stopReason === 'end_turn', saved.stopReason)
      see('the save names its title and id', saved.said.includes(`${SAVED} ${title} (`), saved.said)
      const listed = await session.prompt('/prompt list')
      see(
        'the list shows the library with the saved title',
        listed.stopReason === 'end_turn' &&
          listed.said.includes(LIBRARY) &&
          listed.said.includes(title),
        listed.said,
      )
      const id = savedId(saved.said)
      if (id !== undefined) {
        const used = await session.prompt(`/prompt use ${id} --confirm`)
        see(
          'using it prepares its text',
          used.stopReason === 'end_turn' &&
            (used.said.includes(INSERTED) || used.said.includes(marker)),
          used.said,
        )
      }
      const shared = await shownTo(session, '/share chat')
      see(
        'the bound share command refuses an empty chat with its sentence',
        shared.includes(EMPTY_CHAT),
        shared,
      )
    },
  },
}
