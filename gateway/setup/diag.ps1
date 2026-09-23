# DSH Desktop launch diagnostic collector (IT use)
# Usage:  irm http://<gateway>/setup/diag.ps1 | iex
# ASCII only on purpose: avoids console codepage mangling.
$ErrorActionPreference = 'SilentlyContinue'
$exe = Join-Path $env:LOCALAPPDATA 'Programs\DSH Desktop\DSH Desktop.exe'
"EXE=$exe"
"EXISTS=$(Test-Path $exe)"

"=== 1) run in foreground (blocks until exit) ==="
if (Test-Path $exe) {
  & $exe
  "EXIT_CODE=$LASTEXITCODE"
} else {
  "APP EXE MISSING - likely quarantined by antivirus, check AV quarantine/deny list NOW"
}

"`n=== 2) app log tail 80 ==="
$f = Get-ChildItem (Join-Path $env:APPDATA 'DSH Desktop\logs') -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($f) { "[$($f.Name)  $($f.LastWriteTime)]"; Get-Content $f.FullName -Tail 80 } else { "NO LOG FILES" }

"`n=== 3) registered antivirus products (SecurityCenter2, works without Defender module) ==="
Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct |
  Select-Object displayName, productState | Format-List

"=== 4) crash dumps (last 3h) ==="
Get-ChildItem (Join-Path $env:LOCALAPPDATA 'CrashDumps') -File |
  Where-Object { $_.LastWriteTime -gt (Get-Date).AddHours(-3) } |
  Select-Object Name, LastWriteTime, Length | Format-Table -AutoSize

"=== 5) profile selection + profile dir sanity ==="
"selection: " + (Get-Content (Join-Path $env:APPDATA 'DSH Desktop\profile-selection\state.json') -Raw)
"profile desktop exists: " + (Test-Path (Join-Path $env:USERPROFILE '.dsh\profiles\desktop\package.json'))
"plugin dir exists: " + (Test-Path (Join-Path $env:USERPROFILE '.dsh\profiles\desktop\node_modules\dsh-enterprise'))

Read-Host "press ENTER to close"
