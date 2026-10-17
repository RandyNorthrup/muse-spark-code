// A person caps a headless run at one model request and asks for work that
// needs more. The run stops at its cap and says so.
const FILE = 'real-life-capped.txt'

export default {
  title: 'A capped run stops at its cap and says so',
  exec: {
    claims: ['ref/cli/exec/exec---max-requests-value', 'ref/feature/budget'],
    requests: 1,
    async run(person, see) {
      const turn = await person.exec(
        `Create a file named ${FILE} in the workspace whose whole content is the single line ${person.marker()}. Then read it back and reply with its content.`,
        { mode: 'acceptEdits', maxRequests: 1 },
      )
      see(
        'exactly one model request was made',
        turn.result?.usage?.requests === 1,
        `${String(turn.result?.usage?.requests)} request(s)`,
      )
      see(
        'the result says the request cap stopped it',
        turn.result?.status === 'request_cap',
        `status ${String(turn.result?.status)}`,
      )
      see('the command ends with exit code 5', turn.code === 5, `exit ${String(turn.code)}`)
      const shown = `${turn.result?.error?.message ?? ''} ${turn.stderr}`
      see('the person is told the cap was reached', /request cap/iu.test(shown), shown)
    },
  },
}
