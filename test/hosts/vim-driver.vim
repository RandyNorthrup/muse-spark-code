" Driver for test/hosts/vim.sh (PLAN.md M66): real Vim drives the shipped
" plugin against the installed agent. No model call anywhere: at most one
" locally answered command (/whatsnew). Every wait is bounded; a hang ends in
" cquit, never silence. Exits 0 on PASS (transcript written), nonzero on FAIL.
set encoding=utf-8
let s:plugin = $VIM_PLUGIN
let s:transcript = $VIM_TRANSCRIPT
execute 'set rtp+=' . fnameescape(s:plugin)
runtime plugin/muse_spark.vim
call assert_true(exists(':MuseSpark') == 2, 'the :MuseSpark command exists')

" --- Pure wire helpers, incl. malformed input ------------------------------
" (Compared parsed: key order on the wire is the encoder's business.)
call assert_equal({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': 1}},
  \ json_decode(muse_spark#encode_request(1, 'initialize', {'protocolVersion': 1})))
call assert_equal({'jsonrpc': '2.0', 'id': 2, 'result': {'outcome': {'outcome': 'cancelled'}}},
  \ json_decode(muse_spark#encode_response(2, {'outcome': {'outcome': 'cancelled'}})))
call assert_equal({'jsonrpc': '2.0', 'id': 3, 'error': {'code': -32601, 'message': 'nope'}},
  \ json_decode(muse_spark#encode_error(3, -32601, 'nope')))
call assert_equal({'jsonrpc': '2.0', 'method': 'session/cancel', 'params': {'sessionId': 's'}},
  \ json_decode(muse_spark#encode_notification('session/cancel', {'sessionId': 's'})))

let [s:ok, s:msg] = muse_spark#parse_line('{"id":1,"result":{}}')
call assert_true(s:ok && s:msg.id == 1, 'a response line parses')
call assert_equal(0, muse_spark#parse_line('not json')[0])
call assert_equal(0, muse_spark#parse_line('[1,2]')[0])
call assert_equal(0, muse_spark#parse_line('')[0])

" A real initialize response (captured 2026-10-22 from the packed 0.19.0
" agent: `node dist/acp.js --backend museCode` + initialize) parses, and a
" real permission request answers with its own option id.
let s:init = '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true},"agentInfo":{"name":"muse-spark-code-acp","title":"Muse Spark Code (Unofficial)","version":"0.19.0"}}}'
let [s:ok, s:msg] = muse_spark#parse_line(s:init)
call assert_true(s:ok, 'the captured initialize response parses')
call assert_equal('muse-spark-code-acp', s:msg.result.agentInfo.name)
let s:perm = [{'optionId': 'allow-once', 'name': 'Allow once', 'kind': 'allow_once'}, {'optionId': 'reject', 'name': 'Reject', 'kind': 'reject_once'}]
call assert_equal({'outcome': {'outcome': 'selected', 'optionId': 'reject'}},
  \ muse_spark#permission_outcome(s:perm, '2'))
call assert_equal('cancelled', muse_spark#permission_outcome(s:perm, '9')['outcome']['outcome'])
call assert_equal('cancelled', muse_spark#permission_outcome(s:perm, 'x')['outcome']['outcome'])
call assert_equal('cancelled', muse_spark#permission_outcome([], '1')['outcome']['outcome'])

call assert_equal('[tool execute] list files — completed',
  \ muse_spark#tool_line({'toolCallId': 't', 'kind': 'execute', 'title': 'list files', 'status': 'completed'}))
call assert_equal('[tool other] t',
  \ muse_spark#tool_line({'toolCallId': 't'}))
call assert_equal('[tool edit] rename — in_progress',
  \ muse_spark#tool_line({'toolCallId': 't', 'kind': 'edit', 'name': 'rename', 'status': 'in_progress'}))

call assert_equal('m1', muse_spark#current_model([{'id': 'model', 'currentValue': 'm1'}]))
call assert_equal('', muse_spark#current_model([{'id': 'effort'}]))
call assert_equal('', muse_spark#current_model([]))

let s:prompt = muse_spark#take_prompt(['# h', 'You:', 'hello', '', 'world', ''])
call assert_equal(1, s:prompt.at)
call assert_equal("hello\n\nworld", s:prompt.text)
call assert_equal(-1, muse_spark#take_prompt(['# h'])['at'])
call assert_equal('', muse_spark#take_prompt(['You:', '', ''])['text'])
let s:two = muse_spark#take_prompt(['You:', 'first', 'Muse:', 'reply', 'You:', 'second'])
call assert_equal('second', s:two.text)

call assert_equal(['# Muse Spark — m (fast)', 'cwd: /tmp', ''],
  \ muse_spark#header_lines('m', 'fast', '/tmp'))

" --- Live handshake --------------------------------------------------------
execute 'cd ' . fnameescape($VIM_CWD)
let g:muse_spark_command = [$VIM_NODE, $VIM_ACP_JS]
let g:muse_spark_args = ['--backend', 'museCode']
MuseSpark

function! s:chat() abort
  return getbufline(bufnr('Muse Spark'), 1, '$')
endfunction

function! s:wait_for(pattern, seconds) abort
  let l:start = reltime()
  while reltimefloat(reltime(l:start)) < a:seconds
    for l:line in s:chat()
      if l:line =~# a:pattern
        return l:line
      endif
    endfor
    sleep 100m
  endwhile
  return ''
endfunction

let s:connected = s:wait_for('^\[connected: muse-spark-code-acp ' . $VIM_VERSION . '\]$', 30)
call assert_true(!empty(s:connected), 'initialize answers with this package version, got: ' . string(s:chat()))

" With the Muse CLI installed this is a session; without it the agent's
" refusal must surface in the chat instead of hanging the client.
let s:session = s:wait_for('^\[session .*', 60)
let s:refused = s:session ==# '' ? s:wait_for('^\[error\] session/new: ', 1) : ''
if s:session !=# ''
  call assert_match('^# Muse Spark — ', s:chat()[0])
  " One locally answered command: no model turn, no sign-in needed.
  call appendbufline(bufnr('Muse Spark'), '$', ['/whatsnew'])
  MuseSparkSend
  let s:stop = s:wait_for('^\[stop: end_turn\]$', 90)
  call assert_true(!empty(s:stop), 'the local command ends the turn, got: ' . string(s:chat()))
  let s:lines = s:chat()
  let s:muse = index(s:lines, 'Muse:')
  let s:stop_at = index(s:lines, '[stop: end_turn]')
  call assert_true(s:muse >= 0 && s:stop_at > s:muse + 1, 'the reply holds text, got: ' . string(s:lines))
  MuseSparkNew
  let s:started = reltime()
  let s:sessions = [s:session]
  while len(s:sessions) < 2 && reltimefloat(reltime(s:started)) < 60
    let s:sessions = filter(copy(s:chat()), 'v:val =~# "^\\[session "')
    sleep 100m
  endwhile
  call assert_true(len(s:sessions) == 2 && s:sessions[1] !=# s:sessions[0], 'a fresh session starts')
  MuseSparkClose
  call assert_true(s:wait_for('^\[closed\]$', 5) !=# '', 'close is said')
  call writefile(['PASS session /whatsnew /new /close'] + s:chat(), s:transcript)
elseif s:refused !=# ''
  call assert_true(s:wait_for('^\[agent exited', 1) ==# '', 'the agent survives its own refusal')
  call writefile(['PASS refusal surfaces without the CLI: ' . s:refused] + s:chat(), s:transcript)
else
  call add(v:errors, 'neither a session nor a refusal arrived: ' . string(s:chat()))
endif

if !empty(v:errors)
  call writefile(['FAIL'] + v:errors + s:chat(), s:transcript)
  cquit
endif
qa!
