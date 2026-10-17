-- The ACP agent in CodeCompanion, headless (hosts.yml, PLAN.md M63): a reply,
-- then CodeCompanion's approval prompt answered by pressing its keys in the
-- chat buffer: Accept runs the command, Reject skips it. Exits 1 on a miss.
local failures = 0
local want = "accept"
local approval_prompt = require("codecompanion.interactions.chat.helpers.approval_prompt")
local original = approval_prompt.request
approval_prompt.request = function(chat, opts)
  local done = original(chat, opts)
  vim.schedule(function()
    for _, choice in ipairs(opts.choices) do
      if choice.label:lower():find(want) and not choice.preview then
        vim.api.nvim_set_current_buf(chat.bufnr)
        vim.api.nvim_feedkeys(vim.keycode(choice.keymap), "x", false)
        return
      end
    end
  end)
  return done
end

local chat = require("codecompanion").chat({})
local function text()
  return table.concat(vim.api.nvim_buf_get_lines(chat.bufnr, 0, -1, false), "\n")
end
local function expect(label, prompt, pattern)
  chat:add_buf_message({ role = "user", content = prompt })
  chat:submit()
  local ok = vim.wait(40000, function() return text():find(pattern) ~= nil end, 100)
  vim.wait(1000, function() return false end, 100)
  io.stdout:write(string.format("\n%s %s\n", ok and "ok  " or "FAIL", label))
  if not ok then failures = failures + 1 end
end

expect("a reply streams", "hello from neovim", "echo: hello from neovim")
want = "accept"
expect("Accept runs the command", "tool: echo allowed-in-neovim", "ran: echo allowed%-in%-neovim")
want = "reject"
expect("Reject skips it", "tool: echo rejected-in-neovim", "skipped: echo rejected%-in%-neovim")
if failures > 0 then
  io.stdout:write("--- the chat buffer ---\n" .. text() .. "\n")
  vim.cmd("cquit 1")
end
vim.cmd("qa!")
