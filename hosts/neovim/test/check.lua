local root = vim.fn.getcwd()
vim.opt.rtp:prepend(root .. "/hosts/neovim")
local muse = require("muse")
local calls = {}
local stopped = 0
local cancelled = 0
local actual_system = vim.system
vim.env.M104_API_KEY = "test-sentinel"
vim.env.OPENAI_KEY = "test-sentinel"
vim.env.m104_api_key = "test-sentinel"
package.preload["codecompanion"] = function()
  return {
    last_chat = function()
      return {
        stop = function()
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
  calls[#calls + 1] = { args = args, opts = opts, callback = callback }
  return {
    kill = function(_, signal)
      assert(signal == "sigterm")
      stopped = stopped + 1
    end,
  }
end
local function rejects(callback)
  assert(not pcall(callback), "expected refusal")
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
  end)
end
print("PASS refuses unsafe launch URL")
muse.setup({ command = { "agent with spaces", "--backend", "musecode" }, opener = { "test-browser" } })
vim.cmd("MusePanel")
assert(vim.deep_equal(calls[1].args, { "agent with spaces", "--backend", "musecode", "panel", "--companion" }))
assert(calls[1].opts.clear_env)
assert(calls[1].opts.env.M104_API_KEY == nil and calls[1].opts.env.OPENAI_KEY == nil)
assert(calls[1].opts.env.m104_api_key == nil)
assert(calls[1].opts.env.PATH == vim.env.PATH)
assert(calls[1].opts.stdout == false and calls[1].opts.stderr == false)
print("PASS companion child has no credentials or raw logs")
rejects(function()
  muse.open_companion()
end)
print("PASS duplicate companion refused")
vim.cmd("MuseStop")
assert(stopped == 1 and cancelled == 1, "Stop cancels chat and companion")
muse.stop()
assert(stopped == 1, "Stop is idempotent")
print("PASS Stop cancels chat and companion")
muse.open_companion()
calls[1].callback({ code = 0 })
vim.wait(1)
rejects(function()
  muse.open_companion()
end)
muse.stop()
assert(stopped == 2, "late exit must preserve replacement companion")
print("PASS late exit preserves replacement companion")
muse.open_companion(url)
assert(vim.deep_equal(calls[3].args, { "test-browser", url }))
assert(calls[3].opts.env.M104_API_KEY == nil and calls[3].opts.clear_env)
print("PASS browser launch keeps fragment and sanitized environment")
local adapter = muse.acp_adapter()
assert(adapter.env.M104_API_KEY == "" and adapter.env.OPENAI_KEY == "")
assert(adapter.env.m104_api_key == "")
assert(vim.deep_equal(adapter.commands.default, { "agent with spaces", "--backend", "musecode" }))
print("PASS CodeCompanion adapter blanks credentials")
vim.system = actual_system
vim.env.M104_API_KEY = nil
vim.env.OPENAI_KEY = nil
vim.env.m104_api_key = nil
local child = actual_system({ vim.v.progpath, "--headless", "-u", "NONE", "-c", "qa!" }, {
  env = { PATH = vim.env.PATH },
  clear_env = true,
}):wait()
assert(child.code == 0, "real sanitized child exits")
print("PASS real sanitized child exits")
vim.cmd("qa!")
