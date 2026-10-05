local M = {}
local running
local openers = {}
local stopping

function M.valid_url(url)
  if type(url) ~= "string" then
    return false
  end
  local port = url:match("^http://127%.0%.0%.1:(%d+)/#k=[A-Za-z0-9_-]+$")
    or url:match("^http://%[::1%]:(%d+)/#k=[A-Za-z0-9_-]+$")
  return port ~= nil and tonumber(port) > 0 and tonumber(port) <= 65535
end

function M.open_companion(url)
  local a = require("async")
  local utils = require("Utils")
  local process = require("Process")
  local config = require("config")
  local project = require("Project").startupProject()
  if url ~= nil and not M.valid_url(url) then
    error("EPANEL_LAUNCH_URL")
  end
  if not url and running and running:isRunning() then
    error("EPANEL_ALREADY_RUNNING")
  end
  if not url and not project then
    error("EPANEL_WORKSPACE_REQUIRED")
  end
  local python = a.wait(utils.FilePath.fromUserInput(config.python):searchInPath())
  if not python or not python:isExecutableFile() then
    error("EPANEL_PYTHON_REQUIRED")
  end
  local launcher = PluginSpec.pluginDirectory:resolvePath("launch.py")
  local args = url and { "-I", launcher:nativePath(), "open", url }
    or { "-I", launcher:nativePath(), "panel", config.agent }
  local child
  child = process.create({
    command = python,
    arguments = args,
    workingDirectory = project and project.directory or utils.FilePath.currentWorkingPath(),
    stdout = function() end,
    stderr = function() end,
    onFinished = function()
      openers[child] = nil
      if running == child then
        running = nil
        if stopping ~= child then
          require("MessageManager").writeFlashing("EPANEL_EXIT")
        end
      end
    end,
  })
  -- Hold the native process while start yields. The launcher execs the runtime.
  if not url then
    running = child
  else
    openers[child] = true
  end
  if not a.wait(child:start()) then
    openers[child] = nil
    if running == child then
      running = nil
    end
    error("EPANEL_LAUNCH")
  end
  return child
end

function M.stop()
  for child in pairs(openers) do
    if child:isRunning() and not require("async").wait(child:stop()) then
      error("EPANEL_STOP")
    end
    openers[child] = nil
  end
  if running then
    local child = running
    stopping = child
    local stopped = not child:isRunning() or require("async").wait(child:stop())
    stopping = nil
    if not stopped then
      error("EPANEL_STOP")
    end
    if running == child then
      running = nil
    end
  end
end

function M.setup()
  local action = require("Action")
  local a = require("async")
  action.create("MuseSpark.Panel", {
    text = "Muse Spark Code (Unofficial): panel",
    onTrigger = a.sync(function()
      M.open_companion()
    end),
    containers = { "QtCreator.Menu.Tools" },
  })
  action.create("MuseSpark.Stop", {
    text = "Muse Spark Code (Unofficial): stop",
    onTrigger = a.sync(M.stop),
    containers = { "QtCreator.Menu.Tools" },
  })
  return true
end

return M
