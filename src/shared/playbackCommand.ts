// `/playback` typed in the prompt (D203): the agent plays back its current
// understanding of the goal and instructions from its working memory only,
// with no tools for the turn. Bare `/playback` runs; `/playback` with
// anything after it is usage, since a playback takes no arguments; anything
// else is ordinary prompt text. Pure; the surface runs the turn instead of
// sending a message.

export type PlaybackPrompt = { readonly kind: 'run' } | { readonly kind: 'usage' }

const PLAYBACK_PROMPT = /^\/playback(?:\s+([\s\S]*))?$/

/** The playback command a prompt is, or undefined for any other text. */
export function parsePlaybackPrompt(text: string): PlaybackPrompt | undefined {
  const match = PLAYBACK_PROMPT.exec(text.trim())
  if (match === null) {
    return undefined
  }
  return { kind: (match[1] ?? '').trim() === '' ? 'run' : 'usage' }
}
