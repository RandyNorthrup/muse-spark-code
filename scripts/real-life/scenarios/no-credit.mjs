// The account has no credit left. The provider refuses the request, which
// costs nothing, and the person is shown the provider's own reason.
const REASON = /credit|balance|billing|quota|payment/iu

/** What an editor is shown for one prompt: the answer, or the request's error. */
async function shownTo(session) {
  try {
    const turn = await session.prompt('Reply with the one word OK.')
    return `${turn.stopReason}: ${turn.said}`
  } catch (error) {
    return `${error.message} ${JSON.stringify(error.rpc ?? {})}`
  }
}

export default {
  title: 'An account with no credit shows the provider’s own reason',
  only: (route) => route.note === 'no credit',
  // Last: the product books the refused request at its whole reservation.
  order: 95,
  exec: {
    claims: ['ref/feature/providers', 'ref/cli/exec/exec---provider-value'],
    requests: 1,
    async run(person, see) {
      const turn = await person.exec('Reply with the one word OK.')
      const shown = `${turn.result?.error?.message ?? ''} ${turn.result?.finalMessage ?? ''} ${turn.stderr}`
      see('the command does not end with exit code 0', turn.code !== 0, `exit ${String(turn.code)}`)
      see('the person is shown the provider’s reason', REASON.test(shown), shown)
      see(
        'nothing was charged',
        Number(turn.result?.usage?.costUsd?.settled ?? '0') === 0,
        `$${String(turn.result?.usage?.costUsd?.settled)} settled`,
      )
    },
  },
  acp: {
    claims: ['ref/feature/providers', 'ref/feature/acp'],
    requests: 1,
    async run(person, see) {
      const editor = await person.openEditor()
      const session = await editor.newSession()
      const shown = await shownTo(session)
      see('the person is shown the provider’s reason', REASON.test(shown), shown)
    },
  },
}
