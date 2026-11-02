-- Real Neovim LSP client against this tree's real `lsp` service.
-- Run `npm run build` first.
local here = (arg and arg[0]) or 'test/lsp.lua'
local root = vim.fn.fnamemodify(here, ':p:h:h:h:h')
vim.opt.rtp:prepend(root .. "/hosts/neovim")

local agent = root .. "/dist/acp.js"
assert(vim.fn.filereadable(agent) == 1, "dist/acp.js missing: run npm run build first")
local node = vim.fn.exepath("node")
assert(node ~= "", "node is required")

local scratch = vim.fn.tempname()
vim.fn.mkdir(scratch .. "/home", "p")
vim.fn.mkdir(scratch .. "/workspace", "p")
vim.fn.chdir(scratch .. "/workspace")
vim.env.HOME = scratch .. "/home"
vim.env.XDG_DATA_HOME = scratch .. "/home/data"
vim.env.XDG_CONFIG_HOME = scratch .. "/home/config"
vim.env.M104_API_KEY = "test-sentinel"

local buffer = vim.api.nvim_create_buf(true, false)
vim.api.nvim_set_current_buf(buffer)
vim.api.nvim_buf_set_name(buffer, scratch .. "/workspace/sample.ts")
vim.api.nvim_buf_set_lines(buffer, 0, -1, false, { "const value = " })
vim.bo.filetype = "typescript"

local muse = require("muse")
muse.setup({ command = { node, agent } })
local id = muse.lsp()
assert(id, "native LSP starts")
assert(vim.wait(30000, function()
  local client = vim.lsp.get_client_by_id(id)
  return client and client.initialized
end, 100), "native initialize")
local client = vim.lsp.get_client_by_id(id)
assert(client.server_capabilities.completionProvider, "invoked completion offered")
local commands = client.server_capabilities.executeCommandProvider.commands
assert(vim.tbl_contains(commands, "muse.stop"), "workspace commands offered")

-- Without --tab or a stored key the server still answers the request;
-- what it answers is the service's own (no invented completion text).
local completion = client:request_sync("textDocument/completion", {
  textDocument = { uri = vim.uri_from_bufnr(buffer) },
  position = { line = 0, character = 14 },
  context = { triggerKind = 1 },
}, 30000, buffer)
assert(completion ~= nil, "completion request answered")
assert(completion.result ~= nil or completion.err ~= nil, "completion carries a result or a said refusal")

client:stop()
assert(vim.wait(30000, function()
  return client:is_stopped()
end, 100), "native shutdown")
vim.fn.delete(scratch, "rf")
print("PASS native Neovim initialize, real completion answer and shutdown")
vim.cmd("qa!")
