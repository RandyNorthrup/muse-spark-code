// A person names a model the route does not have. The run is refused before
// anything is sent, and the refusal says which model and why.
const NO_SUCH = 'no-such-model-real-life'

export default {
  title: 'An unknown model is refused with its reason',
  // Among the last: the product books a refused request at its whole
  // reservation, and a run's dollars are counted by the product.
  order: 90,
  // Not on a route to Meta's own models: there the run names the route's
  // contributor model and never any other, not even one that does not exist.
  only: (route) => route.kind === 'provider' && route.note === undefined,
  exec: {
    claims: ['ref/cli/exec/exec---model-value'],
    requests: 0,
    async run(person, see) {
      const { route } = person
      const asked = route.provider === undefined ? NO_SUCH : `${route.provider}/${NO_SUCH}`
      const turn = await person.exec('Reply with the one word OK.', {
        model: { model: NO_SUCH, modelId: asked },
      })
      const shown = `${turn.result?.error?.message ?? ''} ${turn.stderr}`.trim()
      see('the command does not end with exit code 0', turn.code !== 0, `exit ${String(turn.code)}`)
      see(
        'no model request was made',
        (turn.result?.usage?.requests ?? 0) === 0,
        `${String(turn.result?.usage?.requests ?? 0)} request(s)`,
      )
      see('the refusal names the model that was asked for', shown.includes(NO_SUCH), shown)
    },
  },
}
