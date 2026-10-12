// The quota identity a team host stamps on its observations (agent teams).
// The transport admits every attempt with the credential it actually used;
// the host carries that digest from final admission, and its recorder
// wrapper attributes a bring-your-own model's rows to it, never re-read
// after the response. Meta rows keep the reservation's budget identity,
// which also covers key-less flows the offer side cannot see. Housed
// beside usage recording; the Model API bundle stamps the reservation's
// identity as before and carries none of it (CM963JR4 veto).
import type { UsageRecording } from './recording'

/**
 * The credential a host's attempts use, carried from final admission: the
 * host notes each admitted attempt's digest here, and its recorder wrapper
 * stamps observations with it. One session per host, so one stash per host
 * is exact. An undefined admission never clears the carried digest.
 */
export interface TeamQuotaStash {
  readonly noteAttempt: (keyDigest: string | undefined) => void
  readonly current: () => string | undefined
}

export function teamQuotaStash(): TeamQuotaStash {
  let attemptKeyDigest: string | undefined
  return {
    noteAttempt: (keyDigest: string | undefined) => {
      if (keyDigest !== undefined) attemptKeyDigest = keyDigest
    },
    current: () => attemptKeyDigest,
  }
}

/**
 * The stamp for one recorded row: a non-Meta provider attributes its quota
 * to the credential the attempt used; Meta keeps the reservation's budget
 * identity. A removed credential's old quota gives no offer: without a
 * carried digest the reservation stays (P2-4, P3-6). The provider arrives
 * from the same model id the quote named, so the quote, the admission and
 * the stamp compare one identity end to end (P2-A).
 */
export function stampQuotaRow(options: {
  readonly provider: string
  readonly attemptKeyDigest: string | undefined
  readonly reservationAccount: string | undefined
}): string | undefined {
  return options.provider === 'meta'
    ? options.reservationAccount
    : (options.attemptKeyDigest ?? options.reservationAccount)
}

/**
 * A team host's usage recording: rows pass through, re-stamped with the
 * credential the attempt used. Hosts without a team stash record exactly
 * what the session stamped.
 */
export function restampTeamQuota(
  recording: UsageRecording | undefined,
  stash: { readonly current: () => string | undefined } | undefined,
): UsageRecording | undefined {
  return recording === undefined || stash === undefined
    ? recording
    : {
        ...recording,
        limit: (context: Parameters<UsageRecording['limit']>[0], isForced?: boolean) => {
          const stamped = stampQuotaRow({
            provider: context.provider,
            attemptKeyDigest: stash.current(),
            reservationAccount: context.observedAccount,
          })
          recording.limit(
            stamped === context.observedAccount
              ? context
              : { ...context, observedAccount: stamped },
            isForced,
          )
        },
      }
}
