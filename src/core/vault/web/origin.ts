import { type WebTargetLease } from './ports'

/** WHATWG URL performs IDNA and default-port normalization; no suffix or look-alike matching. */
export function webOrigin(url: string): string {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '')
    throw new Error('useChanged')
  return parsed.origin
}

export function assertWebTarget(target: WebTargetLease, origin: string): void {
  target.assertCurrent()
  if (
    origin !== webOrigin(origin) ||
    !target.facts.certificateValid ||
    webOrigin(target.facts.topUrl) !== origin ||
    webOrigin(target.facts.frameUrl) !== origin
  )
    throw new Error('useChanged')
}
