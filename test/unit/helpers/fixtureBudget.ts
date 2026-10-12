// Prepare cold disk fixtures outside each assertion's unchanged test deadline.
// Each named preparation keeps the repository's unchanged hook deadline too.
import { beforeAll } from 'vitest'

export function fixtureBudget<T>(
  names: readonly string[],
  prepare: (name: string) => Promise<T>,
): (name: string) => Promise<T> {
  const prepared = new Map<string, T>()
  for (const name of names)
    beforeAll(async () => {
      prepared.set(name, await prepare(name))
    })
  return (name) => {
    const fixture = prepared.get(name)
    if (fixture === undefined) throw new Error(`Fixture was not prepared: ${name}`)
    return Promise.resolve(fixture)
  }
}
