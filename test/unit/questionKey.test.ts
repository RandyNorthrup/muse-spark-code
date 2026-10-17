import { expect, it } from 'vitest'
import { questionKey } from '../../src/core/questions/key'
import { questionFixture } from './helpers/questions/fixtures'

it('normalizes text and label sets with NFC, whitespace folding and locale-independent case', () => {
  const base = questionFixture().questions
  const first = base[0]
  if (first === undefined) throw new Error('missing fixture')
  const changed = [
    {
      ...first,
      id: 'new-id',
      header: 'Another header',
      question: '  WHICH\n colour?\t',
      options: [{ label: ' GREEN ' }, { label: 'blue' }, { label: 'Blue' }],
    },
  ]
  expect(questionKey(base)).toBe(questionKey(changed))
  expect(questionKey([{ ...first, question: 'é' }])).toBe(
    questionKey([{ ...first, question: 'e\u{301}' }]),
  )
  expect(questionKey([{ ...first, question: 'I' }])).toBe(
    questionKey([{ ...first, question: 'i' }]),
  )
  expect(questionKey([{ ...first, question: 'Different?' }])).not.toBe(questionKey(base))
  expect(questionKey([{ ...first, options: [{ label: 'Red' }] }])).not.toBe(questionKey(base))
})
