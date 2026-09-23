# DSH Desktop launch diagnostic collector v2 (IT use)
# Usage:  irm http://<gateway>/setup/diag.ps1 | iex
# ASCII only on purpose: avoids console codepage mangling.
$ErrorActionPreference = 'SilentlyContinue'
$exe = Join-Path $env:LOCALAPPDATA 'Programs\DSH Desktop\DSH Desktop.exe'
"EXE=$exe  EXISTS=$(Test-Path $exe)"

"=== 0) clean slate: stop leftovers ==="
Get-Process | Where-Object { $_.ProcessName -like 'DSH*' } | ForEach-Object { "killing $($_.ProcessName) pid=$($_.Id)"; Stop-Process -Id $_.Id -Force }
Start-Sleep 2

"=== 1) start + life sampling (15s) ==="
$t0 = Get-Date
$p = Start-Process $exe -PassThru
"pid=$($p.Id) start=$($t0.ToString('HH:mm:ss'))"
for ($i = 1; $i -le 15; $i++) {
  Start-Sleep 1
  $g = Get-Process -Id $p.Id -EA 0
  if (-not $g) {
    $kids = Get-Process | Where-Object { $_.ProcessName -like 'DSH*' } | ForEach-Object { $_.ProcessName + ':' + $_.Id }
    "t=${i}s MAIN EXITED  other DSH procs: $($kids -join ', ')"
    break
  }
  $wt = ''
  try { $wt = ' win=' + [bool]$g.MainWindowHandle } catch {}
  "t=${i}s alive ram=$([int]($g.WorkingSet64/1MB))MB$wt"
}
$p.WaitForExit(3000) | Out-Null
if ($p.HasExited) { "EXITED code=$($p.ExitCode)" } else { "STILL RUNNING after 18s" }

"=== 2) app log files ==="
$logDir = Join-Path $env:APPDATA 'DSH Desktop\logs'
Get-ChildItem $logDir -File | Sort-Object LastWriteTime -Descending | Select-Object -First 4 Name, LastWriteTime, Length | Format-Table -AutoSize

"=== 3) MAIN log tail 90 (not error-only) ==="
$main = Get-ChildItem $logDir -File | Where-Object { $_.Name -notlike '*error*' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($main) { "[$($main.Name)  $($main.LastWriteTime)]"; Get-Content $main.FullName -Tail 90 } else { 'no main log' }

"=== 4) ERROR log tail 40 ==="
$err = Get-ChildItem $logDir -File | Where-Object { $_.Name -like '*error*' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($err) { "[$($err.Name)]"; Get-Content $err.FullName -Tail 40 } else { 'no error log' }

"=== 5) harness home logs ==="
Get-ChildItem (Join-Path $env:USERPROFILE '.dsh\logs') -File -EA 0 | Sort-Object LastWriteTime -Descending | Select-Object -First 3 Name, LastWriteTime
$hl = Get-ChildItem (Join-Path $env:USERPROFILE '.dsh\logs') -File -EA 0 | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($hl) { Get-Content $hl.FullName -Tail 40 }

Read-Host "press ENTER to close"
