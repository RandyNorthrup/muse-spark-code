local M = {}
local running
local openers = {}
local stopping
local launching
local pending = {}

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
  if not url and (launching or running) then
    error("EPANEL_ALREADY_RUNNING")
  end
  if not url and not project then
    error("EPANEL_WORKSPACE_REQUIRED")
  end
  -- Reserve ownership before executable lookup yields; Stop cancels the ticket.
  local ticket = {}
  pending[ticket] = true
  if not url then
    launching = ticket
  end
  local ok, result = pcall(function()
    local python = a.wait(utils.FilePath.fromUserInput(config.python):searchInPath())
    if not pending[ticket] then
      error("EPANEL_STOP")
    end
    if not python or not python:isExecutableFile() then
      error("EPANEL_PYTHON_REQUIRED")
    end
    local launcher = PluginSpec.pluginDirectory:resolvePath("launch.py")
    local args = { "-I", launcher:nativePath() }
    if url then
      args[#args + 1] = "open"
      args[#args + 1] = url
    else
      args[#args + 1] = "panel"
      args[#args + 1] = config.agent
      if config.agentScript then
        args[#args + 1] = "--agent-script"
        args[#args + 1] = config.agentScript
      end
    end
    local child
    local opener_failed = false
    child = process.create({
      command = python,
      arguments = args,
      workingDirectory = project and project.directory or utils.FilePath.currentWorkingPath(),
      stdout = function() end,
      stderr = function(chunk)
        -- The trusted opener bootstrap emits only a fixed failure word.
        if url and chunk ~= "" then
          opener_failed = true
        end
      end,
      onFinished = function()
        local opener = openers[child]
        openers[child] = nil
        if opener and stopping ~= child and opener_failed then
          require("MessageManager").writeFlashing("EPANEL_LAUNCH")
        end
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
  end)
  pending[ticket] = nil
  if launching == ticket then
    launching = nil
  end
  if not ok then
    error("EPANEL_LAUNCH")
  end
  return result
end

function M.stop()
  pending = {}
  launching = nil
  local failed = false
  for child in pairs(openers) do
    stopping = child
    local ok, stopped = pcall(function()
      return not child:isRunning() or require("async").wait(child:stop())
    end)
    stopping = nil
    if ok and stopped then
      openers[child] = nil
    else
      failed = true
    end
  end
  if running then
    local child = running
    stopping = child
    local ok, stopped = pcall(function()
      return not child:isRunning() or require("async").wait(child:stop())
    end)
    stopping = nil
    if ok and stopped and running == child then
      running = nil
    elseif not ok or not stopped then
      failed = true
    end
  end
  if failed then
    error("EPANEL_STOP")
  end
end

function M.stop_workspace()
  local a = require("async")
  local utils = require("Utils")
  local config = require("config")
  local project = require("Project").startupProject()
  if not project then error("EPANEL_WORKSPACE_REQUIRED") end
  local python = a.wait(utils.FilePath.fromUserInput(config.python):searchInPath())
  if not python or not python:isExecutableFile() then error("EPANEL_PYTHON_REQUIRED") end
  local launcher = PluginSpec.pluginDirectory:resolvePath("launch.py")
  local args = { "-I", launcher:nativePath(), "stop", config.agent }
  if config.agentScript then
    args[#args + 1] = "--agent-script"
    args[#args + 1] = config.agentScript
  end
  local child = require("Process").create({ command = python, arguments = args,
    workingDirectory = project.directory, stdout = function() end,
    stderr = function(chunk)
      if chunk ~= "" then require("MessageManager").writeFlashing("EPANEL_STOP") end
    end,
  })
  if not a.wait(child:start()) then error("EPANEL_STOP") end
  return child
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
    onTrigger = a.sync(function()
      local ok = pcall(M.stop_workspace)
      M.stop()
      if not ok then error("EPANEL_STOP") end
    end),
    containers = { "QtCreator.Menu.Tools" },
  })
  return true
end

return M
