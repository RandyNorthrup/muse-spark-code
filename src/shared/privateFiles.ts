// A file that may hold secrets, by its name alone (M54's attachment rule,
// shared since M70): environment files, keys and credentials. It is never
// attached to a message, and a review leaves its changes out of the diff it
// sends. No `vscode`, Node or DOM imports: the webview uses it too.

import {
  PRIVATE_ATTACHMENT_EXTENSIONS,
  PRIVATE_ATTACHMENT_NAMES,
  PRIVATE_ENV_PREFIX,
} from './constants'

const SEPARATORS = /[/\\]/

/** The name's final dot suffix, including a basename equal to that suffix. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot)
}

/** Whether the file a path (or a bare name) names may hold secrets. */
export function isPrivateFileName(pathOrName: string): boolean {
  const name = (pathOrName.split(SEPARATORS).at(-1) ?? '').toLowerCase()
  return (
    name.startsWith(PRIVATE_ENV_PREFIX) ||
    PRIVATE_ATTACHMENT_NAMES.has(name) ||
    PRIVATE_ATTACHMENT_EXTENSIONS.has(extensionOf(name))
  )
}
