import { EN } from './en'

// Build substitutes this projection with its own lossless English dictionary.
// Source/dev/test consumers retain the canonical English object.
export const MAKER_EN = Object.fromEntries(
  Object.entries(EN).filter(([key]) => key.startsWith('maker')),
)
