// D261 (lane RLF-FALLBACK): the model a refused turn continues on.
//
// When the person names a fallback model and a reply stops with the
// provider's `refusal` stop reason, the turn continues on the named model
// instead of ending with the refusal. Only `refusal` switches: overload,
// rate limits and server errors stay on the request's own retry path, and
// other stop reasons end the turn as today. One fallback per refusal: after
// the switch the session runs on the fallback model, so a second refusal
// names the model already running and switches nowhere.
export interface RefusalFallbackAsk {
  /** The incomplete reason the reply stopped with, if it stopped incomplete. */
  readonly incompleteReason: string | undefined
  /** The standing fallback value: the setting, or the session's own override. */
  readonly fallbackModel: string
  /** The model id the refused request was sent to. */
  readonly refusedModel: string
  /** Whether this turn already fell back once. */
  readonly didFallback: boolean
}

/**
The model the refused turn continues on, or undefined when the refusal
stands: anything but a `refusal` stop, nothing (or blank) named, the named
model already running, or a turn that already fell back once.
*/
export function refusalFallbackTarget(ask: RefusalFallbackAsk): string | undefined {
  if (ask.incompleteReason !== 'refusal' || ask.didFallback) return undefined
  const target = ask.fallbackModel.trim()
  return target === '' || target === ask.refusedModel ? undefined : target
}
