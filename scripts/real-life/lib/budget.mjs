// What the run may spend, and what it has spent: model requests and dollars.
// A cell (one scenario on one route by one surface) says the most requests
// it can make; the run starts it only while that still fits, and stops for
// good once either cap is reached. Dollars are counted in millionths, as the
// product counts them, so no sum drifts.
//
// Two kinds of dollars are kept apart, as the product keeps them apart:
// `settled` is usage a provider reported, at the model's price, and is what
// the dollar cap counts; `uncertain` is what the product booked for a
// request that ended with no usage report (a refusal, a stop, a broken
// answer), which is its whole reservation and no charge anyone made.

const MICRO = 1_000_000

/** Dollars as the product prints them (a decimal string) in millionths of a dollar. */
export function microUsd(text) {
  const [whole = '0', part = ''] = String(text).trim().split('.', 2)
  return /^\d+$/u.test(whole) && /^\d*$/u.test(part)
    ? Number(whole) * MICRO + Number(part.padEnd(6, '0').slice(0, 6))
    : NaN
}

/** Millionths of a dollar as a decimal string with six places. */
export function usdText(micro) {
  const whole = Math.floor(micro / MICRO)
  return `${String(whole)}.${String(micro - whole * MICRO).padStart(6, '0')}`
}

/**
 * @param {number} maxRequests
 * @param {number} maxUsd settled dollars
 * @param {number} maxUncertainUsd dollars booked for requests that were sent and came back with no usage
 */
export function allowance(maxRequests, maxUsd, maxUncertainUsd) {
  const cap = {
    requests: maxRequests,
    micro: Math.round(maxUsd * MICRO),
    uncertain: Math.round(maxUncertainUsd * MICRO),
  }
  const spent = { requests: 0, micro: 0, uncertain: 0, turnedAway: 0 }
  // Once a cell did not fit, nothing later is started either: a smaller
  // cell slipping in after a larger one was turned away is not a cap.
  let ended
  return {
    cap,
    spent,
    /** Why a cell that may make this many requests cannot start; nothing when it can. */
    refusal(cellRequests) {
      if (ended !== undefined) return ended
      if (spent.micro >= cap.micro) {
        ended = `the dollar cap is reached ($${usdText(spent.micro)} of $${usdText(cap.micro)} of reported usage)`
      } else if (spent.uncertain >= cap.uncertain) {
        ended = `$${usdText(spent.uncertain)} is booked for requests that were sent and came back with no usage report: that may be real money, and the run stops at $${usdText(cap.uncertain)} of it`
      } else if (spent.requests + cellRequests > cap.requests) {
        ended = `the request cap is reached (it may make ${String(cellRequests)} requests and ${String(cap.requests - spent.requests)} of the ${String(cap.requests)} remain)`
      }
      return ended
    },
    /** Ends the run for a reason of its own: nothing more is started. */
    end(reason) {
      ended ??= reason
    },
    /**
     * @param {number} requests
     * @param {number} micro settled dollars, in millionths
     * @param {number} [uncertain] booked with no usage report, in millionths
     * @param {number} [turnedAway] runs the product turned away before sending, at the run's asking
     */
    spend(requests, micro, uncertain = 0, turnedAway = 0) {
      spent.requests += requests
      spent.micro += micro
      spent.uncertain += uncertain
      spent.turnedAway += turnedAway
    },
  }
}
