// The Windows job-object tree reader (dist/resourceGovernorWindows.js),
// required the first time a Windows job launch binds its tree, so the
// governor bundle keeps its 125 KiB cap. Reached through the deferred
// cohort like admission reaches the governor: the entry imports this
// module dynamically and the build externalises it to the sibling bundle.
import { WindowsResourceTreeReader, type WindowsTreeDeps } from './windows'

export function createWindowsResourceTreeReader(deps: WindowsTreeDeps): WindowsResourceTreeReader {
  return new WindowsResourceTreeReader(deps)
}
