// Prepare cold disk fixtures outside each assertion's unchanged test deadline.
// Each named preparation keeps the repository's unchanged hook deadline too.
import { beforeAll, beforeEach } from 'vitest'

export function fixtureBudget<T>(
  names: readonly string[],
  prepare: (name: string) => Promise<T>,
  taskNames?: Readonly<Record<string, string>>,
): (name: string) => Promise<T> {
  const prepared = new Map<string, T>()
  if (taskNames === undefined) {
    for (const name of names)
      beforeAll(async () => {
        prepared.set(name, await prepare(name))
      })
  } else {
    // Native handles belong to one case; suite-wide preparation would let an
    // earlier afterEach release them before the owning assertion starts.
    beforeEach(async ({ task }) => {
      const name = names.find((candidate) => taskNames[candidate] === task.name)
      if (name !== undefined) prepared.set(name, await prepare(name))
    })
  }
  return (name) => {
    const fixture = prepared.get(name)
    if (fixture === undefined) throw new Error(`Fixture was not prepared: ${name}`)
    return Promise.resolve(fixture)
  }
}
