" Muse Spark Code (Unofficial) for classic Vim (M66): the ACP client. One
" agent job per Vim, one session at a time, an append-only chat buffer. Wire
" shapes follow @agentclientprotocol/sdk 1.8.0 (protocol version 1, NDJSON
" over stdio); anything the wire adds later is shown raw, never dropped.
if exists('s:loaded')
  finish
endif
let s:loaded = 1

let s:buf_name = 'Muse Spark'
let s:prompt_mark = 'You:'
let s:agent_mark = 'Muse:'

" Connection state. `permissions` is a FIFO of agent request ids awaiting an
" answer through :MuseSparkAllow/:MuseSparkDeny.
let s:st = {
  \ 'job': 0,
  \ 'buf': -1,
  \ 'next_id': 1,
  \ 'pending': {},
  \ 'agent': '',
  \ 'session': '',
  \ 'model': '',
  \ 'mode': '',
  \ 'modes': [],
  \ 'busy': 0,
  \ 'reply_open': 0,
  \ 'permissions': [],
  \ 'log': [],
  \ }

" --- Pure wire helpers (covered by test/hosts/vim.sh) ---------------------

" One JSON-RPC request line, without the trailing newline the sender adds.
function! muse_spark#encode_request(id, method, params) abort
  return json_encode({'jsonrpc': '2.0', 'id': a:id, 'method': a:method, 'params': a:params})
endfunction

function! muse_spark#encode_response(id, result) abort
  return json_encode({'jsonrpc': '2.0', 'id': a:id, 'result': a:result})
endfunction

function! muse_spark#encode_error(id, code, message) abort
  return json_encode({'jsonrpc': '2.0', 'id': a:id, 'error': {'code': a:code, 'message': a:message}})
endfunction

function! muse_spark#encode_notification(method, params) abort
  return json_encode({'jsonrpc': '2.0', 'method': a:method, 'params': a:params})
endfunction

" [1, message] for a JSON object line, [0, reason] otherwise.
function! muse_spark#parse_line(line) abort
  try
    let l:msg = json_decode(a:line)
  catch
    return [0, 'not JSON: ' . v:exception]
  endtry
  if type(l:msg) != v:t_dict
    return [0, 'not an object']
  endif
  return [1, l:msg]
endfunction

" The prompt below the last `You:` marker: {'at': line index, 'text': text}.
" `at` is -1 and the text empty when the buffer holds no marker yet.
function! muse_spark#take_prompt(lines) abort
  let l:at = -1
  let l:i = 0
  for l:line in a:lines
    if l:line ==# s:prompt_mark
      let l:at = l:i
    endif
    let l:i += 1
  endfor
  if l:at < 0
    return {'at': -1, 'text': ''}
  endif
  let l:body = a:lines[l:at + 1 :]
  while !empty(l:body) && l:body[-1] ==# ''
    call remove(l:body, -1)
  endwhile
  return {'at': l:at, 'text': join(l:body, "\n")}
endfunction

function! muse_spark#header_lines(model, mode, cwd) abort
  let l:who = empty(a:model) ? 'starting' : a:model
  if !empty(a:mode)
    let l:who .= ' (' . a:mode . ')'
  endif
  return ['# ' . s:buf_name . ' — ' . l:who, 'cwd: ' . a:cwd, '']
endfunction

" One display line for a tool_call or tool_call_update payload.
function! muse_spark#tool_line(call) abort
  let l:kind = get(a:call, 'kind', 'other')
  if type(l:kind) != v:t_string || empty(l:kind)
    let l:kind = 'other'
  endif
  let l:title = get(a:call, 'title', '')
  if type(l:title) != v:t_string || empty(l:title)
    let l:title = get(a:call, 'name', '')
  endif
  if type(l:title) != v:t_string || empty(l:title)
    let l:title = get(a:call, 'toolCallId', 'tool')
  endif
  let l:status = get(a:call, 'status', '')
  let l:line = '[tool ' . l:kind . '] ' . l:title
  if type(l:status) == v:t_string && !empty(l:status)
    let l:line .= ' — ' . l:status
  endif
  return l:line
endfunction

" A permission answer for the options the agent offered: {'outcome':
" {'outcome': 'selected', 'optionId': id}} for a 1-based pick, or the
" cancelled outcome for anything else (an unknown pick refuses, never runs).
function! muse_spark#permission_outcome(options, choice) abort
  let l:n = str2nr(a:choice)
  if l:n >= 1 && l:n <= len(a:options)
    let l:option = a:options[l:n - 1]
    if type(l:option) == v:t_dict && type(get(l:option, 'optionId', '')) == v:t_string
      return {'outcome': {'outcome': 'selected', 'optionId': l:option['optionId']}}
    endif
  endif
  return {'outcome': {'outcome': 'cancelled'}}
endfunction

" The model option's current value, or '' when the agent lists no model.
function! muse_spark#current_model(config_options) abort
  for l:option in a:config_options
    if type(l:option) == v:t_dict && get(l:option, 'id', '') ==# 'model'
      let l:value = get(l:option, 'currentValue', '')
      return type(l:value) == v:t_string ? l:value : ''
    endif
  endfor
  return ''
endfunction

" --- Buffer ---------------------------------------------------------------

function! s:ensure_buffer() abort
  if s:st.buf > 0 && bufexists(s:st.buf)
    return s:st.buf
  endif
  let l:found = bufnr(s:buf_name)
  if l:found > 0
    let s:st.buf = l:found
    return s:st.buf
  endif
  botright new
  file Muse\ Spark
  setlocal buftype=nofile bufhidden=hide noswapfile modifiable
  setlocal filetype=muse-spark nowrap
  let s:st.buf = bufnr('%')
  call setbufline(s:st.buf, 1, s:header() + [s:prompt_mark, ''])
  return s:st.buf
endfunction

function! s:header() abort
  return muse_spark#header_lines(s:st.model, s:st.mode, getcwd())
endfunction

function! s:refresh_header() abort
  if s:st.buf > 0 && bufexists(s:st.buf)
    call setbufline(s:st.buf, 1, s:header())
  endif
endfunction

function! s:append(lines) abort
  if s:st.buf <= 0 || !bufexists(s:st.buf)
    return
  endif
  call appendbufline(s:st.buf, '$', a:lines)
  for l:win in win_findbuf(s:st.buf)
    call win_execute(l:win, 'normal! G')
  endfor
endfunction

function! s:note(text) abort
  " A note breaks the open reply run, so later chunks start a fresh line.
  let s:st.reply_open = 0
  call s:append([a:text])
endfunction

" --- Job ------------------------------------------------------------------

function! s:argv() abort
  let l:command = get(g:, 'muse_spark_command', 'muse-spark-code-acp')
  let l:args = get(g:, 'muse_spark_args', [])
  if type(l:command) == v:t_list
    return l:command + l:args
  endif
  return [l:command] + l:args
endfunction

function! s:alive() abort
  return type(s:st.job) == v:t_job && job_status(s:st.job) ==# 'run'
endfunction

function! s:send_raw(line) abort
  if !s:alive()
    return 0
  endif
  call ch_sendraw(job_getchannel(s:st.job), a:line . "\n")
  return 1
endfunction

" Send a request; Callback(result, error) runs on its response (0 skips it).
" A missing side arrives as v:null, whose type is v:t_none, so the handlers
" test `type(...) != v:t_none` for "answered" (there is no v:t_null).
function! s:send(method, params, Callback) abort
  let l:id = s:st.next_id
  let s:st.next_id += 1
  if type(a:Callback) == v:t_func
    let s:st.pending[l:id] = a:Callback
  endif
  if !s:send_raw(muse_spark#encode_request(l:id, a:method, a:params))
    call remove(s:st.pending, l:id)
    call s:note('[error] the agent is not running; :MuseSpark starts it.')
  endif
endfunction

function! s:OnOut(_ch, msg) abort
  let [l:ok, l:parsed] = muse_spark#parse_line(a:msg)
  if !l:ok
    call s:note('[wire] ' . l:parsed)
    return
  endif
  let l:msg = l:parsed
  if has_key(l:msg, 'method')
    if has_key(l:msg, 'id')
      call s:on_agent_request(l:msg['id'], l:msg['method'], get(l:msg, 'params', {}))
    else
      call s:on_agent_notification(l:msg['method'], get(l:msg, 'params', {}))
    endif
    return
  endif
  if !has_key(l:msg, 'id') || !has_key(s:st.pending, l:msg['id'])
    call s:note('[wire] ' . a:msg)
    return
  endif
  let l:Callback = remove(s:st.pending, l:msg['id'])
  call l:Callback(get(l:msg, 'result', v:null), get(l:msg, 'error', v:null))
endfunction

function! s:OnErr(_ch, msg) abort
  call add(s:st.log, a:msg)
  if len(s:st.log) > 50
    call remove(s:st.log, 0)
  endif
  " The agent logs to stderr; only failures reach the chat.
  if a:msg =~# '^\[\(error\|warn\)\]'
    call s:note('[agent] ' . a:msg)
  endif
endfunction

function! s:OnExit(_job, status) abort
  let s:st.job = 0
  let s:st.session = ''
  let s:st.busy = 0
  let s:st.reply_open = 0
  " Pending requests will never answer: fail them where they show.
  for l:id in keys(s:st.pending)
    call remove(s:st.pending, l:id)
  endfor
  call s:note('[agent exited (' . a:status . ')]')
endfunction

" --- Session --------------------------------------------------------------

function! muse_spark#open() abort
  call s:ensure_buffer()
  if win_findbuf(s:st.buf) == []
    execute 'botright sbuffer ' . s:st.buf
  else
    call win_gotoid(win_getid(win_findbuf(s:st.buf)[0]))
  endif
  if s:alive()
    return
  endif
  let s:st.permissions = []
  let s:st.session = ''
  call s:note('[starting ' . join(s:argv(), ' ') . ']')
  let s:st.job = job_start(s:argv(), {
    \ 'out_cb': function('s:OnOut'),
    \ 'err_cb': function('s:OnErr'),
    \ 'exit_cb': function('s:OnExit'),
    \ 'out_mode': 'nl',
    \ 'err_mode': 'nl',
    \ })
  if type(s:st.job) != v:t_job
    let s:st.job = 0
    call s:note('[error] the agent would not start; is it installed?')
    return
  endif
  " No fs, terminal or elicitation caps: the agent asks in plain chat and
  " this client answers permissions with :MuseSparkAllow/:MuseSparkDeny.
  call s:send('initialize', {
    \ 'protocolVersion': 1,
    \ 'clientCapabilities': {},
    \ 'clientInfo': {'name': 'muse-spark-vim', 'version': '0.19.0'},
    \ }, function('s:on_initialized'))
endfunction

function! s:on_initialized(result, error) abort
  if type(a:error) != v:t_none
    call s:note('[error] initialize: ' . s:error_text(a:error))
    return
  endif
  let l:info = get(a:result, 'agentInfo', {})
  let s:st.agent = type(l:info) == v:t_dict ? get(l:info, 'name', '') . ' ' . get(l:info, 'version', '') : ''
  call s:note('[connected: ' . s:st.agent . ']')
  call s:send('session/new', {
    \ 'cwd': getcwd(),
    \ 'mcpServers': get(g:, 'muse_spark_mcp_servers', []),
    \ }, function('s:on_session'))
endfunction

function! s:on_session(result, error) abort
  if type(a:error) != v:t_none
    call s:note('[error] session/new: ' . s:error_text(a:error))
    return
  endif
  let s:st.session = get(a:result, 'sessionId', '')
  let l:modes = get(a:result, 'modes', {})
  if type(l:modes) == v:t_dict
    let s:st.mode = get(l:modes, 'currentModeId', '')
    let s:st.modes = get(l:modes, 'availableModes', [])
  endif
  let s:st.model = muse_spark#current_model(get(a:result, 'configOptions', []))
  call s:refresh_header()
  call s:note('[session ' . s:st.session . ' on ' . (empty(s:st.model) ? 'the default model' : s:st.model) . ']')
  " Startup notes sit below the initial marker; re-mark so the first prompt
  " holds only what the person writes.
  call s:append(['', s:prompt_mark, ''])
endfunction

function! muse_spark#new_session() abort
  if empty(s:st.session) || !s:alive()
    call muse_spark#open()
    return
  endif
  call s:send('session/close', {'sessionId': s:st.session}, 0)
  let s:st.session = ''
  let s:st.model = ''
  call s:send('session/new', {
    \ 'cwd': getcwd(),
    \ 'mcpServers': get(g:, 'muse_spark_mcp_servers', []),
    \ }, function('s:on_session'))
endfunction

function! muse_spark#close() abort
  if !empty(s:st.session) && s:alive()
    call s:send('session/close', {'sessionId': s:st.session}, 0)
  endif
  if s:alive()
    call job_stop(s:st.job)
  endif
  let s:st.session = ''
  let s:st.busy = 0
  let s:st.permissions = []
  call s:note('[closed]')
endfunction

function! muse_spark#cancel() abort
  if empty(s:st.session) || !s:alive()
    call s:note('[error] no session to cancel.')
    return
  endif
  call s:send_raw(muse_spark#encode_notification('session/cancel', {'sessionId': s:st.session}))
  call s:note('[cancelled]')
endfunction

function! muse_spark#set_model(id) abort
  if empty(s:st.session) || !s:alive()
    call s:note('[error] no session; :MuseSpark starts one.')
    return
  endif
  call s:send('session/set_config_option', {
    \ 'sessionId': s:st.session,
    \ 'configId': 'model',
    \ 'value': a:id,
    \ }, function('s:on_config_options'))
endfunction

function! muse_spark#set_mode(id) abort
  if empty(s:st.session) || !s:alive()
    call s:note('[error] no session; :MuseSpark starts one.')
    return
  endif
  call s:send('session/set_mode', {'sessionId': s:st.session, 'modeId': a:id}, function('s:on_mode_set'))
endfunction

function! s:on_mode_set(result, error) abort
  if type(a:error) != v:t_none
    call s:note('[error] session/set_mode: ' . s:error_text(a:error))
    return
  endif
  call s:note('[mode set; the agent confirms it below]')
endfunction

function! s:on_config_options(result, error) abort
  if type(a:error) != v:t_none
    call s:note('[error] session/set_config_option: ' . s:error_text(a:error))
    return
  endif
  let s:st.model = muse_spark#current_model(get(a:result, 'configOptions', []))
  call s:refresh_header()
  call s:note('[model: ' . (empty(s:st.model) ? 'unchanged' : s:st.model) . ']')
endfunction

" --- Prompt ---------------------------------------------------------------

function! muse_spark#send() abort
  if empty(s:st.session) || !s:alive()
    call s:note('[error] no session; :MuseSpark starts one.')
    return
  endif
  if s:st.busy
    echomsg 'muse-spark: a turn is still running; :MuseSparkCancel stops it.'
    return
  endif
  let l:prompt = muse_spark#take_prompt(getbufline(s:st.buf, 1, '$'))
  if l:prompt.at < 0 || empty(l:prompt.text)
    echomsg 'muse-spark: write the prompt below the last You: line first.'
    return
  endif
  let s:st.busy = 1
  let s:st.reply_open = 0
  call s:append(['', s:agent_mark])
  call s:send('session/prompt', {
    \ 'sessionId': s:st.session,
    \ 'prompt': [{'type': 'text', 'text': l:prompt.text}],
    \ }, function('s:on_prompt_done'))
endfunction

function! s:on_prompt_done(result, error) abort
  let s:st.busy = 0
  let s:st.reply_open = 0
  if type(a:error) != v:t_none
    call s:note('[error] session/prompt: ' . s:error_text(a:error))
  else
    call s:note('[stop: ' . get(a:result, 'stopReason', 'end_turn') . ']')
  endif
  call s:append(['', s:prompt_mark, ''])
endfunction

function! s:error_text(error) abort
  if type(a:error) == v:t_dict
    return get(a:error, 'message', json_encode(a:error))
  endif
  return string(a:error)
endfunction

" --- Agent notifications --------------------------------------------------

function! s:on_agent_notification(method, params) abort
  if a:method ==# 'session/update'
    call s:on_update(get(a:params, 'update', {}))
    return
  endif
  " Anything else the wire adds later is shown as it came, never dropped.
  call s:note('[notification ' . a:method . '] ' . json_encode(a:params))
endfunction

function! s:on_update(update) abort
  if type(a:update) != v:t_dict
    return
  endif
  let l:kind = get(a:update, 'sessionUpdate', '')
  if l:kind ==# 'agent_message_chunk'
    call s:stream_text(get(a:update, 'content', {}), '')
  elseif l:kind ==# 'agent_thought_chunk'
    call s:stream_text(get(a:update, 'content', {}), '~ ')
  elseif l:kind ==# 'user_message_chunk'
    call s:stream_text(get(a:update, 'content', {}), '')
  elseif l:kind ==# 'tool_call' || l:kind ==# 'tool_call_update'
    call s:note(muse_spark#tool_line(a:update))
    call s:show_tool_content(get(a:update, 'content', v:null))
    let s:st.reply_open = 0
  elseif l:kind ==# 'plan'
    call s:show_plan(get(a:update, 'entries', []))
    let s:st.reply_open = 0
  elseif l:kind ==# 'available_commands_update'
    let l:names = []
    for l:command in get(a:update, 'availableCommands', [])
      if type(l:command) == v:t_dict
        call add(l:names, '/' . get(l:command, 'name', '?'))
      endif
    endfor
    call s:note('[commands: ' . join(l:names, ', ') . ']')
  elseif l:kind ==# 'current_mode_update'
    let s:st.mode = get(a:update, 'currentModeId', s:st.mode)
    call s:refresh_header()
  elseif l:kind ==# 'config_option_update'
    let l:model = muse_spark#current_model(get(a:update, 'configOptions', []))
    if !empty(l:model)
      let s:st.model = l:model
    endif
    call s:refresh_header()
  elseif l:kind ==# 'notice'
    call s:note('[notice] ' . get(a:update, 'title', '') . s:notice_detail(a:update))
  else
    call s:note('[update ' . l:kind . '] ' . json_encode(a:update))
  endif
endfunction

function! s:notice_detail(update) abort
  let l:detail = get(a:update, 'description', '')
  if type(l:detail) == v:t_string && !empty(l:detail)
    return ': ' . l:detail
  endif
  return ''
endfunction

" Append one content block's text to the open reply, honouring newlines.
function! s:stream_text(content, prefix) abort
  if type(a:content) != v:t_dict || get(a:content, 'type', '') !=# 'text'
    call s:note('[content] ' . json_encode(a:content))
    return
  endif
  let l:lines = split(get(a:content, 'text', ''), "\n", 1)
  if empty(a:prefix)
    call s:append_text(l:lines)
    return
  endif
  call s:append_text(map(copy(l:lines), 'a:prefix . v:val'))
endfunction

function! s:append_text(lines) abort
  if s:st.buf <= 0 || !bufexists(s:st.buf) || empty(a:lines)
    return
  endif
  if !s:st.reply_open
    let s:st.reply_open = 1
    call s:append(a:lines)
    return
  endif
  " The reply's last line is still being written: extend it, then add more.
  let l:last = getbufline(s:st.buf, '$')[0] . a:lines[0]
  call setbufline(s:st.buf, '$', l:last)
  if len(a:lines) > 1
    call s:append(a:lines[1 :])
  endif
  for l:win in win_findbuf(s:st.buf)
    call win_execute(l:win, 'normal! G')
  endfor
endfunction

function! s:show_tool_content(content) abort
  if type(a:content) == v:t_none
    return
  endif
  if type(a:content) != v:t_list
    return
  endif
  for l:item in a:content
    if type(l:item) != v:t_dict
      continue
    endif
    let l:type = get(l:item, 'type', '')
    if l:type ==# 'diff'
      call s:show_diff(l:item)
    elseif l:type ==# 'content'
      let l:block = get(l:item, 'content', {})
      if type(l:block) == v:t_dict && get(l:block, 'type', '') ==# 'text'
        call s:append(split(get(l:block, 'text', ''), "\n", 1))
      else
        call s:note('[tool content] ' . json_encode(l:item))
      endif
    elseif l:type ==# 'terminal'
      call s:note('[terminal ' . get(l:item, 'terminalId', '?') . ']')
    else
      call s:note('[tool content] ' . json_encode(l:item))
    endif
  endfor
endfunction

function! s:show_diff(diff) abort
  call s:note('[diff ' . get(a:diff, 'path', '?') . ']')
  let l:old = get(a:diff, 'oldText', v:null)
  if type(l:old) == v:t_string
    call s:append(['--- before:'] + split(l:old, "\n", 1))
  endif
  call s:append(['+++ after:'] + split(get(a:diff, 'newText', ''), "\n", 1))
endfunction

function! s:show_plan(entries) abort
  if type(a:entries) != v:t_list || empty(a:entries)
    return
  endif
  let l:lines = ['Plan:']
  for l:entry in a:entries
    if type(l:entry) != v:t_dict
      continue
    endif
    call add(l:lines, '- [' . get(l:entry, 'status', '?') . '] ' . get(l:entry, 'content', ''))
  endfor
  call s:append(l:lines)
endfunction

" --- Agent requests -------------------------------------------------------

function! s:on_agent_request(id, method, params) abort
  if a:method ==# 'session/request_permission'
    call s:on_permission(a:id, a:params)
    return
  endif
  " fs and terminal calls need caps this client never advertises; anything
  " else is refused by the book, and said out loud.
  call s:send_raw(muse_spark#encode_error(a:id, -32601, 'method not supported: ' . a:method))
  call s:note('[request ' . a:method . ' refused: not supported]')
endfunction

function! s:on_permission(id, params) abort
  let l:tool = get(a:params, 'toolCall', {})
  let l:options = get(a:params, 'options', [])
  if type(l:tool) != v:t_dict || type(l:options) != v:t_list || empty(l:options)
    call s:send_raw(muse_spark#encode_error(a:id, -32602, 'invalid permission request'))
    call s:note('[error] a malformed permission request was refused.')
    return
  endif
  call add(s:st.permissions, {'id': a:id, 'options': l:options})
  let l:title = type(l:tool) == v:t_dict ? l:tool : {}
  call s:note('[permission] ' . muse_spark#tool_line(l:title))
  let l:n = 0
  for l:option in l:options
    let l:n += 1
    if type(l:option) == v:t_dict
      call s:note('  ' . l:n . '. ' . get(l:option, 'name', '?') . ' (' . get(l:option, 'kind', '?') . ')')
    endif
  endfor
  call s:note('Answer with :MuseSparkAllow {n} or :MuseSparkDeny.')
endfunction

function! muse_spark#allow(choice) abort
  if empty(s:st.permissions)
    echomsg 'muse-spark: no permission is waiting.'
    return
  endif
  let l:waiting = remove(s:st.permissions, 0)
  let l:outcome = muse_spark#permission_outcome(l:waiting.options, a:choice)
  call s:send_raw(muse_spark#encode_response(l:waiting.id, l:outcome))
  call s:note('[answered: ' . a:choice . ']')
endfunction

function! muse_spark#deny() abort
  if empty(s:st.permissions)
    echomsg 'muse-spark: no permission is waiting.'
    return
  endif
  let l:waiting = remove(s:st.permissions, 0)
  call s:send_raw(muse_spark#encode_response(l:waiting.id, {'outcome': {'outcome': 'cancelled'}}))
  call s:note('[denied]')
endfunction
