# M94 K: the same saved Cursor answers as read.sh; no model or profile.
param([ValidateSet('allow', 'deny', 'crash')][string]$Verdict)
[void][Console]::In.ReadToEnd()
switch ($Verdict) {
    'allow' { [Console]::Out.WriteLine('{"permission":"allow"}'); exit 0 }
    'deny' { [Console]::Out.WriteLine('{"permission":"deny"}'); exit 2 }
    'crash' { [Console]::Error.WriteLine('hook crashed'); exit 1 }
}
exit 1
