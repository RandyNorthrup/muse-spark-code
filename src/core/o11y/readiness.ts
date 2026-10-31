// Desktop observability (M111 lane OB, PLAN.md D91.22): the desktop's
// readiness components. The node's `/readyz` gains these once the desktop
// profile is present (research §11): the compositor answers IPC within
// 250 ms, the shell's surfaces are mapped, the app's windows respond, and
// sysd is connected to its services. Each lane owns its probe (CP, SH1,
// WB, SY); this module owns the shapes and the evaluation, against lane
// 0's contracts.

import * as z from 'zod/mini'
import { O11Y_COMPOSITOR_PING_MAX_MS, REPORT_ERROR_CODE_MAX_CHARS } from '../../shared/constants'

/** The desktop's readiness components, in `/readyz` order. */
export const DESKTOP_READINESS_COMPONENTS = ['compositor', 'shell', 'app', 'sysd'] as const
export type DesktopReadinessComponent = (typeof DESKTOP_READINESS_COMPONENTS)[number]

/** One component's probe result: a word and a fixed detail, never a sentence. */
export const desktopProbeSchema = z.strictObject({
  component: z.enum(DESKTOP_READINESS_COMPONENTS),
  ready: z.boolean(),
  /** A fixed detail word from the probing lane (`ping-ok`, `no-windows`…). */
  detail: z.string().check(z.minLength(1), z.maxLength(REPORT_ERROR_CODE_MAX_CHARS)),
  /** The compositor IPC round trip, when the probe measured one. */
  pingMs: z.optional(z.int().check(z.gte(0))),
})
export type DesktopProbe = z.infer<typeof desktopProbeSchema>

/** The desktop's readiness as `/readyz` reports it. */
export interface DesktopReadiness {
  readonly ready: boolean
  readonly components: readonly DesktopProbe[]
}

/**
Evaluate the desktop's probes: every named component must be ready, and
the compositor's ping must be within O11Y_COMPOSITOR_PING_MAX_MS. A
component with no probe is not ready: readiness is proven, never
assumed. The input is never mutated.
*/
export function evaluateDesktopReadiness(probes: readonly DesktopProbe[]): DesktopReadiness {
  const byComponent = new Map(probes.map((probe) => [probe.component, probe]))
  const components = DESKTOP_READINESS_COMPONENTS.map(
    (component) => byComponent.get(component) ?? { component, ready: false, detail: 'no-probe' },
  )
  const compositor = byComponent.get('compositor')
  const isPingOk =
    compositor !== undefined &&
    (compositor.pingMs === undefined || compositor.pingMs <= O11Y_COMPOSITOR_PING_MAX_MS)
  return {
    ready: isPingOk && components.every((component) => component.ready),
    components,
  }
}

/** The probes the desktop lanes supply; the node calls this for `/readyz`. */
export interface DesktopReadinessPort {
  probe(signal: AbortSignal): Promise<readonly DesktopProbe[]>
}
