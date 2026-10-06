import {
  scheduleApprovalActionSchema,
  scheduleGrantSchema,
  type ScheduleApprovalAction,
  type ScheduleGrant,
  type ScheduleGrantMatcher,
  type ScheduleGrantRule,
} from '../../shared/scheduleV2'
import { commandShape, type ShellDialect } from '../backends/modelapi/shellSyntax'
import { judgeCommand } from '../backends/modelapi/commandRules'
import { isProtectedPath } from '../protectedPaths'

/** Only relative glob segments; unsupported expansion syntax fails closed. */
function isSafeRelative(value: string): boolean {
  return (
    value.length > 0 &&
    !/^(?:[\\/]|[a-z]:)/i.test(value) &&
    !/[\p{Cc}:{}[\]!]/u.test(value) &&
    value.split(/[\\/]/).every((part) => part !== '' && part !== '.' && part !== '..')
  )
}

function isGlobMatch(glob: string, path: string): boolean {
  const parts = glob.replaceAll('\\', '/').split('/')
  const names = path.replaceAll('\\', '/').split('/')
  let positions = new Set([0])
  for (const part of parts) {
    const next = new Set<number>()
    if (part === '**') {
      for (const position of positions) {
        for (let index = position; index <= names.length; index += 1) next.add(index)
      }
    } else {
      const pattern = part
        .split(/([*?])/)
        .map((piece) => {
          if (piece === '*') return '[^/]*'
          return piece === '?' ? '[^/]' : piece.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
        })
        .join('')
      const expression = new RegExp(`^${pattern}$`, 'u')
      for (const position of positions) {
        if (position < names.length && expression.test(names[position] ?? ''))
          next.add(position + 1)
      }
    }
    positions = next
  }
  return positions.has(names.length)
}

/** Callers canonicalize paths before matching; safety never depends on a grant. */
export class ScheduleGrants implements ScheduleGrantMatcher {
  public constructor(private readonly dialect: ShellDialect) {}

  public matches(
    grant: ScheduleGrant,
    action: ScheduleApprovalAction,
  ): ScheduleGrantRule | undefined {
    scheduleGrantSchema.parse(grant)
    scheduleApprovalActionSchema.parse(action)
    if (
      action.class === 'physical' ||
      action.class === 'protectedPath' ||
      action.class === 'requiresAsking' ||
      action.class === 'paidExtra' ||
      action.requiresAsking ||
      action.protectedPath ||
      action.paths.some(
        (path) => !isSafeRelative(path) || isProtectedPath(path.replaceAll('\\', '/')),
      )
    )
      return undefined
    return grant.rules.find((rule) => {
      switch (rule.kind) {
        case 'command': {
          if (action.class !== 'shell' || action.command === undefined) return false
          const prefix = commandShape(rule.prefix, this.dialect)
          if (!prefix.isPlain || prefix.commands.length !== 1) return false
          return (
            judgeCommand(
              [
                {
                  pattern: prefix.commands[0] ?? [],
                  decision: 'allow',
                  dialects: [this.dialect],
                  justification: undefined,
                },
              ],
              action.command,
              this.dialect,
            ).decision === 'allow'
          )
        }
        case 'path': {
          return (
            action.class === 'edit' &&
            rule.access === 'edit' &&
            isSafeRelative(rule.glob) &&
            action.paths.length > 0 &&
            action.paths.every((path) => isGlobMatch(rule.glob, path))
          )
        }
        case 'tool': {
          return action.class !== 'shell' && action.class !== 'edit' && rule.name === action.tool
        }
      }
    })
  }
}
