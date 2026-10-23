/**
Narrows an unknown throw to a Node system error: an Error carrying a string
`code` and a numeric `errno` (ENOENT, EACCES, ESRCH, …). Probes, readers and
registries use it to name the failures they expect; anything else rethrows
instead of reading as absent, unknown or invalid.

Both fields are required: Node's own TypeErrors (a fatal text decode, an
invalid argument) also carry a string `code`, but they are never system
failures and must stay loud.
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

/**
Narrows an unknown throw to a DNS failure: an Error carrying a string
`code` and a string `syscall` (ENOTFOUND, ENODATA, EAI_AGAIN, …).
c-ares sets no numeric `errno`, so `isErrno` never matches here; the
`syscall` keeps Node's own TypeErrors (which also carry a string
`code`) loud.
*/
export function isDnsFailure(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    'syscall' in error &&
    typeof error.syscall === 'string'
  )
}

/**
Narrows an unknown throw to a failure carrying a machine-readable
code: an errno string from the kernel or an exit-status number from a
tool. For calls whose inputs are already validated, where a code
always means the failure the caller expects; anything else rethrows
instead of reading as absent or falling back.
*/
export function isCodedFailure(error: unknown): error is Error & { readonly code: unknown } {
  return error instanceof Error && 'code' in error
}
