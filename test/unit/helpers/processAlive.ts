// Whether a process the test started is still running: the one probe the
// suites that start real children share, by signal 0.

/** True while the process answers signal 0; false once it is gone. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    throw error
  }
}
