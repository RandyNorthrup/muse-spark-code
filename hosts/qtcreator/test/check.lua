-- Current Qt Creator Lua API doubles in a real Lua VM. No provider calls.
package.path = vim.fn.getcwd() .. "/hosts/qtcreator/musespark/?.lua;" .. package.path
local actions, children, controls = {}, {}, {}
local diagnostics = {}
local executable, start_result, stop_result, project_present = true, true, true, true
local yield_lookup = false
local function path(value)
  return {
    nativePath = function()
      return value
    end,
    resolvePath = function(_, tail)
      return path(value .. "/" .. tail)
    end,
    searchInPath = function()
      local found = path(value)
      found.lookup = true
      return found
    end,
    isExecutableFile = function()
      return executable
    end,
  }
end
PluginSpec = { pluginDirectory = path("/plugins with spaces/musespark") }
package.preload["MessageManager"] = function()
  return {
    writeFlashing = function(message)
      diagnostics[#diagnostics + 1] = message
    end,
  }
end
package.preload["Project"] = function()
  return {
    startupProject = function()
      return project_present and { directory = path("/workspace with spaces") } or nil
    end,
  }
end
package.preload["Utils"] = function()
  return {
    FilePath = {
      fromUserInput = path,
      currentWorkingPath = function()
        return path("/workspace with spaces")
      end,
    },
  }
end
package.preload["async"] = function()
  return {
    wait = function(value)
      if yield_lookup and type(value) == "table" and value.lookup then
        coroutine.yield("lookup")
      end
      return value
    end,
    sync = function(fn)
      return fn
    end,
  }
end
package.preload["Action"] = function()
  return {
    create = function(id, opts)
      actions[id] = opts
    end,
  }
end
package.preload["Process"] = function()
  return {
    create = function(opts)
      local child = { opts = opts, alive = true }
      function child:start()
        self.alive = start_result
        return start_result
      end
      function child:isRunning()
        return self.alive
      end
      function child:stop()
        if self.stop_error then
          error("private stop detail")
        end
        local result = self.stop_result
        if result == nil then
          result = stop_result
        end
        if result then
          self.alive = false
        end
        return result
      end
      if opts.arguments[3] == "stop" then
        controls[#controls + 1] = child
      else
        children[#children + 1] = child
      end
      return child
    end,
  }
end
local muse = require("init")
local function refuses(fn, label)
  assert(not pcall(fn), label .. ": expected refusal")
end
assert(muse.setup())
assert(actions["MuseSpark.Panel"].containers[1] == "QtCreator.Menu.Tools")
actions["MuseSpark.Panel"].onTrigger()
assert(
  vim.deep_equal(children[1].opts.arguments, {
    "-I",
    "/plugins with spaces/musespark/launch.py",
    "panel",
    "muse-spark-code-acp",
  }),
  "native action uses argv and workspace"
)
assert(children[1].opts.workingDirectory:nativePath() == "/workspace with spaces")
print("PASS native action uses argv and workspace")
refuses(function()
  muse.open_companion()
end, "duplicate companion refused")
print("PASS duplicate companion refused")
actions["MuseSpark.Stop"].onTrigger()
assert(not children[1].alive, "Stop terminates owned process")
assert(#controls == 1 and controls[1].opts.arguments[3] == "stop", "independent Stop channel")
assert(controls[1].opts.workingDirectory:nativePath() == "/workspace with spaces")
muse.stop()
print("PASS Stop terminates owned process")
muse.open_companion()
children[1].opts.onFinished()
refuses(function()
  muse.open_companion()
end, "old completion preserves replacement")
muse.stop()
print("PASS old completion preserves replacement")
local url = "http://127.0.0.1:41234/#k=test-launch"
assert(muse.valid_url(url) and muse.valid_url("http://[::1]:41234/#k=test-launch"))
for _, bad in ipairs({
  "file:///private",
  "http://localhost:41234/#k=test-launch",
  "http://127.0.0.1:65536/#k=test-launch",
  "http://127.0.0.1:0/#k=test-launch",
  "http://127.0.0.1:41234/?k=test-launch",
  url .. "\n",
  url .. "&token=value",
}) do
  assert(not muse.valid_url(bad), "rejects unsafe launch URL")
  refuses(function()
    muse.open_companion(bad)
  end, "rejects unsafe launch URL")
end
print("PASS rejects unsafe launch URL")
muse.open_companion(url)
assert(
  vim.deep_equal(children[3].opts.arguments, { "-I", "/plugins with spaces/musespark/launch.py", "open", url }),
  "same-session launch keeps fragment"
)
print("PASS same-session launch keeps fragment")
children[3].opts.onFinished()
project_present = false
refuses(function()
  muse.open_companion()
end, "missing workspace refused")
project_present = true
print("PASS missing workspace refused")
executable = false
refuses(function()
  muse.open_companion()
end, "missing executable refused")
executable = true
print("PASS missing executable refused")
start_result = false
refuses(function()
  muse.open_companion()
end, "failed start releases process ownership")
start_result = true
muse.open_companion()
print("PASS failed start releases process ownership")
stop_result = false
refuses(muse.stop, "failed stop is explicit")
stop_result = true
muse.stop()
assert(not children[#children].alive, "failed stop retains ownership for retry")
print("PASS failed stop is explicit")
muse.open_companion(url)
stop_result = false
refuses(muse.stop, "failed browser stop retains ownership")
stop_result = true
muse.stop()
assert(not children[#children].alive, "failed browser stop retains ownership")
print("PASS failed browser stop retains ownership")
muse.open_companion(url)
muse.stop()
assert(not children[#children].alive, "Stop terminates in-flight browser launcher")
print("PASS Stop terminates in-flight browser launcher")
muse.open_companion()
children[#children].opts.onFinished()
assert(diagnostics[#diagnostics] == "EPANEL_EXIT", "unexpected exit must be visible")
print("PASS unexpected exit reports fixed diagnostic")
muse.open_companion(url)
children[#children].opts.stderr("EPANEL_LAUNCH\n")
children[#children].opts.onFinished()
assert(diagnostics[#diagnostics] == "EPANEL_LAUNCH", "browser failure is visible and redacted")
print("PASS browser failure is visible and redacted")
muse.open_companion()
local runtime = children[#children]
muse.open_companion(url)
local opener = children[#children]
opener.stop_result = false
refuses(muse.stop, "browser stop failure is explicit")
assert(not runtime.alive, "browser stop failure still terminates runtime")
opener.stop_result = true
muse.stop()
assert(not opener.alive, "failed opener remains owned for retry")
print("PASS browser stop failure still terminates runtime")
muse.open_companion()
runtime = children[#children]
muse.open_companion(url)
opener = children[#children]
opener.stop_error = true
refuses(muse.stop, "throwing browser stop is explicit")
assert(not runtime.alive, "throwing browser stop still terminates runtime")
opener.stop_error = false
muse.stop()
print("PASS throwing browser stop still terminates runtime")
yield_lookup = true
local first = coroutine.create(function()
  muse.open_companion()
end)
local ok, phase = coroutine.resume(first)
assert(ok and phase == "lookup", "lookup must really suspend")
local second = coroutine.create(function()
  muse.open_companion()
end)
assert(not coroutine.resume(second), "pending lookup refuses concurrent launch")
assert(coroutine.resume(first), "first reserved launch completes")
yield_lookup = false
muse.stop()
print("PASS pending lookup refuses concurrent launch")
for _, link in ipairs({ false, url }) do
  yield_lookup = true
  local count = #children
  local pending_launch = coroutine.create(function()
    muse.open_companion(link or nil)
  end)
  assert(coroutine.resume(pending_launch), "lookup suspends before Stop")
  muse.stop()
  assert(not coroutine.resume(pending_launch), "Stop cancels pending lookup")
  assert(#children == count, "stopped lookup must not spawn a child")
  yield_lookup = false
end
muse.open_companion()
muse.stop()
print("PASS Stop cancels pending runtime and browser lookups")
local config = require("config")
config.agent = "C:/Node/node.exe"
config.agentScript = "C:/ACP/dist/acp.js"
muse.open_companion()
assert(
  vim.deep_equal(children[#children].opts.arguments, {
    "-I",
    "/plugins with spaces/musespark/launch.py",
    "panel",
    "C:/Node/node.exe",
    "--agent-script",
    "C:/ACP/dist/acp.js",
  }),
  "Node script prefix reaches trusted bootstrap"
)
muse.stop()
print("PASS Node script prefix reaches trusted bootstrap")
vim.cmd("qa!")
