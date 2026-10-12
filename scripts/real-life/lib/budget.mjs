// What the run may spend, and what it has spent: model requests and dollars.
// A cell (one scenario on one route by one surface) says the most requests
// it can make; the run starts it only while that still fits, and stops for
// good once either cap is reached. Dollars are counted in millionths, as the
// product counts them, so no sum drifts.

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
 * @param {number} maxUsd
 */
export function allowance(maxRequests, maxUsd) {
  const cap = { requests: maxRequests, micro: Math.round(maxUsd * MICRO) }
  const spent = { requests: 0, micro: 0 }
  return {
    cap,
    spent,
    /** Why a cell that may make this many requests cannot start; nothing when it can. */
    refusal(cellRequests) {
      if (spent.micro >= cap.micro) {
        return `the dollar cap is reached ($${usdText(spent.micro)} of $${usdText(cap.micro)})`
      }
      return spent.requests + cellRequests > cap.requests
        ? `it may make ${String(cellRequests)} requests and ${String(cap.requests - spent.requests)} of the ${String(cap.requests)} remain`
        : undefined
    },
    spend(requests, micro) {
      spent.requests += requests
      spent.micro += micro
    },
  }
}
