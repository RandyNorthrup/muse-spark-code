import {
  PRIVATE_ATTACHMENT_EXTENSIONS,
  PRIVATE_ATTACHMENT_NAMES,
  PROTECTED_FILE_NAMES,
  PROTECTED_PATH_SEGMENTS,
} from '../../../src/shared/constants'

export const inspectProtectedPaths = [
  ...PROTECTED_PATH_SEGMENTS.map((parts) => parts.join('/')),
  ...PROTECTED_FILE_NAMES,
  ...PRIVATE_ATTACHMENT_NAMES,
  ...[...PRIVATE_ATTACHMENT_EXTENSIONS].map((extension) => `key${extension}`),
  '.env.production',
]

/** Seeded properties shared by the grammar and the actual native policy implementation. */
export function inspectPathSpellings(canonical: string): string[] {
  let seed = 0x12_5f_1a
  const next = () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
    return seed
  }
  return [
    canonical,
    `./${canonical.replaceAll('/', '/./')}/.`,
    ...Array.from({ length: 16 }, () => {
      const parts = canonical.split('/').flatMap((part) => {
        const inserted = [[], ['.'], ['detour', '..']][next() % 3] ?? []
        return [...inserted, part, '.']
      })
      return `./${parts.join('/'.repeat(1 + (next() % 3)))}${'/'.repeat(next() % 3)}`
    }),
  ]
}
