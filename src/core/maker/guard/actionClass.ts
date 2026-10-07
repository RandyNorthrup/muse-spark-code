/** Physical effects are decided locally, never from a server's read-only hint. */
export type ActionClass = 'offline' | 'observe' | 'connect' | 'program' | 'actuate' | 'refused'

/** The classes that require one fresh human answer, or an unconditional refusal. */
export function isDeviceAction(action: ActionClass | undefined): boolean {
  return action !== undefined && action !== 'offline' && action !== 'observe'
}

/** Known physical MCP namespaces; aliases still need the host's physical-server marking. */
const PHYSICAL_SERVER =
  /(?:^|__)(?:[^_]*[-_])?(?:moonraker|octoprint|prusalink|klipper|grbl|fluidnc|cncjs|ugs|serial|platformio|arduino|esp[-_]idf|ros|robotmcp|robot|armguard|3d-printer|printer|kiln|bambu)(?:[-_]|__|$)/i

export function isPhysicalTool(toolName: string): boolean {
  return toolName.startsWith('mcp__') && PHYSICAL_SERVER.test(toolName)
}
