import process from 'node:process'

/**
 * The receipt names this verified finished-tree race; every live/unknown failure stays red.
 *
 * RVCM109JD P2-2: the whitelist identifies the failure CAUSE, not only the
 * work state. The sampler stamps a fixed typed cause on the work it reports;
 * only the exact membership-race cause is ever expected. An unrelated fatal
 * sampler error (EACCES from gone(), a refused policy stop, anything else)
 * reaches this classifier with a different cause and fails the receipt.
 */
export function expectedReceiptWarning(kind, stack, work, groupIsGone = nativeGroupIsGone) {
  return kind !== 'warn' ||
    !hasSamplerFrame(stack) ||
    work?.samplerCause !== 'unproven-membership' ||
    work?.known !== false ||
    work.ticket !== undefined ||
    work.ended !== true ||
    work.process?.group !== true ||
    !['contained', 'probe'].includes(work.process.profile) ||
    !Number.isSafeInteger(work.process.pid) ||
    work.process.pid <= 1 ||
    work.binding?.root?.pid !== work.process.pid ||
    !groupIsGone(work.process.pid)
    ? null
    : 'finished-native-helper-membership-race'
}

/**
 * The sampler location, matched whole and anchored: one complete production
 * frame line, `at [async ]ResourceLaunchHost.sampleTree (file:line:col)`.
 * A substring match would admit failures merely observed near the sampler.
 */
function hasSamplerFrame(stack) {
  return (
    typeof stack === 'string' &&
    stack
      .split('\n')
      .some((line) =>
        /^at (?:async )?ResourceLaunchHost\.sampleTree \(.+:[0-9]+:[0-9]+\)$/u.test(line),
      )
  )
}

/**
 * Counted allowance per accepted warning name. Each ignored warning consumes
 * one allowance; over the allowance (or an unknown name) the receipt fails,
 * so a storm of individually plausible warnings still fails the receipt.
 */
export function createWarningBudget(allowances) {
  const limits = new Map(Object.entries(allowances))
  const used = new Map()
  return {
    admit(name) {
      const allowed = limits.get(name) ?? 0
      const count = (used.get(name) ?? 0) + 1
      used.set(name, count)
      return count <= allowed
    },
  }
}

function nativeGroupIsGone(pid) {
  try {
    process.kill(-pid, 0)
    return false
  } catch (error) {
    return error.code === 'ESRCH'
  }
}
