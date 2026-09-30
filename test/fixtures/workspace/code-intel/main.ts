// The code intelligence fixture's caller (M67): two calls to greet, and one
// to a library method, whose declaration is outside the workspace.
import { greet } from './greet'

/** Greets two people, loudly. */
export function main(): string {
  return `${greet('Ada')} ${greet('Grace')}`.toUpperCase()
}
