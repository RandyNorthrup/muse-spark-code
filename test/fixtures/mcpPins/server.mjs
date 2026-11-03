// A real MCP stdio server for the tool-pin pool test (SEC-MCP-PIN): the
// official SDK's low-level server, listing the tools a JSON file names so
// the test can change what the server says between starts, as a server
// update would. Usage: node server.mjs <tools.json>, where the file is a
// list of {name, description, readOnly}.
import { readFileSync } from 'node:fs'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const listed = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const server = new Server(
  { name: 'rlf-secmcp-pins', version: '1.0.0' },
  { capabilities: { tools: {} } },
)
server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: listed.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: { type: 'object', properties: {} },
    ...(tool.readOnly === true && { annotations: { readOnlyHint: true } }),
  })),
}))
server.setRequestHandler(CallToolRequestSchema, (request) => ({
  content: [{ type: 'text', text: `called ${request.params.name}` }],
}))
await server.connect(new StdioServerTransport())
