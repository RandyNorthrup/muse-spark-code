// Re-export runUsageCommand from lane S's usageServiceEntry. Keeping this
// implementation in that lazy bundle avoids carrying page schemas into ACP.
import type { UsageCommand } from '../cliArgs'
import type { UsageAccess } from './usageAdapter'
import {
  parseUsagePageToServiceMessage,
  parseUsageServiceToPageMessage,
} from '../../shared/usagePage'
import type { UsagePagePorts } from './usageAdapter'

export interface UsageCliPorts {
  readonly usage: UsageAccess
  readonly openPage: () => Promise<string>
  readonly openBrowser: (url: string) => Promise<void>
  readonly input: AsyncIterable<string> | Iterable<string>
  readonly print: (text: string) => Promise<void>
  readonly writeFile: (file: string, content: string) => Promise<void>
  /** Native plugins supply host actions through their own editor adapter. */
  readonly pagePorts?: Omit<UsagePagePorts, 'post'>
}

/** The text, export and stdio surfaces consume the same service as the page. */
export async function runUsageCommand(
  command: UsageCommand,
  ports: UsageCliPorts,
): Promise<number> {
  if (command.action === 'open') {
    const url = await ports.openPage()
    await ports.openBrowser(url)
    await ports.print(`${url}\n`)
    return 0
  }
  if (command.action === 'stdio') {
    let outbox = Promise.resolve()
    const post: UsagePagePorts['post'] = (message) => {
      const parsed = parseUsageServiceToPageMessage(message)
      const previous = outbox
      outbox = (async () => {
        await previous
        // A failed print rejects the outbox, and the loop below surfaces it
        // at its next step with disposal; nothing is captured or replaced.
        await ports.print(
          `${JSON.stringify(
            parsed.ok
              ? parsed.message
              : {
                  type: 'usage/error',
                  code: 'invalidMessage',
                },
          )}\n`,
        )
      })()
    }
    const connection = ports.usage.connect({
      ...ports.pagePorts,
      post,
    })
    try {
      for await (const line of ports.input) {
        let input: unknown
        try {
          input = JSON.parse(line)
        } catch (error) {
          // A line no JSON value denotes is no message. Anything else keeps
          // its kind.
          if (!(error instanceof SyntaxError)) throw error
          input = undefined
        }
        const parsed = parseUsagePageToServiceMessage(input)
        if (parsed.ok) {
          try {
            await connection.receive(parsed.message)
          } catch {
            // One failed message reports its fixed code; the session survives.
            post({ type: 'usage/error', code: 'readFailed' })
          }
        } else post({ type: 'usage/error', code: 'invalidMessage' })
        await outbox
      }
      await outbox
    } finally {
      connection.dispose()
    }
    return 0
  }
  const csvFormat = command.action === 'export' ? 'callsCsv' : 'summaryCsv'
  const content =
    command.format === 'text'
      ? ports.usage.usageText(
          await ports.usage.read(command.query),
          'plain',
          command.action === 'export' ? 'summary' : command.action,
        )
      : await ports.usage.export(command.query, command.format === 'json' ? 'json' : csvFormat)
  if (command.out === undefined) {
    await ports.print(content.endsWith('\n') ? content : `${content}\n`)
  } else {
    await ports.writeFile(command.out, content)
  }
  return 0
}
