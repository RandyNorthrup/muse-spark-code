// Desktop observability (M111 lane OB, PLAN.md D91.22): the desktop's
// problem-report facts for M93's builder. The desktop host gathers these
// from its own state (process versions, readiness probes, the crash ring,
// the export setting) and M93's builder validates and renders them. Only
// fixed vocabularies, versions and counts cross here: never an endpoint,
// a path, a setting value or a record's text.

import type { O11yCrashKind } from './crash'
import type { DesktopReadinessComponent } from './readiness'

// The desktop's facts, as its host read them. Every field is optional:
// a read that threw or timed out stays absent and the draft says
// `unknown` for it. The host calls this only on the desktop; other
// hosts omit the block entirely.
export interface DesktopReportFactsDeps {
  /** `process.versions.electron`; absent when the read never answered. */
  readonly electronVersion?: string | undefined
  /** `process.versions.chrome`; absent when the read never answered. */
  readonly chromeVersion?: string | undefined
  /** The desktop's readiness summary; absent when no probe answered. */
  readonly ready?: boolean | undefined
  /** Components whose probe was not ready, in `/readyz` order. */
  readonly unreadyComponents?: readonly DesktopReadinessComponent[] | undefined
  /** Crash records in the local ring. */
  readonly crashTotal?: number | undefined
  /** Crash kinds seen in the local ring. */
  readonly crashKinds?: readonly O11yCrashKind[] | undefined
  /** Whether OTLP export is switched on (never the endpoint). */
  readonly exportOn?: boolean | undefined
}

// The facts as M93's builder takes them: the `desktop` block alone, for
// the desktop host to spread into its facts. The builder revalidates
// every value against the allowlist and refuses the report when one is
// off it, so this passes values through without trusting them.
export function desktopReportFacts(deps: DesktopReportFactsDeps): unknown {
  return {
    desktop: {
      ...(deps.electronVersion !== undefined && { electronVersion: deps.electronVersion }),
      ...(deps.chromeVersion !== undefined && { chromeVersion: deps.chromeVersion }),
      ...(deps.ready !== undefined && { ready: deps.ready }),
      ...(deps.unreadyComponents !== undefined && {
        unreadyComponents: [...deps.unreadyComponents],
      }),
      ...(deps.crashTotal !== undefined && { crashTotal: deps.crashTotal }),
      ...(deps.crashKinds !== undefined && { crashKinds: [...deps.crashKinds] }),
      ...(deps.exportOn !== undefined && { exportOn: deps.exportOn }),
    },
  }
}
