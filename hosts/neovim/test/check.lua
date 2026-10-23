local root = vim.fn.getcwd()
vim.opt.rtp:prepend(root .. "/hosts/neovim")
local muse = require("muse")
local calls = {}
local control_calls = {}
local stopped = 0
local cancelled = 0
local chat_adapter = "muse_spark"
local cancel_error, kill_error = false, false
local notifications = {}
vim.notify = function(message)
  notifications[#notifications + 1] = message
end
local actual_system = vim.system
vim.env.M104_API_KEY = "test-sentinel"
vim.env.OPENAI_KEY = "test-sentinel"
vim.env.m104_api_key = "test-sentinel"
package.preload["codecompanion"] = function()
  return {
    last_chat = function()
      return {
        adapter = { name = chat_adapter },
        stop = function()
          if cancel_error then
            error("private cancellation detail")
          end
          cancelled = cancelled + 1
        end,
      }
    end,
  }
end
package.preload["codecompanion.adapters"] = function()
  return {
    extend = function(base, config)
      assert(base == "goose")
      return config
    end,
  }
end
vim.system = function(args, opts, callback)
  if vim.tbl_contains(args, "stop") then
    control_calls[#control_calls + 1] = { args = args, opts = opts }
    return { kill = function() error("control must complete independently") end }
  end
  calls[#calls + 1] = { args = args, opts = opts, callback = callback }
  return {
    kill = function(_, signal)
      if kill_error then
        error("private process detail")
      end
      assert(signal == "sigterm")
      stopped = stopped + 1
    end,
  }
end
local function rejects(callback, label)
  assert(not pcall(callback), label .. ": expected refusal")
end
local url = "http://127.0.0.1:41234/#k=test-launch"
assert(muse.valid_url(url), "accepts fragment launch")
assert(muse.valid_url("http://[::1]:41234/#k=test-launch"))
for _, bad in ipairs({
  "https://127.0.0.1:41234/#k=test-launch",
  "http://localhost:41234/#k=test-launch",
  "http://127.0.0.1.evil:41234/#k=test-launch",
  "http://127.0.0.1:0/#k=test-launch",
  "http://127.0.0.1:65536/#k=test-launch",
  "http://127.0.0.1:41234/?k=test-launch",
  "http://127.0.0.1:41234/#k=test-launch&token=value",
  "http://127.0.0.1:41234/#k=test-launch\n",
}) do
  assert(not muse.valid_url(bad), "refuses unsafe launch URL")
  rejects(function()
    muse.open_companion(bad)
  end, "refuses unsafe launch URL")
end
print("PASS refuses unsafe launch URL")
local actual_has = vim.fn.has
vim.fn.has = function(feature)
  return feature == "win32" and 1 or 0
end
rejects(function()
  muse.open_companion(url)
end, "Windows browser requires explicit opener")
vim.fn.has = actual_has
print("PASS Windows browser requires explicit opener")
rejects(function()
  muse.setup({ command = {} })
end, "empty runtime argv refused")
print("PASS empty runtime argv refused")
local opener = { "test-browser" }
muse.setup({ command = { "agent with spaces", "--backend", "museCode" }, opener = opener })
vim.cmd("MusePanel")
assert(vim.deep_equal(calls[1].args, { "agent with spaces", "supervise", "panel", "--backend", "museCode", "--companion" }))
assert(calls[1].opts.clear_env)
assert(
  calls[1].opts.env.M104_API_KEY == nil and calls[1].opts.env.OPENAI_KEY == nil,
  "companion child has no credentials or raw logs"
)
assert(calls[1].opts.env.m104_api_key == nil)
assert(calls[1].opts.env.PATH == vim.env.PATH)
assert(calls[1].opts.stdout == false and calls[1].opts.stderr == false)
print("PASS companion child has no credentials or raw logs")
rejects(function()
  muse.open_companion()
end, "duplicate companion refused")
print("PASS duplicate companion refused")
vim.cmd("MuseStop")
assert(stopped == 1 and cancelled == 1, "Stop cancels chat and companion")
muse.stop()
assert(stopped == 1, "Stop is idempotent")
print("PASS Stop cancels chat and companion")
chat_adapter = "another_agent"
local before = cancelled
muse.stop()
assert(cancelled == before, "Stop preserves other ACP clients")
chat_adapter = "muse_spark"
print("PASS Stop preserves other ACP clients")
muse.open_companion()
calls[1].callback({ code = 0 })
vim.wait(1)
rejects(function()
  muse.open_companion()
end, "late exit preserves replacement companion")
muse.stop()
assert(stopped == 2, "late exit must preserve replacement companion")
print("PASS late exit preserves replacement companion")
muse.open_companion(url)
assert(vim.deep_equal(calls[3].args, { "test-browser", url }))
assert(
  calls[3].opts.env.M104_API_KEY == nil and calls[3].opts.clear_env,
  "browser launch keeps fragment and sanitized environment"
)
print("PASS browser launch keeps fragment and sanitized environment")
calls[3].callback({ code = 1, stderr = url })
vim.wait(1)
assert(notifications[#notifications] == "EPANEL_LAUNCH", "browser failure is visible and redacted")
assert(calls[3].opts.stdout == false and calls[3].opts.stderr == false, "browser output discarded")
print("PASS browser failure is visible and redacted")
muse.open_companion()
cancel_error = true
assert(pcall(muse.stop), "cancellation failure still terminates runtime")
assert(stopped == 3, "cancellation failure still terminates runtime")
assert(notifications[#notifications] == "EPANEL_STOP", "cancellation error is redacted")
cancel_error = false
print("PASS cancellation failure still terminates runtime")
muse.open_companion()
kill_error = true
assert(pcall(muse.stop), "failed kill preserves ownership")
rejects(function()
  muse.open_companion()
end, "failed kill preserves ownership")
kill_error = false
muse.stop()
assert(stopped == 4, "failed kill retry reaches owned runtime")
print("PASS failed kill preserves ownership")
-- feedkeys executes a real interactive Ex command; only a test sentinel is used.
vim.fn.histadd(":", "echo 'unrelated'")
vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(":MusePanel " .. url .. "<CR>", true, false, true), "xt", false)
assert(vim.fn.histget(":", -1) == "echo 'unrelated'", "interactive launch removed from command history")
local shada = root .. "/temp/neovim-history.shada"
vim.cmd("wshada! " .. vim.fn.fnameescape(shada))
vim.fn.histdel(":")
vim.cmd("rshada! " .. vim.fn.fnameescape(shada))
for index = 1, vim.fn.histnr(":") do
  assert(not vim.fn.histget(":", index):find("#k=", 1, true), "ShaDa contains no launch code")
end
print("PASS interactive launch removed from command history and ShaDa")
vim.api.nvim_feedkeys(
  vim.api.nvim_replace_termcodes(":silent MusePa " .. url .. "<CR>", true, false, true),
  "xt",
  false
)
assert(vim.fn.histget(":", -1) == "echo 'unrelated'", "modified abbreviated launch removed from command history")
print("PASS modified abbreviated launch removed from command history")
local lua_command = ":lua require('muse').open_companion(" .. string.format("%q", url) .. ")<CR>"
vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(lua_command, true, false, true), "xt", false)
assert(vim.fn.histget(":", -1) == "echo 'unrelated'", "Lua launch removed from command history")
print("PASS Lua launch removed from command history")
vim.fn.histadd(":", "silent MusePa " .. url)
local test_system = vim.system
vim.system = function()
  error("EPANEL_TEST_LAUNCH")
end
rejects(function()
  muse.open_companion(url)
end, "failed browser launch refused")
vim.system = test_system
assert(vim.fn.histget(":", -1) == "echo 'unrelated'", "failed launch removed from command history")
print("PASS failed launch removed from command history")
vim.cmd("wshada! " .. vim.fn.fnameescape(shada))
vim.fn.histdel(":")
vim.cmd("rshada! " .. vim.fn.fnameescape(shada))
for index = 1, vim.fn.histnr(":") do
  assert(not vim.fn.histget(":", index):find("#k=", 1, true), "all launch forms absent from ShaDa")
end
local adapter = muse.acp_adapter()
assert(adapter.env.M104_API_KEY == "" and adapter.env.OPENAI_KEY == "", "CodeCompanion adapter blanks credentials")
assert(adapter.env.m104_api_key == "")
assert(vim.deep_equal(adapter.commands.default, { "agent with spaces", "supervise", "--backend", "museCode" }))
print("PASS CodeCompanion adapter blanks credentials")
assert(#control_calls > 0, "Stop reaches independent control command")
for _, call in ipairs(control_calls) do
  assert(call.opts.clear_env and call.opts.env.M104_API_KEY == nil, "control scrubs credentials")
  assert(call.args[2] == "stop", "Stop does not enter supervision or ACP queue")
end
print("PASS independent credential-free Stop command")
vim.system = actual_system
opener[1] = vim.fn.exepath("python3")
opener[2] = root .. "/hosts/neovim/test/opener.py"
local child = muse.open_companion(url):wait()
assert(child.code == 0, "real sanitized child exits: " .. (child.stderr or ""))
vim.env.M104_API_KEY = nil
vim.env.OPENAI_KEY = nil
vim.env.m104_api_key = nil
print("PASS real sanitized child exits")
vim.cmd("qa!")
