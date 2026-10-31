" Live driver for test/e2e/vim.live.e2e.test.ts (MUSE_LIVE_VIM=1, never in
" CI): real Vim holds 3 turns through the packed agent on the contributor
" model. Read-only: only [tool read] with an allow_once option is allowed,
" picked by its own number; anything else is denied. The test counts the
" model requests afterwards and fails past 4.
set encoding=utf-8
execute 'set rtp+=' . fnameescape($VIMLIVE_PLUGIN)
runtime plugin/muse_spark.vim
execute 'cd ' . fnameescape($VIMLIVE_CWD)
let g:muse_spark_command = [$VIMLIVE_NODE, $VIMLIVE_ACP_JS]
let g:muse_spark_args = ['--backend', 'museCode', '--allow-contributor-models', '--trust-workspace']
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
    sleep 200m
  endwhile
  return ''
endfunction

function! s:count_stops() abort
  return len(filter(s:chat(), 'v:val =~# "^\\[stop: "'))
endfunction

function! s:count_asks() abort
  return len(filter(s:chat(), 'v:val =~# "^Answer with :MuseSparkAllow"'))
endfunction

" One turn: append the prompt, send, answer read-only permissions, wait stop.
function! s:turn(prompt, seconds) abort
  let l:stops0 = s:count_stops()
  let l:asks0 = s:count_asks()
  let l:answered = 0
  call appendbufline(bufnr('Muse Spark'), '$', [a:prompt])
  MuseSparkSend
  let l:start = reltime()
  while reltimefloat(reltime(l:start)) < a:seconds
    let l:lines = s:chat()
    let l:asks = len(filter(copy(l:lines), 'v:val =~# "^Answer with :MuseSparkAllow"')) - l:asks0
    if l:asks > l:answered + 1
      " Piled-up permissions: deny the oldest, one per pass (FIFO is safe).
      MuseSparkDeny
      let l:answered += 1
    elseif l:asks > l:answered
      let l:idx = len(l:lines) - 1
      while l:idx >= 0 && l:lines[l:idx] !~# '^\[permission\] '
        let l:idx -= 1
      endwhile
      let l:pick = 0
      if l:idx >= 0 && l:lines[l:idx] =~# '\[tool read\]'
        let l:n = 0
        for l:opt in l:lines[l:idx + 1 :]
          if l:opt =~# '^Answer with'
            break
          endif
          if l:opt =~# '^  \d\+\. .* (allow_once)$'
            let l:pick = l:n + 1
          endif
          if l:opt =~# '^  \d\+\. '
            let l:n += 1
          endif
        endfor
      endif
      if l:pick > 0
        execute 'MuseSparkAllow ' . l:pick
      else
        MuseSparkDeny
      endif
      let l:answered += 1
    endif
    if len(filter(copy(l:lines), 'v:val =~# "^\\[stop: "')) > l:stops0
      return 'stop'
    endif
    sleep 200m
  endwhile
  return 'TIMEOUT'
endfunction

if s:wait_for('^\[session .*', 90) ==# ''
  call writefile(['LIVE-FAIL no session'] + s:chat(), $VIMLIVE_TRANSCRIPT)
  cquit
endif
" The run's contributor model (RLF-SAFEFIX item 1): the switch is refused
" unless the agent lists it, and no prompt is sent on any other model.
execute 'MuseSparkModel ' . $VIMLIVE_MODEL
if s:wait_for('^\[model: ' . escape($VIMLIVE_MODEL, '.') . '\]$', 60) ==# ''
  call writefile(['LIVE-FAIL model switch refused'] + s:chat(), $VIMLIVE_TRANSCRIPT)
  cquit
endif
if stridx(s:chat()[0], '# Muse Spark — ' . $VIMLIVE_MODEL) != 0
  call writefile(['LIVE-FAIL model is not the contributor: ' . s:chat()[0]] + s:chat(), $VIMLIVE_TRANSCRIPT)
  cquit
endif
let s:r1 = s:turn('Reply with exactly the word READY and nothing else.', 300)
let s:r2 = s:turn('Read the file notes.txt in this workspace and quote its second line back to me, nothing else.', 300)
let s:r3 = s:turn('Reply with the single word DONE.', 300)
MuseSparkClose
call writefile(['LIVE ' . s:r1 . ' ' . s:r2 . ' ' . s:r3] + s:chat(), $VIMLIVE_TRANSCRIPT)
qa!
