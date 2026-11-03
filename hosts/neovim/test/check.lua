-- Real-agent check: every child is this tree's dist/acp.js (run
-- `npm run build` first), started by the shim's own functions in this
-- Neovim. No editor function is replaced.
local here = (arg and arg[0]) or 'test/check.lua'
local root = vim.fn.fnamemodify(here, ':p:h:h:h:h')
vim.opt.rtp:prepend(root .. "/hosts/neovim")
local muse = require("muse")

local agent = root .. "/dist/acp.js"
assert(vim.fn.filereadable(agent) == 1, "dist/acp.js missing: run npm run build first")
local node = vim.fn.exepath("node")
assert(node ~= "", "node is required")
local python = vim.fn.exepath("python3")
assert(python ~= "", "python3 is required for the opener child")

local scratch = vim.fn.tempname()
vim.fn.mkdir(scratch .. "/home", "p")
vim.fn.mkdir(scratch .. "/workspace", "p")
vim.fn.chdir(scratch .. "/workspace")
vim.env.HOME = scratch .. "/home"
vim.env.XDG_DATA_HOME = scratch .. "/home/data"
vim.env.XDG_CONFIG_HOME = scratch .. "/home/config"
vim.env.M104_API_KEY = "test-sentinel"
vim.env.OPENAI_KEY = "test-sentinel"
vim.env.m104_api_key = "test-sentinel"

local function refuses(callback, label)
  assert(not pcall(callback), label .. ": expected refusal")
end

local function messages()
  return vim.api.nvim_exec2("messages", { output = true }).output
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
end
print("PASS refuses unsafe launch URL")

refuses(function()
  muse.setup({ command = {} })
end, "empty runtime argv refused")
print("PASS empty runtime argv refused")

muse.setup({
  command = { node, agent },
  opener = { python, root .. "/hosts/neovim/test/opener.py" },
})

for _, bad in ipairs({ "https://127.0.0.1:41234/#k=test-launch", "http://127.0.0.1:41234/?k=test-launch" }) do
  refuses(function()
    muse.open_companion(bad)
  end, "refuses unsafe launch URL at open")
end

-- The companion start reaches the real agent, which serves its page; Stop's
-- verb ends that supervised run (no EPANEL_STOP) and ownership clears.
-- No display: the companion runs the OS opener itself.
vim.env.DISPLAY = nil
vim.env.WAYLAND_DISPLAY = nil
local companion = muse.open_companion()
refuses(function()
  vim.cmd("MusePanel")
end, "duplicate companion refused while owned")
print("PASS duplicate companion refused while owned")

-- The shim discards the launch URL, so the page is found by the supervised
-- child's own loopback listener (Linux /proc; this check runs on Linux).
local function listening_port(pid)
  local inodes = {}
  local children = io.open("/proc/" .. pid .. "/task/" .. pid .. "/children")
  for child in (children and children:read("*a") or ""):gmatch("%d+") do
    for _, fd in ipairs(vim.fn.glob("/proc/" .. child .. "/fd/*", false, true)) do
      local inode = (vim.uv.fs_readlink(fd) or ""):match("^socket:%[(%d+)%]$")
      if inode then
        inodes[inode] = true
      end
    end
  end
  if children then
    children:close()
  end
  for line in io.lines("/proc/net/tcp") do
    local port, state, inode = line:match("^%s*%d+: 0100007F:(%x+) %x+:%x+ (%x+)" .. ("%s+%S+"):rep(5) .. "%s+(%d+)")
    if state == "0A" and inodes[inode] then
      return tonumber(port, 16)
    end
  end
end

local function page_status(port)
  local reply, done = "", false
  local tcp = vim.uv.new_tcp()
  tcp:connect("127.0.0.1", port, function(failed)
    if failed then
      done = true
      return
    end
    -- The page answers only its own loopback Host.
    tcp:write(("GET / HTTP/1.0\r\nHost: 127.0.0.1:%d\r\n\r\n"):format(port))
    tcp:read_start(function(_, chunk)
      reply = reply .. (chunk or "")
      done = done or not chunk
    end)
  end)
  vim.wait(30000, function()
    return done or reply:find("\r\n", 1, true) ~= nil
  end, 50)
  tcp:close()
  return tonumber(reply:match("^HTTP/1%.[01] (%d+) "))
end

local port
assert(
  vim.wait(30000, function()
    port = listening_port(companion.pid)
    return port ~= nil
  end, 100),
  "the companion listens on loopback"
)
assert(page_status(port) == 200, "the companion serves its page")
assert(not companion:is_closing(), "the companion keeps serving")
print("PASS real companion serves its page")
vim.cmd("MuseStop")
assert(companion:wait(30000).code ~= nil, "Stop ends the companion")
assert(page_status(port) == nil, "the page no longer answers after Stop")
assert(not messages():find("EPANEL_", 1, true), "Stop's verb ended the run: " .. messages())
local second = muse.open_companion()
assert(second, "start allowed after Stop cleared ownership")
-- Stop it once it serves, so no supervised child outlives this check.
assert(vim.wait(30000, function()
  return listening_port(second.pid) ~= nil
end, 100), "the second companion listens on loopback")
muse.stop()
second:wait(30000)
print("PASS Stop runs against the real agent and clears ownership")

-- The URL route spawns the real opener child, which itself asserts the
-- exact argv and a credential-free environment.
local child = muse.open_companion(url):wait()
assert(child.code == 0, "real sanitized opener child exits: " .. (child.stderr or ""))
print("PASS browser launch keeps fragment and sanitized environment")

-- No launch code persists in Ex history or ShaDa, in any typed form.
vim.fn.histadd(":", "echo 'unrelated'")
vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(":MusePanel " .. url .. "<CR>", true, false, true), "xt", false)
assert(vim.fn.histget(":", -1) == "echo 'unrelated'", "interactive launch removed from command history")
local shada = scratch .. "/history.shada"
vim.cmd("wshada! " .. vim.fn.fnameescape(shada))
vim.fn.histdel(":")
vim.cmd("rshada! " .. vim.fn.fnameescape(shada))
for index = 1, vim.fn.histnr(":") do
  assert(not vim.fn.histget(":", index):find("#k=", 1, true), "ShaDa contains no launch code")
end
print("PASS interactive launch removed from command history and ShaDa")
vim.fn.histadd(":", "echo 'unrelated'")
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

vim.fn.delete(scratch, "rf")
vim.cmd("qa!")
