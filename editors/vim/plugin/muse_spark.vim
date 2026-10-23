" Muse Spark Code (Unofficial) for classic Vim (M66): an ACP client in pure
" Vimscript, over the packed agent's NDJSON stdio. Needs Vim 8.1 or later
" with +job and +channel; no Python, Lua or remote plugin. Install by copying
" this folder beside your Vim packages, e.g.
" ~/.vim/pack/musespark/start/muse-spark, then restart Vim. :MuseSpark opens
" the chat. Full guide: docs/acp.md ("Classic Vim").
if exists('g:loaded_muse_spark')
  finish
endif
let g:loaded_muse_spark = 1

if !has('job') || !has('channel')
  echomsg 'muse-spark: this Vim has no +job/+channel; the chat cannot start.'
endif

" The agent to run. A string runs through the shell's PATH lookup; a list is
" the full argv (handy for `node /path/to/dist/acp.js` or paths with spaces).
if !exists('g:muse_spark_command')
  let g:muse_spark_command = 'muse-spark-code-acp'
endif
" Extra arguments for the agent, e.g. ['--model', 'muse-spark-1.3',
" '--trust-workspace']. Contributor models need '--allow-contributor-models'
" beside the '--model' that names one.
if !exists('g:muse_spark_args')
  let g:muse_spark_args = []
endif
" MCP servers the session offers the agent (ACP NewSessionRequest
" mcpServers), e.g. Xcode 26.3's bridge while Xcode runs with a project open:
" [{'type': 'stdio', 'name': 'xcode', 'command': '/usr/bin/xcrun',
"   'args': ['mcpbridge'], 'env': []}].
if !exists('g:muse_spark_mcp_servers')
  let g:muse_spark_mcp_servers = []
endif

command! -nargs=0 MuseSpark call muse_spark#open()
command! -nargs=0 MuseSparkSend call muse_spark#send()
command! -nargs=0 MuseSparkNew call muse_spark#new_session()
command! -nargs=0 MuseSparkClose call muse_spark#close()
command! -nargs=0 MuseSparkCancel call muse_spark#cancel()
command! -nargs=1 MuseSparkModel call muse_spark#set_model(<q-args>)
command! -nargs=1 MuseSparkMode call muse_spark#set_mode(<q-args>)
command! -nargs=1 MuseSparkAllow call muse_spark#allow(<q-args>)
command! -nargs=0 MuseSparkDeny call muse_spark#deny()
