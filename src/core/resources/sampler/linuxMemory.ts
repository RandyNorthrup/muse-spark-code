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
    path.posix.normalize(value) === value &&
    (value === '/' || !value.endsWith('/')) &&
    !value.includes('\0')
  )
}

/** Read only this process's memory hierarchy, including enforced ancestor limits. */
export async function linuxMemoryLimit(
  read: SamplerFileReader,
): Promise<MemoryLimit | null | undefined> {
  const membership = await read('/proc/self/cgroup')
  if (membership == null) return null
  const rows = membership.split('\n').filter((line) => line !== '')
  if (rows.length === 0 || rows.some((line) => !/^(?:0:|[1-9]\d*:[^:]+):\/[^\0]*$/.test(line)))
    return null
  const memoryRow = rows.find((line) => line.split(':', 2)[1]?.split(',').includes('memory'))
  const isV1 = memoryRow !== undefined
  const row = memoryRow ?? rows.find((line) => line.startsWith('0::'))
  // Without a memory-controller membership there is no container limit to apply.
  if (row === undefined) return undefined
  const groupField = row.split(':').slice(2).join(':')
  if (!isSafePath(groupField)) return null
  const group = path.posix.normalize(groupField)
  const mounts = await read('/proc/self/mountinfo')
  const mount = mounts?.split('\n').find((line) => {
    const [kind, , options] = line.split(' - ', 2)[1]?.split(' ') ?? []
    return isV1
      ? kind === 'cgroup' && (options ?? '').split(',').includes('memory')
      : line.includes(' - cgroup2 ')
  })
  const fields = mount?.split(' ')
  const rootField = fields?.[3]
  const mountField = fields?.[4]
  if (rootField === undefined || mountField === undefined) return null
  const decodedRoot = kernelPath(rootField)
  const decodedDirectory = kernelPath(mountField)
  if (!isSafePath(decodedRoot) || !isSafePath(decodedDirectory)) return null
  const root = path.posix.normalize(decodedRoot)
  const directory = path.posix.normalize(decodedDirectory)
  // cgroup namespaces can report '/' while the mount names the host's subtree.
  let relative: string | null = null
  if (group === '/' || group === root) relative = ''
  else if (root === '/') relative = group.slice(1)
  else if (group.startsWith(`${root}/`)) relative = group.slice(root.length + 1)
  if (relative === null) return null
  const leaf = path.posix.join(directory, relative)
  let current = leaf
  let limit: MemoryLimit | undefined
  for (;;) {
    // A v1 parent's limit covers descendants only with hierarchical accounting.
    const hierarchyText =
      isV1 && current !== leaf ? await read(path.posix.join(current, 'memory.use_hierarchy')) : '1'
    const hierarchy = hierarchyText?.trim()
    if (hierarchy !== '0' && hierarchy !== '1') return null
    if (hierarchy === '1') {
      const maximumText = await read(
        path.posix.join(current, isV1 ? 'memory.limit_in_bytes' : 'memory.max'),
      )
      if (maximumText === null || (isV1 && maximumText === undefined)) return null
      // The real v2 root has no memory.max attribute. Missing v2 attributes
      // below it can indicate a disabled controller, so walk upward.
      const maximum = maximumText?.trim()
      if (maximum !== undefined && (isV1 || maximum !== 'max')) {
        const usedText = await read(
          path.posix.join(current, isV1 ? 'memory.usage_in_bytes' : 'memory.current'),
        )
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
    }
    if (current === directory) return limit
    current = path.posix.dirname(current)
  }
}
