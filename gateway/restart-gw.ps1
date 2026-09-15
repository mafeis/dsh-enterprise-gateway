# 企业网关（8899）自助重启脚本 · 用法：powershell -File restart-gw.ps1
# 网关以 WMI 独立进程运行（不挂任何终端会话），日志追加到 data\gateway-stdout.log
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1) 停掉现有网关（按 8899 监听进程定位，避免误杀其他 node）
$conn = Get-NetTCPConnection -LocalPort 8899 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
  $pid8899 = $conn.OwningProcess
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pid8899"
  if ($proc.Name -eq 'node.exe') {
    Stop-Process -Id $pid8899 -Force
    # 顺带清理它的 cmd 包装父进程（若还在）
    if ($proc.ParentProcessId) {
      $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.ParentProcessId)" -ErrorAction SilentlyContinue
      if ($parent -and $parent.Name -eq 'cmd.exe') { Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue }
    }
    Start-Sleep 1
    Write-Host "已停止旧网关 (PID $pid8899)"
  } else {
    Write-Host "⚠ 8899 被非网关进程占用（PID $pid8899 $($proc.Name)），中止"; exit 1
  }
}

# 2) WMI 拉起独立进程（父进程为系统 WMI 服务，关终端不影响）
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = 'cmd.exe /c "cd /d "' + $dir + '" && node gateway.mjs >> data\gateway-stdout.log 2>&1"'
}
if ($r.ReturnValue -ne 0) { Write-Host "✗ 启动失败 ReturnCode=$($r.ReturnValue)"; exit 1 }
Write-Host "已拉起网关 (包装 PID $($r.ProcessId))，等待端口就绪…"

# 3) 等待 8899 就绪
$deadline = (Get-Date).AddSeconds(25)
do {
  Start-Sleep -Milliseconds 500
  $up = Get-NetTCPConnection -LocalPort 8899 -State Listen -ErrorAction SilentlyContinue
} until ($up -or (Get-Date) -gt $deadline)
if ($up) {
  $real = (Get-NetTCPConnection -LocalPort 8899 -State Listen | Select-Object -First 1).OwningProcess
  Write-Host "✓ 网关已就绪: http://127.0.0.1:8899 (node PID $real) · 日志: data\gateway-stdout.log"
} else {
  Write-Host "✗ 25 秒内未就绪，请看 data\gateway-stdout.log"
  exit 1
}
