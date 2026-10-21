// After a turn, the product says what it used: the requests and what they
// cost. At the terminal that is `usage`; in an editor it is `/usage`.

/** The number that follows a label in the usage text (`Requests: 4 requests`, `Total Cost: $0.02`). */
const numberAfter = (text, label) => {
  const from = text.indexOf(`${label}:`)
  const found = from === -1 ? null : /\d[\d.,]*/u.exec(text.slice(from + label.length + 1))
  return found === null ? NaN : Number(found[0].replaceAll(',', ''))
}
const lineWith = (text, label) => text.split('\n').find((line) => line.includes(label)) ?? text

export default {
  title: '/usage shows the requests and what they cost',
  exec: {
    claims: [
      'ref/cli/usage/usage---json',
      'ref/cli/usage/usage-summarydailymodelslimitsexportopenserve-options----usage---json',
      'ref/feature/usage',
    ],
    requests: 1,
    async run(person, see) {
      const counted = async () => {
        const printed = await person.command(['usage'])
        return numberAfter(printed.stdout, 'Requests')
      }
      const before = await counted()
      const turn = await person.exec(person.connectionCheck(person.marker()))
      see('the turn completed', turn.code === 0, `exit ${String(turn.code)}`)
      const records = await person.usage()
      const mine = records.filter((record) => record.session === turn.result?.sessionId)
      see(
        'the usage lists the request of that turn',
        mine.length === 1,
        `${String(mine.length)} of ${String(records.length)} recorded request(s) belong to the turn`,
      )
      see(
        'that request has a cost above zero',
        Number(mine[0]?.cost?.usd) > 0,
        `$${String(mine[0]?.cost?.usd)} for it in the usage`,
      )
      const after = await counted()
      see(
        'the text a person reads counts one request more than before the turn',
        after === before + 1,
        `${String(before)} request(s) before, ${String(after)} after`,
      )
    },
  },
  acp: {
    claims: ['ref/slash/usage', 'ref/feature/usage'],
    requests: 1,
    async run(person, see) {
      const editor = await person.openEditor()
      const session = await editor.newSession()
      const turn = await session.prompt(person.connectionCheck(person.marker()))
      see('the turn completed', turn.stopReason === 'end_turn', turn.stopReason)
      const usage = await session.prompt('/usage')
      see(
        'the answer counts at least one request',
        numberAfter(usage.said, 'Requests') >= 1,
        lineWith(usage.said, 'Requests'),
      )
      see(
        'the answer shows a cost above zero',
        numberAfter(usage.said, 'Total Cost') > 0,
        lineWith(usage.said, 'Total Cost'),
      )
    },
  },
}
