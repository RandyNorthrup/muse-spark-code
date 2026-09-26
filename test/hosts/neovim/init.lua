-- CodeCompanion with muse-spark-code-acp as its ACP adapter (hosts.yml,
-- PLAN.md M63), as docs/acp.md gives it; the check names the installed agent
-- and the fake Muse Code CLI through MUSE_ACP and FAKE_MUSE.
local pack = os.getenv("NVIM_PACK")
vim.opt.rtp:prepend(pack .. "/plenary.nvim")
vim.opt.rtp:prepend(pack .. "/codecompanion.nvim")
require("codecompanion").setup({
  adapters = {
    acp = {
      muse_spark = function()
        return require("codecompanion.adapters").extend("goose", {
          name = "muse_spark",
          formatted_name = "Muse Spark",
          commands = { default = { os.getenv("MUSE_ACP"), "--muse-binary", os.getenv("FAKE_MUSE") } },
        })
      end,
    },
  },
  interactions = { chat = { adapter = "muse_spark" } },
})
