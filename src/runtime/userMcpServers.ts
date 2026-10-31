// `--no-user-mcp-servers` (the team's own agent, RLF-TEAMWORKERS2): the agent
// serves only while the person's own Muse Code settings turn no MCP server on.
// Muse Code 1.4.14 offers no switch that leaves a configured server out for
// one run: `-c mcpServers.<name>.enabled=false` is accepted for a name the
// settings do not hold and refused ("the server name is reserved") for one
// they do, so the agent refuses to open a session instead of starting a
// Muse Code that would load them. Pure but for the read it is handed.

import { readMcpServerEntries } from '../core/backends/musecode/museConfigView'
import { isErrno } from '../core/fs/errno'
import { UI_TEXT } from '../shared/constants'

/**
The sentence that refuses a session, or undefined when the settings turn no
MCP server on (a missing file holds none). A file that exists but cannot be
read, or does not parse, cannot show that it holds none: that refuses too.
*/
export function userMcpServersRefusal(readSettings: () => string | undefined): string | undefined {
  let text: string | undefined
  try {
    text = readSettings()
  } catch (error: unknown) {
    // A settings file the system will not hand over is the person's to repair;
    // anything that is not a file-system failure is not this guard's to name.
    if (!isErrno(error)) throw error
    return UI_TEXT.acpUserMcpServersUnreadable
  }
  const read = readMcpServerEntries(text)
  if (read.status === 'missing') return undefined
  if (read.status === 'unreadable') return UI_TEXT.acpUserMcpServersUnreadable
  return read.entries.some(({ view }) => view.isEnabled)
    ? UI_TEXT.acpUserMcpServersConfigured
    : undefined
}
