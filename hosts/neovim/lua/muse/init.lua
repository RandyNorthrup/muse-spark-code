-- Muse Spark Code (Unofficial). The companion owns UI, auth and paid consent.
local M = {}
local options = { command = { "muse-spark-code-acp" } }
local process
local forbidden = {
  AWS_ACCESS_KEY_ID = true,
  AWS_SECRET_ACCESS_KEY = true,
  AWS_SESSION_TOKEN = true,
  OPENAI_KEY = true,
  ANTHROPIC_KEY = true,
  META_KEY = true,
}

local function credential(name)
  name = name:upper()
  return name:match("_API_KEY$") ~= nil or forbidden[name] == true
end

local function environment()
  local result = {}
  for name, value in pairs(vim.fn.environ()) do
    if not credential(name) then
      result[name] = value
    end
  end
  return result
end

-- Authored launch URL, never an HTTP response or a provider wire shape.
function M.valid_url(url)
  if type(url) ~= "string" then
    return false
  end
  local port, code = url:match("^http://127%.0%.0%.1:(%d+)/#k=([A-Za-z0-9_-]+)$")
  if not port then
    port, code = url:match("^http://%[::1%]:(%d+)/#k=([A-Za-z0-9_-]+)$")
  end
  return port ~= nil and tonumber(port) > 0 and tonumber(port) <= 65535 and code ~= nil
end

function M.open_companion(url)
  if url and url ~= "" then
    if not M.valid_url(url) then
      error("EPANEL_LAUNCH_URL")
    end
    -- vim.ui.open's opener inherits the editor environment; use an argv launch.
    local opener = options.opener
    if not opener then
      opener = vim.fn.has("mac") == 1 and { "open" } or { "xdg-open" }
      if vim.fn.has("win32") == 1 then
        error("EPANEL_OPENER_REQUIRED")
      end
    end
    local args = vim.list_extend(vim.deepcopy(opener), { url })
    return vim.system(
      args,
      { env = environment(), clear_env = true, stdout = false, stderr = false },
      vim.schedule_wrap(function(result)
        if result.code ~= 0 then
          vim.notify("EPANEL_LAUNCH", vim.log.levels.ERROR)
        end
      end)
    )
  end
  if process then
    error("EPANEL_ALREADY_RUNNING")
  end
  local args = vim.list_extend(vim.deepcopy(options.command), { "panel", "--companion" })
  local running
  running = vim.system(
    args,
    {
      cwd = vim.fn.getcwd(),
      env = environment(),
      clear_env = true,
      -- Discard output: no launch code or raw CLI stderr in editor logs.
      stdout = false,
      stderr = false,
    },
    vim.schedule_wrap(function(result)
      if process == running then
        process = nil
      end
      if result.code ~= 0 then
        vim.notify("EPANEL_EXIT", vim.log.levels.ERROR)
      end
    end)
  )
  process = running
  return process
end

function M.stop()
  local cancelled = pcall(function()
    local ok, companion = pcall(require, "codecompanion")
    if ok then
      local chat = companion.last_chat()
      if chat and chat.adapter and chat.adapter.name == "muse_spark" then
        chat:stop()
      end
    end
  end)
  local killed = true
  if process then
    local running = process
    killed = pcall(function()
      running:kill("sigterm")
    end)
    if killed and process == running then
      process = nil
    end
  end
  if not cancelled or not killed then
    vim.notify("EPANEL_STOP", vim.log.levels.ERROR)
  end
end

-- Register this factory under CodeCompanion's adapters.acp.muse_spark.
function M.acp_adapter()
  local env = {}
  for name in pairs(vim.fn.environ()) do
    if credential(name) then
      -- CodeCompanion inherits the environment; override credentials with empty values.
      env[name] = ""
    end
  end
  return require("codecompanion.adapters").extend("goose", {
    name = "muse_spark",
    formatted_name = "Muse Spark Code (Unofficial)",
    commands = { default = vim.deepcopy(options.command) },
    env = env,
  })
end

function M.setup(config)
  options = vim.tbl_extend("force", options, config or {})
  assert(type(options.command) == "table" and #options.command > 0, "EPANEL_COMMAND")
  vim.api.nvim_create_user_command("MusePanel", function(args)
    -- Interactive Ex history is persisted by ShaDa. Remove only launch commands.
    if args.args ~= "" then
      for index = vim.fn.histnr(":"), 1, -1 do
        local entry = vim.fn.histget(":", index)
        if entry:match("^%s*MusePanel%s+") then
          vim.fn.histdel(":", index)
        end
      end
    end
    M.open_companion(args.args)
  end, { nargs = "?" })
  vim.api.nvim_create_user_command("MuseStop", M.stop, {})
  vim.api.nvim_create_autocmd("VimLeavePre", { callback = M.stop })
end

return M
