# DSH 企业客户端 · Windows 一键安装（PowerShell 5.1+ 兼容，用户级安装无需管理员）
# 流程: 网关地址 → 装 Node/pnpm（网关镜像优先，用户目录免管理员）→ 装 DSH Desktop（网关镜像优先）→ dsh CLI shim → 装企业插件 → 预置(零弹窗/增强模式/网关预填/工作区) → 启动落在登录页
# 托管: 网关自带接入页 http://<网关>:8899/setup 下发本脚本，__GATEWAY_URL__ 占位符按请求来源自动替换
# 用法（在 PowerShell 中执行，三选一）:
#   irm http://<网关>:<端口>/setup/windows-setup.ps1 | iex
#   & ([scriptblock]::Create((irm http://<网关>:<端口>/setup/windows-setup.ps1)))
#   下载后: powershell -ExecutionPolicy Bypass -File .\windows-setup.ps1 -GatewayUrl http://<网关>:<端口>
# 参数也可用环境变量给：DSH_GATEWAY_URL / DSH_PLUGIN_VERSION / DSH_NPM_REGISTRY
# 注意：本脚本首条语句不能是 param()，也绝不能带 UTF-8 BOM（原因见下面绑参处注释，check.mjs 有 lint）
#   离线拿 -File 跑时，PS 5.1 会把无 BOM 的 UTF-8 当 ANSI 读、日志乱码，改用：
#   powershell -Command "iex ([Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes('.\windows-setup.ps1')))" 
# 来源优先级：企业网关已发布物料（安装包读 releases.json，Node/pnpm 读 env.json，都带 sha256）> DSH_SETUP_MIRROR > 官方源/国内镜像
# 纯内网可用前提：网关「桌面客户端 → 环境物料」把 Node/pnpm 也同步并发布；关掉公网回退后脚本绝不外连
# 可选环境变量 DSH_SETUP_MIRROR: 安装包镜像前缀（如内网/镜像站），形如 https://mirror.example.com/dsh
# 参数不用 param()：客户机走 `irm … | iex`，脚本是以「字符串」被编译的，首字符稍有污染
# （BOM、复制粘贴带进来的全角空格等）param 就不再被当成声明，整块声明会被逐行当语句执行，
# 报「赋值表达式无效 / InvalidLeftHandSide」——真机上踩过。手工绑 $args + 环境变量，两条路径都稳。
$GatewayUrl    = if ($env:DSH_GATEWAY_URL)    { $env:DSH_GATEWAY_URL }    else { '__GATEWAY_URL__' }
$PluginVersion = if ($env:DSH_PLUGIN_VERSION) { $env:DSH_PLUGIN_VERSION } else { 'latest' }
$Registry      = if ($env:DSH_NPM_REGISTRY)   { $env:DSH_NPM_REGISTRY }   else { 'https://registry.npmjs.org/' }
$Argv = if ($args) { @($args) } else { @() }
for ($ai = 0; $ai -lt $Argv.Count; $ai++) {
  $ak = [string]$Argv[$ai]
  if     ($ak -eq '-GatewayUrl')    { if ($ai + 1 -lt $Argv.Count) { $GatewayUrl    = [string]$Argv[++$ai] } }
  elseif ($ak -eq '-PluginVersion') { if ($ai + 1 -lt $Argv.Count) { $PluginVersion = [string]$Argv[++$ai] } }
  elseif ($ak -eq '-Registry')      { if ($ai + 1 -lt $Argv.Count) { $Registry      = [string]$Argv[++$ai] } }
  elseif ($ak) { Write-Host "  忽略不认识的参数 $ak" }
}
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch {}

function Log($m) { Write-Host "[dsh-enterprise] $m" }
function Die($m) { Write-Host "[dsh-enterprise][FATAL] $m" -ForegroundColor Red; exit 1 }

function Add-UserPath([string]$dir) {
  $cur = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $cur) { $cur = '' }
  if (($cur -split ';') -notcontains $dir) {
    [Environment]::SetEnvironmentVariable('Path', ($cur.TrimEnd(';') + ';' + $dir), 'User')
  }
  if (($env:Path -split ';') -notcontains $dir) { $env:Path = "$dir;$env:Path" }
}

$AppDir   = Join-Path $env:LOCALAPPDATA 'Programs\DSH Desktop'
$Exe      = Join-Path $AppDir 'DSH Desktop.exe'
$DshHome  = Join-Path $env:USERPROFILE '.dsh'
$ProfileD = Join-Path $DshHome 'profiles\desktop'
$Mirrors  = @('https://npmmirror.com/mirrors/node', 'https://nodejs.org/dist')

# ===== [1/6] 网关地址（放在最前：后面每一步都从网关取东西，包括 Node 本体） =====
Log '[1/6] 网关地址'
# 非 URL 格式（含未替换的源码占位符）才清空转交互；网关注入的真实地址直接使用
if ($GatewayUrl -notmatch '^https?://') { $GatewayUrl = '' }
if (-not $GatewayUrl -and [Environment]::UserInteractive) {
  try { $GatewayUrl = Read-Host '企业网关地址（回车 = 默认 http://127.0.0.1:8899）' } catch {}
}
if (-not $GatewayUrl) { $GatewayUrl = 'http://127.0.0.1:8899' }
$GatewayUrl = $GatewayUrl.Trim().TrimEnd('/')
if ($GatewayUrl -notmatch '^https?://') { $GatewayUrl = "http://$GatewayUrl" }
Log "  使用: $GatewayUrl"

# ===== [2/6] Node 与 pnpm（缺什么补什么，企业网关镜像优先，公网只作兜底） =====
# 装到用户目录、免管理员、免交互：Node 用官方 zip，pnpm 用官方按平台发布的原生 exe 包
# （pnpm 12 起主 npm 包不再自带运行时：install.js 要用 optionalDependencies 里的
#  @pnpm/exe.<平台> 顶掉占位 bin，顶不到就首次运行时联网下载 —— 纯内网两头都不通）。
Log '[2/6] Node 与 pnpm'
$NodeDir  = Join-Path $env:LOCALAPPDATA 'Programs\nodejs'
$PnpmDir  = Join-Path $env:LOCALAPPDATA 'Programs\pnpm'
$Registries = @('https://registry.npmmirror.com', 'https://registry.npmjs.org', ($Registry.TrimEnd('/'))) | Select-Object -Unique

# 环境物料事实源：/setup/env.json（版本、路径、sha256 全由网关给，脚本里不写死）
$EnvJson = $null
try { $EnvJson = Invoke-RestMethod "$GatewayUrl/setup/env.json" -TimeoutSec 15 -UserAgent 'dsh-setup' } catch {}
$AllowFallback = if ($EnvJson -and ($EnvJson.PSObject.Properties.Name -contains 'allowUpstreamFallback')) { [bool]$EnvJson.allowUpstreamFallback } else { $true }

function Get-RemoteFile([string]$url, [string]$out) {
  # 统一下载口：失败就抛，让调用方换下一个源
  # PS 5.1 的 IWR 进度条逐块同步渲染，实测把局域网 150MB 从数百 MB/s 拖到 0.4MB/s ——
  # 函数作用域内关掉进度显示，出函数自动还原，不污染用户会话
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest $url -OutFile $out -TimeoutSec 3600 -UserAgent 'dsh-setup'
}
function Test-Sha256([string]$file, [string]$want) {
  if (-not $want) { Log "  注意：$([IO.Path]::GetFileName($file)) 没有可用校验值，跳过校验"; return $true }
  $got = (Get-FileHash $file -Algorithm SHA256).Hash.ToLower()
  if ($got -ne $want.ToLower()) { Die "$([IO.Path]::GetFileName($file)) 校验失败（包不完整或被篡改）" }
  return $true
}
function Expand-TgzEntry([string]$tgz, [string]$leafName, [string]$outFile) {
  # 优先系统自带 bsdtar（Win10 1803+ 有）；老系统回落到内置解包：
  # gzip 流 + tar 的 512 字节头，只取需要的那个文件（npm 包里路径是 package/<name>）
  if (Get-Command tar.exe -ErrorAction SilentlyContinue) {
    $tmp = Join-Path $env:TEMP ('dsh-tar-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    try {
      & tar.exe -xzf $tgz -C $tmp
      if ($LASTEXITCODE -ne 0) { throw "tar.exe 退出码 $LASTEXITCODE" }
      $hit = @(Get-ChildItem -Path $tmp -Recurse -Filter $leafName -ErrorAction SilentlyContinue)
      if (-not $hit.Count) { throw "包里找不到 $leafName" }
      Copy-Item $hit[0].FullName $outFile -Force
      return
    } finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  }
  $fs = [IO.File]::OpenRead($tgz)
  $gz = New-Object IO.Compression.GzipStream($fs, [IO.Compression.CompressionMode]::Decompress)
  try {
    $hdr = New-Object byte[] 512
    $buf = New-Object byte[] 65536
    while ($true) {
      $read = 0
      while ($read -lt 512) { $n = $gz.Read($hdr, $read, 512 - $read); if ($n -le 0) { break }; $read += $n }
      if ($read -lt 512 -or $hdr[0] -eq 0) { break }
      $name = ([Text.Encoding]::ASCII.GetString($hdr, 0, 100) -split ([char]0))[0]
      $sizeTxt = (([Text.Encoding]::ASCII.GetString($hdr, 124, 12) -split ([char]0))[0]).Trim()
      $size = if ($sizeTxt) { [Convert]::ToInt64($sizeTxt, 8) } else { 0 }
      $blocks = [int]([Math]::Ceiling($size / 512.0) * 512)
      if ($name -and ([IO.Path]::GetFileName($name) -eq $leafName) -and $size -gt 0) {
        $dst = [IO.File]::Create($outFile)
        try {
          $left = $size
          while ($left -gt 0) {
            $n = $gz.Read($buf, 0, [Math]::Min(65536, $left)); if ($n -le 0) { break }
            $dst.Write($buf, 0, $n); $left -= $n
          }
        } finally { $dst.Dispose() }
        $skip = $blocks - $size
        while ($skip -gt 0) { $n = $gz.Read($buf, 0, [Math]::Min(65536, $skip)); if ($n -le 0) { break }; $skip -= $n }
        return
      }
      $skip = $blocks
      while ($skip -gt 0) { $n = $gz.Read($buf, 0, [Math]::Min(65536, $skip)); if ($n -le 0) { break }; $skip -= $n }
    }
    throw "包里找不到 $leafName"
  } finally { $gz.Dispose(); $fs.Dispose() }
}

# ---- Node ----
if (Get-Command node -ErrorAction SilentlyContinue) {
  Log "  已检测到可用的 Node $(& node -v)，沿用"
} else {
  $zip = Join-Path $env:TEMP 'dsh-node-win-x64.zip'
  $ver = ''; $src = ''
  $mine = $null
  if ($EnvJson -and $EnvJson.node) {
    $files = @($EnvJson.node.files.PSObject.Properties) | Where-Object { $_.Name -eq 'win-x64' }
    if ($files.Count) { $mine = $files[0].Value }
  }
  if ($mine -and $mine.path) {
    $ver = $mine.version
    Log "  本机没有 Node，从企业网关取 Node $ver（win-x64）"
    try { Get-RemoteFile "$GatewayUrl$($mine.path)" $zip; Test-Sha256 $zip $mine.sha256; $src = "企业网关 $ver" } catch { $src = ''; Remove-Item $zip -Force -ErrorAction SilentlyContinue }
  }
  if (-not $src) {
    if (-not $AllowFallback) { Die '企业策略已禁止回退公网，且网关上没有 Windows 可用的 Node。请让 IT 在「桌面客户端 → 环境物料」同步并发布 Node LTS' }
    Log '  回退公网取 Node LTS（版本动态探测，不写死）'
    foreach ($m in $Mirrors) {
      try {
        $idx = Invoke-RestMethod "$m/index.json" -TimeoutSec 30 -UserAgent 'dsh-setup'
        $rel = @($idx | Where-Object { $_.lts })[0]
        if (-not $rel) { $rel = @($idx)[0] }
        if (-not $rel) { continue }
        $ver = $rel.version
        $zipName = "node-$ver-win-x64.zip"
        Get-RemoteFile "$m/$ver/$zipName" $zip
        # 摘要清单是纯文本：<sha256>  node-vX-win-x64.zip；拿到就必校
        $sums = $null
        try { $sums = (Invoke-WebRequest "$m/$ver/SHASUMS256.txt" -TimeoutSec 60 -UserAgent 'dsh-setup').Content } catch {}
        $line = @($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($zipName) })[0]
        if ($line) { Test-Sha256 $zip (($line.Trim() -split '\s+')[0]) } else { Log '  注意：该源没有校验清单，跳过校验' }
        $src = "公网 $m $ver"
        break
      } catch { Remove-Item $zip -Force -ErrorAction SilentlyContinue }
    }
  }
  if (-not $src) { Die 'Node 未能安装：网关与公网都没有可用的构建' }
  $tmpX = Join-Path $env:TEMP ('node-x-' + [guid]::NewGuid().ToString('N'))
  Expand-Archive $zip -DestinationPath $tmpX -Force
  if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
  Move-Item (Join-Path $tmpX "node-$ver-win-x64") $NodeDir
  Remove-Item $tmpX -Recurse -Force
  Remove-Item $zip -Force
  Add-UserPath $NodeDir
  Log "  已安装 Node $(& node -v) ← $src"
}

# ---- pnpm（官方按平台发布的原生二进制包，装完不依赖 Node、也不用 npm i -g） ----
$PnpmExe = Join-Path $PnpmDir 'pnpm.exe'
$PnpmCmd = Get-Command pnpm.cmd, pnpm.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if ($PnpmCmd) {
  Log "  已检测到 pnpm $(& $PnpmCmd.Source -v)，沿用"
} else {
  $tgz = Join-Path $env:TEMP 'dsh-pnpm-win-x64.tgz'
  $psrc = ''
  $pver = ''
  $pmine = $null
  if ($EnvJson -and $EnvJson.pnpm) {
    $pf = @($EnvJson.pnpm.files.PSObject.Properties) | Where-Object { $_.Name -eq 'win-x64' }
    if ($pf.Count) { $pmine = $pf[0].Value; $pver = $EnvJson.pnpm.version }
  }
  if ($pmine -and $pmine.path) {
    Log "  从企业网关取 pnpm $pver（win-x64 原生包）"
    try { Get-RemoteFile "$GatewayUrl$($pmine.path)" $tgz; Test-Sha256 $tgz $pmine.sha256; $psrc = "企业网关 $pver" } catch { $psrc = ''; Remove-Item $tgz -Force -ErrorAction SilentlyContinue }
  }
  if (-not $psrc) {
    if (-not $AllowFallback) { Die '企业策略已禁止回退公网，且网关上没有 pnpm。请让 IT 在「桌面客户端 → 环境物料」同步并发布 pnpm' }
    Log '  回退公网取 pnpm 原生包（含 integrity 校验）'
    foreach ($r in $Registries) {
      try {
        # 先问主包要「现在的最新版」，再取该版的平台原生包；平台包漏发这个版时才退回它自己的 latest
        $pv = $null
        try { $pv = (Invoke-RestMethod "$r/pnpm/latest" -TimeoutSec 30 -UserAgent 'dsh-setup').version } catch {}
        $meta = $null
        $cands = @()
        if ($pv) { $cands += "$r/@pnpm%2Fexe.win32-x64/$pv" }
        $cands += "$r/@pnpm%2Fexe.win32-x64/latest"
        foreach ($q in $cands) {
          try { $meta = Invoke-RestMethod $q -TimeoutSec 30 -UserAgent 'dsh-setup'; break } catch {}
        }
        if (-not $meta -or -not $meta.dist -or -not $meta.dist.tarball) { continue }
        Get-RemoteFile $meta.dist.tarball $tgz
        # npm 的 integrity 是 sha512-base64，与网关同一口径
        $integrity = [string]$meta.dist.integrity
        if ($integrity -like 'sha512-*') {
          $sha = [Security.Cryptography.SHA512]::Create()
          $bytes = [IO.File]::ReadAllBytes($tgz)
          $got = [Convert]::ToBase64String($sha.ComputeHash($bytes))
          if ($got.TrimEnd('=') -ne $integrity.Substring(7).TrimEnd('=')) { throw 'pnpm 包 integrity 校验不一致' }
        }
        $pver = [string]$meta.version
        $psrc = "公网 $r"
        break
      } catch { if ($_ -match 'integrity') { Log "  $r 的包校验不过，换一个源" }; Remove-Item $tgz -Force -ErrorAction SilentlyContinue }
    }
  }
  if (-not $psrc) { Die 'pnpm 未能安装：网关与公网都没有可用的包' }
  New-Item -ItemType Directory -Force -Path $PnpmDir | Out-Null
  Expand-TgzEntry $tgz 'pnpm.exe' $PnpmExe
  Remove-Item $tgz -Force -ErrorAction SilentlyContinue
  Add-UserPath $PnpmDir
  Log "  已安装 pnpm $(& $PnpmExe -v) ← $psrc"
}
$env:Path = "$env:APPDATA\npm;$env:Path"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die 'node 仍不可用，请检查环境' }
$PnpmCmd = Get-Command pnpm.cmd, pnpm.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $PnpmCmd) { Die 'pnpm 仍不可用：请重开终端让 PATH 生效后重跑' }
Log ("  node $(& node -v) / pnpm $(& $PnpmCmd.Source -v)")

# ===== [3/6] DSH Desktop（网关镜像优先，公网只作兜底） =====
# 版本、包地址、sha256 全部来自网关的 releases.json —— 脚本里不写死任何版本号或校验值。
# 网关已把包拉到内网：这一跳走局域网，几百 MB 几秒完事，也不吃 GitHub 限流。
Log '[3/6] DSH Desktop 版本检查'
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { Die '当前仅提供 x64 安装包，ARM64 机器请联系 IT' }
$targetVer = ''; $setupUrl = ''; $setupSha = ''; $src = '企业网关'; $allowFallback = $true
try {
  $rel = Invoke-RestMethod "$GatewayUrl/setup/releases.json" -TimeoutSec 15 -UserAgent 'dsh-setup'
  if ($rel.allowUpstreamFallback -eq $false) { $allowFallback = $false }
  if ($rel.version -and $rel.win -and $rel.win.path) {
    $targetVer = $rel.version
    $setupUrl  = "$GatewayUrl$($rel.win.path)"
    $setupSha  = if ($rel.win.sha256) { [string]$rel.win.sha256 } else { '' }
    if (-not $setupSha) { Log '  注意：网关未提供该包的 sha256，跳过校验' }
  }
} catch { Log '  读取 releases.json 失败（网关可能是旧版本，或尚未同步安装包）' }
if (-not $setupUrl) {
  if (-not $allowFallback) { Die '网关上没有 Windows 安装包，且企业策略已禁止回退公网，请联系 IT 在「桌面客户端」页同步并发布' }
  Log '  网关暂无 Windows 包，回退公网下载源'
  try {
    $r = Invoke-RestMethod 'https://api.github.com/repos/anywhere-labs/dsh-desktop/releases/latest' -TimeoutSec 30 -UserAgent 'dsh-setup'
    $asset = @($r.assets | Where-Object { $_.name -like '*-x64-Setup.exe' })[0]
    if ($asset) {
      $src = 'GitHub'
      $targetVer = $r.tag_name.TrimStart('v')
      $setupUrl = $asset.browser_download_url
      if ($asset.digest) { $setupSha = ($asset.digest -replace '^sha256:','') }
    }
  } catch {}
}
if (-not $setupUrl) {
  # 兜底镜像：版本与 sha256 都由镜像目录动态给出（不再钉死某个版本）
  Log '  GitHub 不可达，降级 ModelScope 镜像'
  try {
    $ms = Invoke-RestMethod 'https://modelscope.cn/api/v1/models/t4wefan/deepseek-harness-desktop/repo/files?Revision=master&Recursive=true' -TimeoutSec 40 -UserAgent 'dsh-setup'
    $best = $null
    foreach ($f in @($ms.Data.Files)) {
      if ($f.Name -notmatch '^DSH-Desktop-(\d+\.\d+\.\d+)-x64-Setup\.exe$') { continue }
      $ver = $Matches[1]
      $v = [version]$ver
      if (-not $best -or $v -gt $best.v) { $best = [pscustomobject]@{ v = $v; ver = $ver; name = $f.Name; sha = $f.Sha256 } }
    }
    if ($best) {
      $src = 'ModelScope 镜像'
      $targetVer = $best.ver
      $setupUrl = 'https://modelscope.cn/models/t4wefan/deepseek-harness-desktop/resolve/master/' + [uri]::EscapeDataString($best.name)
      if ($best.sha) { $setupSha = [string]$best.sha }
    }
  } catch {}
}
if (-not $setupUrl) { Die '三个下载源都拿不到 Windows 安装包，请检查网络，或让 IT 在网关「桌面客户端」页同步后重试' }
$curVer = ''
if (Test-Path $Exe) {
  $curVer = ((Get-Item $Exe).VersionInfo.ProductVersion -split '\.')[0..2] -join '.'
}
$appPkg = Join-Path $AppDir 'resources\app\package.json'
if (Test-Path $appPkg) {
  try {
    $appVer = (Get-Content $appPkg -Raw | ConvertFrom-Json).version
    if ($appVer) { $curVer = $appVer }
  } catch {}
}
$needInstall = $true
if ($curVer -eq $targetVer) { $needInstall = $false }
if ($needInstall) {
  Log "  已装: $curVer / 目标: $targetVer（来源: $src）"
  Log "  下载并安装 $targetVer（来源 $src，约 150MB，请耐心等待）..."
  Get-Process 'DSH Desktop' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep 3
  $setup = Join-Path $env:TEMP "DSH-Desktop-$targetVer-x64-Setup.exe"
  $dl = $false
  if ($env:DSH_SETUP_MIRROR) {
    try { Get-RemoteFile "$($env:DSH_SETUP_MIRROR.TrimEnd('/'))/DSH-Desktop-$targetVer-x64-Setup.exe" $setup; $dl = $true } catch {}
  }
  if (-not $dl) {
    Get-RemoteFile $setupUrl $setup
  }
  if ($setupSha) {
    $got = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLower()
    if ($got -ne $setupSha.ToLower()) { Die '安装包 sha256 校验失败（包不完整或被篡改）' }
  }
  Log '  静默安装中...'
  Start-Process -FilePath $setup -ArgumentList '/S' -Wait
  Start-Sleep 2
  if (-not (Test-Path $Exe)) { Die '安装后未找到 DSH Desktop.exe，请手动运行安装包后重跑本脚本' }
  Remove-Item $setup -Force -ErrorAction SilentlyContinue
  Log "  已安装 $targetVer"
} else {
  Log '  版本已是最新，跳过'
}

# ===== [4/6] 企业插件 =====
Log '[4/6] 安装企业插件 dsh-enterprise'
$shimDir = Join-Path $env:USERPROFILE '.local\bin'
New-Item -ItemType Directory -Path $shimDir -Force | Out-Null
# 2.0.11 起 Windows 包为解包 resources\app 目录（无 app.asar）；旧版是 app.asar。按实际存在选入口
$cliEntry = "$AppDir\resources\app\lib\desktop-cli.js"
if (-not (Test-Path $cliEntry)) { $cliEntry = "$AppDir\resources\app.asar\lib\desktop-cli.js" }
$shim = "@echo off`r`nset `"ELECTRON_RUN_AS_NODE=1`"`r`nset `"DSH_HOME=%USERPROFILE%\.dsh`"`r`n`"%LOCALAPPDATA%\Programs\DSH Desktop\DSH Desktop.exe`" --expose-internals `"$cliEntry`" %*`r`n"
[IO.File]::WriteAllText((Join-Path $shimDir 'dsh.cmd'), $shim, [Text.Encoding]::ASCII)
Add-UserPath $shimDir

New-Item -ItemType Directory -Path $ProfileD -Force | Out-Null
$pkgPath = Join-Path $ProfileD 'package.json'
if (-not (Test-Path $pkgPath)) {
  [IO.File]::WriteAllText($pkgPath, '{"name":"dsh-profile-desktop","private":true,"dependencies":{},"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"],"patchReload":"live"}}}')
}
$cordis = Join-Path $ProfileD 'cordis.yml'
if (-not (Test-Path $cordis)) { [IO.File]::WriteAllText($cordis, "[]`n") }
$patch = Join-Path $ProfileD 'cordis.patch.yml'
if (-not (Test-Path $patch)) { [IO.File]::WriteAllText($patch, "[]`n") }

Push-Location $ProfileD
$env:CI = 'true'
# 优先从企业网关插件仓库拉包（/plugin-packages/ 默认版本），官方 npm 源兜底
$entTgz = Join-Path $DshHome 'enterprise\dsh-enterprise.tgz'
New-Item -ItemType Directory -Path (Split-Path $entTgz) -Force | Out-Null
$fromGw = $false
try { Get-RemoteFile "$GatewayUrl/plugin-packages/dsh-enterprise" $entTgz; $fromGw = $true } catch {}
if ($fromGw) {
  Log '  从企业网关插件仓库安装'
  & pnpm.cmd add "file:$entTgz"
  $rc = $LASTEXITCODE
} else {
  Log "  网关仓库不可达，回退官方 npm 源: dsh-enterprise@$PluginVersion"
  & pnpm.cmd add "dsh-enterprise@$PluginVersion" --registry=$Registry
  $rc = $LASTEXITCODE
}
Remove-Item Env:CI -ErrorAction SilentlyContinue
Pop-Location
if ($rc -ne 0) { Die "插件安装失败（pnpm add 退出码 $rc），请检查网络后重跑" }
$pluginPkg = Join-Path $ProfileD 'node_modules\dsh-enterprise\package.json'
if (-not (Test-Path $pluginPkg)) { Die '插件安装后未找到实体' }
& node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(!p.dsh.profile.bundles.includes('dsh-enterprise'))p.dsh.profile.bundles.push('dsh-enterprise');fs.writeFileSync(process.argv[1],JSON.stringify(p,null,2)+'\n')" $pkgPath
$pv = & node -e "console.log(require(process.argv[1]).version)" $pluginPkg
Log "  已装: dsh-enterprise@$pv"

# ===== [5/6] 预置（零弹窗 + 增强模式 + 网关预填 + 工作区） =====
Log '[5/6] 预置配置'
$prov = Join-Path $env:TEMP ('dsh-provision-' + [guid]::NewGuid().ToString('N') + '.mjs')
$provJs = @'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
const NOTICE = '2026-08-13.1'
const home = homedir()
const dshHome = join(home, '.dsh')
const profileDir = join(dshHome, 'profiles', 'desktop')
const userData = join(home, 'AppData', 'Roaming', 'DSH Desktop')
const gateway = process.env.ENT_GATEWAY_PRESET || ''
const done = []

// 1. 桌面向导回执 + 桌面模式首选项（宿主启动时读取，必须先于首次启动落盘）
const hash = createHash('sha256').update(profileDir).digest('hex')
const setupDir = join(userData, 'profile-setup', hash)
mkdirSync(setupDir, { recursive: true })
const setupFile = join(setupDir, 'state.json')
if (!existsSync(setupFile)) {
  writeFileSync(setupFile, JSON.stringify({ version: 2, profileHash: hash, outcome: 'skipped',
    desktopVersion: process.env.DSH_DESKTOP_VER || 'unknown', dshVersion: '0.1.5-rc.2', setupRevision: 1,
    recordedAt: new Date().toISOString() }, null, 2))
  done.push('wizard receipt')
}
// 1.4 自愈悬空的 profile 选择：老版脚本/旧测试可能把选择状态指到已不存在的 profile
// （如 "enterprise"）。桌面端启动自愈只兜底 active=desktop 缺失或零 profile 两种情况，
// 悬空名会直接抛错进恢复模式。选择指向的 profile 目录不存在时，直接纠正为 desktop。
const selDir = join(userData, 'profile-selection')
const selFile = join(selDir, 'state.json')
if (existsSync(join(profileDir, 'package.json'))) {
  let sel = null
  try { sel = JSON.parse(readFileSync(selFile, 'utf8')) } catch {}
  if (sel && sel.active !== 'desktop') {
    const target = join(dshHome, 'profiles', String(sel.active || ''))
    if (!sel.active || !existsSync(join(target, 'package.json'))) {
      mkdirSync(selDir, { recursive: true })
      writeFileSync(selFile, JSON.stringify({ version: 2, active: 'desktop' }, null, 2))
      done.push('profile selection repair: ' + (sel.active || '?') + ' -> desktop')
    }
  }
}
const prefDir = join(userData, 'profile-preferences', hash)
const prefFile = join(prefDir, 'state.json')
if (!existsSync(prefFile)) {
  mkdirSync(prefDir, { recursive: true })
  writeFileSync(prefFile, JSON.stringify({ version: 1, profileHash: hash, mode: 'advanced',
    openBrowser: false, networkExposure: 'loopback',
    notifications: { enabled: true, notifyOnTurnCompletion: true, notifyOnTurnFailure: true,
      notifyOnJobCompletion: true, notifyOnJobFailure: true },
    aaEnabled: false, market: 'disabled', recordedAt: new Date().toISOString() }, null, 2))
  done.push('profile mode=advanced')
} else {
  let j = null
  try { j = JSON.parse(readFileSync(prefFile, 'utf8')) } catch {}
  if (j && j.mode === 'compatibility') {
    j.mode = 'advanced'
    writeFileSync(prefFile, JSON.stringify(j, null, 2))
    done.push('profile mode compatibility->advanced')
  }
}

// 2. profile settings.yaml（不存在则预建骨架：横幅回执 + deepseek 屏蔽）
const sFile = join(profileDir, 'settings.yaml')
if (!existsSync(sFile)) {
  writeFileSync(sFile, 'ui-onboarding:\n  welcomeNoticeVersion: ' + NOTICE + '\nllm-deepseek:\n  models: []\n')
  done.push('settings skeleton')
} else {
  let t = readFileSync(sFile, 'utf8')
  if (!/^ui-onboarding:/m.test(t)) {
    t += '\nui-onboarding:\n  welcomeNoticeVersion: ' + NOTICE + '\n'
    writeFileSync(sFile, t)
    done.push('settings: notice receipt')
  }
}

// 3. 默认工作区（win 候选 D:\dsh-workspace -> C:\dsh-workspace）
let wsDir = null
for (const d of ['D:\\dsh-workspace', 'C:\\dsh-workspace']) {
  try { mkdirSync(d, { recursive: true }); wsDir = d; break } catch {}
}
const wpFile = join(dshHome, 'storages', 'workspace.json')
if (wsDir && !existsSync(wpFile)) {
  const id = randomUUID(); const now = new Date().toISOString()
  mkdirSync(join(dshHome, 'storages'), { recursive: true })
  writeFileSync(wpFile, JSON.stringify({ unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [id], archivedSessionIds: [] },
    tables: { workspaces: { [id]: { path: wsDir, title: 'dsh-workspace', sessionIds: [],
      createdAt: now, updatedAt: now } } } }, null, 2))
  done.push('workspace ' + wsDir)
}

// 4. 网关预填（enterprise-state.json 主 + gateway-url.txt 兜底）
if (gateway) {
  const entDir = join(dshHome, 'enterprise')
  mkdirSync(entDir, { recursive: true })
  const stFile = join(entDir, 'enterprise-state.json')
  let st = {}
  try { st = JSON.parse(readFileSync(stFile, 'utf8')) ?? {} } catch {}
  if ((st.user == null) && !st.gateway) {
    writeFileSync(stFile, JSON.stringify({ ...st, gateway }, null, 2))
    done.push('gateway prefill ' + gateway)
  }
  writeFileSync(join(entDir, 'gateway-url.txt'), gateway + '\n')
}

// 5. 凭证文件预创建（首次登录写入前必须存在）
const cred = join(dshHome, '.credentials.yaml')
if (!existsSync(cred)) { writeFileSync(cred, '') }

// 6. 历史直连 provider 清理：先整份备份 settings.yaml，再只保留企业网关（ent-gateway）
{
  const mainSettings = join(dshHome, 'settings.yaml')
  if (existsSync(mainSettings)) {
    const orig = readFileSync(mainSettings, 'utf8')
    const entDir2 = join(dshHome, 'enterprise')
    mkdirSync(entDir2, { recursive: true })
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const bakFile = join(entDir2, 'settings-backup-' + ts + '.yaml')
    writeFileSync(bakFile, orig)
    const lines = orig.split('\n')
    // 先探测 agent-default-model 指向：指向 ent-gateway 的有效默认模型不动，指向遗留 provider 才清
    let admProvider = ''
    for (const line0 of lines) {
      const line = line0.replace(/\r$/, '')
      if (/^\S/.test(line) && admProvider) break
      const mp = line.match(/^ {2}provider:\s*(\S+)/)
      if (mp) { admProvider = mp[1]; break }
    }
    const admIsLegacy = admProvider !== '' && admProvider !== 'ent-gateway'
    const out = []
    let top = '', sub = '', prov = '', agentDrop = false, removed = false
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '')
      if (/^\S/.test(line)) {
        top = (line.match(/^([^:]+):/) ?? ['', ''])[1].trim()
        sub = ''; prov = ''
        if (admIsLegacy && top === 'agent-default-model') { agentDrop = true; removed = true; continue }
        agentDrop = false
        out.push(raw); continue
      }
      if (agentDrop) continue
      const m2 = line.match(/^ {2}([^:\s]+):/)
      if (m2) { sub = m2[1]; prov = '' }
      const m4 = line.match(/^ {4}([^:\s]+):/)
      if (m4) prov = m4[1]
      if (/^llm-/.test(top) && sub === 'providers' && prov && prov !== 'ent-gateway') { removed = true; continue }
      out.push(raw)
    }
    if (removed) {
      // 空段二次清理：providers: 清空后移除悬空键，llm-* 段空了连头一起移除
      let o = out
      for (let pass = 0; pass < 2; pass++) {
        const o2 = []
        for (let i = 0; i < o.length; i++) {
          const l = o[i]
          const next = o[i + 1] ?? ''
          const nextIsEmpty = next === '' || next == null
          if (pass === 0 && /^ {2}providers:\s*$/.test(l) && (nextIsEmpty || /^\S/.test(next) || /^ {2}\S/.test(next))) continue
          if (pass === 1 && /^llm-[\w.-]+:\s*$/.test(l) && (nextIsEmpty || /^\S/.test(next))) continue
          o2.push(l)
        }
        o = o2
      }
      writeFileSync(mainSettings, o.join('\n'))
      done.push('legacy providers cleaned (backup: settings-backup-' + ts + '.yaml)')
    }
  }
}

console.log('  provisioned: ' + (done.join(', ') || 'nothing to do'))
'@
[IO.File]::WriteAllText($prov, $provJs, (New-Object Text.UTF8Encoding($false)))
$env:ENT_GATEWAY_PRESET = $GatewayUrl
$env:DSH_DESKTOP_VER = $targetVer
& node $prov
$rc = $LASTEXITCODE
Remove-Item Env:ENT_GATEWAY_PRESET -ErrorAction SilentlyContinue
Remove-Item Env:DSH_DESKTOP_VER -ErrorAction SilentlyContinue
Remove-Item $prov -Force -ErrorAction SilentlyContinue
if ($rc -ne 0) { Die '预置失败，请把上方报错发给 IT' }

# ===== [6/6] 启动 =====
Log '[6/6] 启动 DSH Desktop'
# 走 WMI 起进程（父进程是系统服务 WmiPrvSE）：Windows Terminal / 新式 conhost 关窗口时
# 会清扫整个进程树，Start-Process 直接挂在本次 PowerShell 树下的应用会被连带关掉；
# WMI 创建的进程不进本控制台的作业对象，关掉这个 PS 窗口应用不受影响。失败回退 Start-Process。
$launched = $false
try {
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '"' + $Exe + '"' } -ErrorAction Stop
  if ($r.ReturnValue -eq 0) { $launched = $true }
} catch {}
if (-not $launched) { Start-Process -FilePath $Exe }
Log '完成！应用已打开，输入企业账号密码即可使用。'
