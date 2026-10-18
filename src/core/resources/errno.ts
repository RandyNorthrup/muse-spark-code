/**
 * Narrows an unknown throw to a Node system error: an Error carrying a string
 * `code` and a numeric `errno` (ENOENT, EACCES, ESRCH, …). Probes, readers and
 * registries use it to name the failures they expect; anything else rethrows
 * instead of reading as absent, unknown or invalid.
 *
 * Both fields are required: Node's own TypeErrors (a fatal text decode, an
 * invalid argument) also carry a string `code`, but they are never system
 * failures and must stay loud.
 */
export function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    'errno' in error &&
    typeof error.errno === 'number'
  )
}
