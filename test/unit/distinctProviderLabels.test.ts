// The one provider-label rule the Models panel and `auth status` share
// (src/shared/providerLabels.ts). Windows real use, 0.19.0: two
// providers made from the Anthropic preset showed as two identical
// "Anthropic" cards and two identical stored-key lines.
import { expect, it } from 'vitest'
import { distinctProviderLabels } from '../../src/shared/providerLabels'

it('adds the id only to labels more than one provider shares', () => {
  expect(
    distinctProviderLabels([
      { id: 'chatgpt', label: 'ChatGPT', models: 8 },
      { id: 'anthropic-s2', label: 'Anthropic', models: 1 },
      { id: 'anthropic-s1', label: 'Anthropic', models: 1 },
      { id: 'local', label: 'local', models: 0 },
      { id: 'other', label: 'local', models: 0 },
    ]),
  ).toEqual([
    { id: 'chatgpt', label: 'ChatGPT', models: 8 },
    { id: 'anthropic-s2', label: 'Anthropic (anthropic-s2)', models: 1 },
    { id: 'anthropic-s1', label: 'Anthropic (anthropic-s1)', models: 1 },
    // A label that is its own id already names it.
    { id: 'local', label: 'local', models: 0 },
    { id: 'other', label: 'local (other)', models: 0 },
  ])
})

it('leaves a list with no shared label as it was', () => {
  const rows = [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Beta' },
  ]
  expect(distinctProviderLabels(rows)).toEqual(rows)
})
