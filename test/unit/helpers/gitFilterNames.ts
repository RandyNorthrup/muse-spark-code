// What `git config --null --name-only --get-regexp` must never be trusted to
// have printed (M72's environment facts and M70's review read the same
// listing): a name with `=` in it, one past the length limit, more names than
// the limit, and a listing git could not read at all.

import { GIT_FILTER_NAME_MAX_CHARS, GIT_FILTER_NAMES_MAX } from '../../../src/shared/constants'

/** The hostile listings, the last as the error a failed read rejects with. */
export function hostileFilterListings(unreadableMessage: string): readonly (string | Error)[] {
  return [
    'filter.bad=name.clean\u{0}',
    `filter.${'x'.repeat(GIT_FILTER_NAME_MAX_CHARS)}.clean\u{0}`,
    Array.from(
      { length: GIT_FILTER_NAMES_MAX + 1 },
      (_, index) => `filter.p${String(index)}.clean\u{0}`,
    ).join(''),
    Object.assign(new Error(unreadableMessage), { code: 'EACCES' }),
  ]
}
