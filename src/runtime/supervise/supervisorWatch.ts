// A supervised run leads its own process group, so nothing ends it when its
// supervisor dies without running its stop: a KILL, a signal arriving before the
// supervisor's handlers are in, or a machine's own teardown. On POSIX the run
// therefore keeps an eye on its supervisor, and when that is gone it ends its
// group the way the supervisor's stop would. On Windows the attested job's
// kill-on-close does this, and the run's parent is the job's helper besides.
import {
  SUPERVISOR_PID_VARIABLE,
  SUPERVISOR_WATCH_MS,
  TREE_EXIT_WAIT_MS,
} from '../../shared/constants'

/** Arms the watch when this process is a supervised run of the supervisor still above it. */
export function watchSupervisor(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): void {
  const supervisor = env[SUPERVISOR_PID_VARIABLE]
  // This process only: a command it starts has a supervisor of its own, or none.
  Reflect.deleteProperty(env, SUPERVISOR_PID_VARIABLE)
  if (supervisor === undefined || platform === 'win32' || String(process.ppid) !== supervisor)
    return
  const watch = setInterval(() => {
    if (String(process.ppid) === supervisor) return
    clearInterval(watch)
    process.kill(-process.pid, 'SIGTERM')
    setTimeout(() => {
      process.kill(-process.pid, 'SIGKILL')
    }, TREE_EXIT_WAIT_MS).unref()
  }, SUPERVISOR_WATCH_MS)
  // The watch keeps nothing alive: a run that is done just ends.
  watch.unref()
}
