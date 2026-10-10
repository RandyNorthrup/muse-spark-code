import { useState } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { scheduleGrantRuleText } from './presentation'
import type { ScheduleGrant, ScheduleGrantRule } from '../../shared/scheduleV2'

export function GrantFields({
  grant,
  onChange,
}: {
  readonly grant: ScheduleGrant
  readonly onChange: (value: ScheduleGrant) => void
}) {
  const kinds = ['tool', 'command', 'path'] as const
  const [text, setText] = useState(() => ({
    tool: grant.rules
      .filter((rule) => rule.kind === 'tool')
      .map((rule) => scheduleGrantRuleText(rule))
      .join('\n'),
    command: grant.rules
      .filter((rule) => rule.kind === 'command')
      .map((rule) => scheduleGrantRuleText(rule))
      .join('\n'),
    path: grant.rules
      .filter((rule) => rule.kind === 'path')
      .map((rule) => scheduleGrantRuleText(rule))
      .join('\n'),
  }))
  const labels = {
    tool: UI_TEXT.scheduleV2.labels.tools,
    command: UI_TEXT.scheduleV2.labels.commands,
    path: UI_TEXT.scheduleV2.labels.paths,
  }
  return (
    <fieldset>
      <legend>{UI_TEXT.scheduleV2.labels.grant}</legend>
      <p>{UI_TEXT.scheduleV2.editor.grantHelp}</p>
      {kinds.map((kind) => (
        <label key={kind}>
          {labels[kind]}
          <textarea
            value={text[kind]}
            onChange={(event) => {
              const lines = event.target.value
              setText({ ...text, [kind]: lines })
              const rules: ScheduleGrantRule[] =
                lines === ''
                  ? []
                  : lines.split('\n').map((line) => {
                      const id =
                        grant.rules.find(
                          (rule) => rule.kind === kind && scheduleGrantRuleText(rule) === line,
                        )?.id ?? crypto.randomUUID()
                      switch (kind) {
                        case 'tool': {
                          return { id, kind, name: line }
                        }
                        case 'command': {
                          return { id, kind, prefix: line }
                        }
                        case 'path': {
                          return {
                            id,
                            kind,
                            access: line.startsWith('edit: ') ? 'edit' : 'read',
                            glob: line.replace(/^(?:edit|read): /, ''),
                          }
                        }
                      }
                    })
              onChange({
                ...grant,
                rules: [...grant.rules.filter((rule) => rule.kind !== kind), ...rules],
              })
            }}
          />
        </label>
      ))}
    </fieldset>
  )
}
