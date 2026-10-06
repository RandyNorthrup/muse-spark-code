import path from 'node:path'
import { counterReading } from './readings'

export type SamplerFileReader = (file: string) => Promise<string | null | undefined>
interface MemoryLimit {
  total: number
  available: number
}

function kernelPath(value: string): string {
  return value
    .replaceAll(String.raw`\040`, ' ')
    .replaceAll(String.raw`\011`, '\t')
    .replaceAll(String.raw`\012`, '\n')
    .replaceAll(String.raw`\134`, '\\')
}

function isSafePath(value: string): boolean {
  return (
    value.startsWith('/') &&
    value.split('/').every((part) => part !== '..' && part !== '.') &&
    !value.includes('\0')
  )
}

/** Read only this process's cgroup v2 hierarchy, including tighter ancestor limits. */
export async function linuxMemoryLimit(
  read: SamplerFileReader,
): Promise<MemoryLimit | null | undefined> {
  const membership = await read('/proc/self/cgroup')
  if (membership == null) return null
  const row = membership.split('\n').find((line) => line.startsWith('0::'))
  // An OS without v2 has no v2 limit to apply; a failed v2 read remains unknown.
  if (row === undefined) return undefined
  const group = row.slice('0::'.length)
  if (!isSafePath(group)) return null
  const mounts = await read('/proc/self/mountinfo')
  const mount = mounts?.split('\n').find((line) => line.includes(' - cgroup2 '))
  const fields = mount?.split(' ')
  const rootField = fields?.[3]
  const mountField = fields?.[4]
  if (rootField === undefined || mountField === undefined) return null
  const root = kernelPath(rootField)
  const directory = kernelPath(mountField)
  if (!isSafePath(root) || !isSafePath(directory)) return null
  // cgroup namespaces can report '/' while the mount names the host's subtree.
  let relative: string | null = null
  if (group === '/' || group === root) relative = ''
  else if (root === '/') relative = group.slice(1)
  else if (group.startsWith(`${root}/`)) relative = group.slice(root.length + 1)
  if (relative === null) return null
  let current = path.posix.join(directory, relative)
  let limit: MemoryLimit | undefined
  for (;;) {
    const maximumText = await read(path.posix.join(current, 'memory.max'))
    if (maximumText === null) return null
    // The real cgroup hierarchy root has no memory.max attribute. Missing
    // attributes below it can indicate a disabled controller, so walk upward.
    const maximum = maximumText?.trim()
    if (maximum !== undefined && maximum !== 'max') {
      const usedText = await read(path.posix.join(current, 'memory.current'))
      const used = usedText?.trim()
      if (used === undefined || !/^\d+$/.test(maximum) || !/^\d+$/.test(used)) return null
      const total = counterReading(Number(maximum))
      const usage = counterReading(Number(used))
      if (total === null || total === 0 || usage === null) return null
      const available = Math.max(0, total - usage)
      limit = {
        total: Math.min(limit?.total ?? total, total),
        available: Math.min(limit?.available ?? available, available),
      }
    }
    if (current === directory) return limit
    current = path.posix.dirname(current)
  }
}
