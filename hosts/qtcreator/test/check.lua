-- Current Qt Creator Lua API doubles in a real Lua VM. No provider calls.
package.path = vim.fn.getcwd() .. "/hosts/qtcreator/musespark/?.lua;" .. package.path
local actions, children = {}, {}
local diagnostics = {}
local executable, start_result, stop_result, project_present = true, true, true, true
local function path(value)
  return {
    nativePath = function()
      return value
    end,
    resolvePath = function(_, tail)
      return path(value .. "/" .. tail)
    end,
    searchInPath = function()
      return path(value)
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
        if stop_result then
          self.alive = false
        end
        return stop_result
      end
      children[#children + 1] = child
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
vim.cmd("qa!")
