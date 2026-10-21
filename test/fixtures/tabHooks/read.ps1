# M94 K: the same saved Cursor answers as read.sh; no model or profile.
param([ValidateSet('allow', 'deny', 'crash', 'garbage')][string]$Verdict)
[void][Console]::In.ReadToEnd()
switch ($Verdict) {
    'allow' { [Console]::Out.WriteLine('{"permission":"allow"}'); exit 0 }
    'deny' { [Console]::Out.WriteLine('{"permission":"deny"}'); exit 2 }
    'crash' { [Console]::Error.WriteLine('hook crashed'); exit 1 }
    'garbage' { [Console]::Out.WriteLine('not json'); exit 0 }
}
exit 1
