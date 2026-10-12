import process from 'node:process'

/** The receipt names this verified finished-tree race; every live/unknown failure stays red. */
export function expectedReceiptWarning(kind, stack, work, groupIsGone = nativeGroupIsGone) {
  return kind !== 'warn' ||
    !/\.sampleTree\s*\(/u.test(stack ?? '') ||
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

function nativeGroupIsGone(pid) {
  try {
    process.kill(-pid, 0)
    return false
  } catch (error) {
    return error.code === 'ESRCH'
  }
}
