-- Real Neovim LSP client against the fake-only stdio service.
local repository = vim.fn.getcwd()
package.path = repository .. "/hosts/neovim/lua/?.lua;" .. repository .. "/hosts/neovim/lua/?/init.lua;" .. package.path
local folder = vim.fn.tempname()
vim.fn.mkdir(folder, "p")
vim.fn.chdir(folder)
local buffer = vim.api.nvim_create_buf(true, false)
vim.api.nvim_set_current_buf(buffer)
vim.api.nvim_buf_set_name(buffer, folder .. "/sample.ts")
vim.api.nvim_buf_set_lines(buffer, 0, -1, false, { "🙂" })
vim.bo.filetype = "typescript"
vim.fn.writefile({ "🙂" }, folder .. "/sample.ts")
local muse = require("muse")
muse.setup({ command = { vim.env.M104_NODE, repository .. "/temp/native-fake-lsp.js" } })
local id = muse.lsp()
assert(id, "native LSP starts")
assert(vim.wait(10000, function() local client = vim.lsp.get_client_by_id(id); return client and client.initialized end), "native initialize")
local client = vim.lsp.get_client_by_id(id)
assert(client.server_capabilities.inlineCompletionProvider, "native inline capability")
local result = client:request_sync("textDocument/inlineCompletion", {
  textDocument = { uri = vim.uri_from_bufnr(buffer) }, position = { line = 0, character = 2 },
  context = { triggerKind = 1 },
}, 10000, buffer)
assert(result and result.result and result.result.items[1].insertText == "completion🙂", "native Unicode completion")
assert(client.server_capabilities.completionProvider, "invoked completion remains available with inline support")
local fallback = client:request_sync("textDocument/completion", {
  textDocument = { uri = vim.uri_from_bufnr(buffer) }, position = { line = 0, character = 2 },
  context = { triggerKind = 1 },
}, 10000, buffer)
assert(fallback and fallback.result[1].textEdit.newText == "completion🙂", "native invoked completion items")
local stopped = client:request_sync("workspace/executeCommand", { command = "muse.stop" }, 10000, buffer)
assert(stopped and stopped.result.command == "muse.stop", "native command response")
client:stop()
assert(vim.wait(10000, function() return client:is_stopped() end), "native shutdown")
vim.fn.chdir(repository)
vim.fn.delete(folder, "rf")
print("PASS native Neovim initialize, UTF-16 completion, command and shutdown")
