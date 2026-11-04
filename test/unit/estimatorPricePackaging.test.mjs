// The extension's runtime bundles and the VSIX builder's real file list agree. Both are read once,
// by global setup (helpers/estimatorPackaging.mjs), from the run's shared production build.
import { expect, inject, it } from 'vitest'
import { ESTIMATOR_PACKAGING_KEY } from './helpers/productionPackage'

it('ships every built bundle production can require in the VSIX builder file list', () => {
  const inventory = inject(ESTIMATOR_PACKAGING_KEY)
  if ('error' in inventory) throw new Error(`The inventory was not made: ${inventory.error}`)
  const required = new Set(inventory.required)
  const packaged = new Set(inventory.packaged)
  expect(required.has('dist/estimatePrices.js')).toBe(true)
  expect(required.has('dist/planSnapshot.js')).toBe(true)
  const missing = required
    .values()
    .filter((file) => !packaged.has(file))
    .toArray()
    .toSorted((left, right) => left.localeCompare(right, 'en'))
  expect(missing).toEqual([])
})
