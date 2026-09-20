# DSH 企业客户端 · Windows 一键安装（PowerShell 5.1+ 兼容，用户级安装无需管理员）
# 流程: 装 Node/pnpm → 装 DSH Desktop 最新版 → dsh CLI shim → 装企业插件 → 预置(零弹窗/增强模式/网关预填/工作区) → 启动落在登录页
# 托管: 网关自带接入页 http://<网关>:8899/setup 下发本脚本，__GATEWAY_URL__ 占位符按请求来源自动替换
# 用法（在 PowerShell 中执行）:
#   & ([scriptblock]::Create((irm http://<网关>:8899/setup/windows-setup.ps1)))
#   或下载后: powershell -ExecutionPolicy Bypass -File .\windows-setup.ps1 -GatewayUrl http://<网关>:8899
# 可选环境变量 DSH_SETUP_MIRROR: 安装包镜像前缀（如内网/镜像站），形如 https://mirror.example.com/dsh
param(
  [string]$GatewayUrl = '__GATEWAY_URL__',
  [string]$PluginVersion = '0.9.10',
  [string]$Registry = 'https://registry.npmjs.org/'
)
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

# ===== [1/6] Node + pnpm =====
Log '[1/6] 检查 Node 与 pnpm'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Log '  未检测到 Node，安装便携版 Node 22（用户目录，无需管理员）'
  $nodeDir = Join-Path $env:LOCALAPPDATA 'Programs\nodejs'
  $rel = $null; $distBase = ''
  foreach ($m in $Mirrors) {
    try {
      $idx = Invoke-RestMethod "$m/index.json" -TimeoutSec 30 -UserAgent 'dsh-setup'
      $rel = @($idx | Where-Object { $_.version -like 'v22.*' })[0]
      if ($rel) { $distBase = $m; break }
    } catch {}
  }
  if (-not $rel) { Die '无法获取 Node 版本列表（官方源与镜像均不可达），请检查网络后重跑' }
  $ver = $rel.version
  $zipName = "node-$ver-win-x64.zip"
  $zip = Join-Path $env:TEMP $zipName
  $dl = $false
  foreach ($m in $Mirrors) {
    try { Invoke-WebRequest "$m/$ver/$zipName" -OutFile $zip -TimeoutSec 1800 -UserAgent 'dsh-setup'; $dl = $true; break } catch {}
  }
  if (-not $dl) { Die 'Node 下载失败，请检查网络后重跑' }
  $sums = $null
  foreach ($m in $Mirrors) { try { $sums = (Invoke-WebRequest "$m/$ver/SHASUMS256.txt" -TimeoutSec 60 -UserAgent 'dsh-setup').Content; break } catch {} }
  if ($sums) {
    $line = @($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($zipName) })[0]
    if ($line) {
      $want = ($line.Trim() -split '\s+')[0]
      $got  = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
      if ($want -ne $got) { Die 'Node 压缩包 sha256 校验失败' }
    }
  }
  $tmpX = Join-Path $env:TEMP ('node-x-' + [guid]::NewGuid().ToString('N'))
  Expand-Archive $zip -DestinationPath $tmpX -Force
  if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
  Move-Item (Join-Path $tmpX $zipName.Replace('.zip','')) $nodeDir
  Remove-Item $tmpX -Recurse -Force
  Remove-Item $zip -Force
  Add-UserPath $nodeDir
  Log "  node $(& node -v) 已装（$nodeDir）"
}
$env:Path = "$env:APPDATA\npm;$env:Path"
if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) {
  Log '  安装 pnpm（走官方 npm 源）'
  & npm.cmd install -g pnpm --registry=$Registry
  if ($LASTEXITCODE -ne 0) { Die 'pnpm 安装失败，请检查网络后重跑' }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die 'node 仍不可用，请检查环境' }
Log ("  node $(& node -v) / pnpm $(& pnpm.cmd -v)")

# ===== [2/6] DSH Desktop（动态最新版，已装一致跳过） =====
Log '[2/6] DSH Desktop 版本检查'
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { Die '当前仅提供 x64 安装包，ARM64 机器请联系 IT' }
$tag = $null; $setupUrl = ''; $setupSha = ''
try {
  $r = Invoke-RestMethod 'https://api.github.com/repos/anywhere-labs/dsh-desktop/releases/latest' -TimeoutSec 30 -UserAgent 'dsh-setup'
  $asset = @($r.assets | Where-Object { $_.name -like '*-x64-Setup.exe' })[0]
  if ($asset) {
    $tag = $r.tag_name
    $setupUrl = $asset.browser_download_url
    if ($asset.digest) { $setupSha = ($asset.digest -replace '^sha256:','').ToLower() }
  }
} catch {}
if (-not $setupUrl) {
  Log '  GitHub API 不可达，降级固定版本 2.0.11'
  $tag = 'v2.0.11'
  $setupUrl = 'https://github.com/anywhere-labs/dsh-desktop/releases/download/v2.0.11/DSH-Desktop-2.0.11-x64-Setup.exe'
  $setupSha = 'e758d6cb70f33c748f14c9f66f40d93be8fdc661deba6bbfcf02b4d5ccd723f7'
}
$targetVer = $tag.TrimStart('v')
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
  Log "  已装: $curVer / 最新: $targetVer"
  Log "  下载并安装 $targetVer（约 150MB，请耐心等待）..."
  Get-Process 'DSH Desktop' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep 3
  $setup = Join-Path $env:TEMP "DSH-Desktop-$targetVer-x64-Setup.exe"
  $dl = $false
  if ($env:DSH_SETUP_MIRROR) {
    try { Invoke-WebRequest "$($env:DSH_SETUP_MIRROR.TrimEnd('/'))/DSH-Desktop-$targetVer-x64-Setup.exe" -OutFile $setup -TimeoutSec 1800 -UserAgent 'dsh-setup'; $dl = $true } catch {}
  }
  if (-not $dl) {
    Invoke-WebRequest $setupUrl -OutFile $setup -TimeoutSec 1800 -UserAgent 'dsh-setup'
  }
  if ($setupSha) {
    $got = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLower()
    if ($got -ne $setupSha) { Die '安装包 sha256 校验失败' }
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

# ===== [3/6] 网关地址 =====
Log '[3/6] 网关地址'
# 非 URL 格式（含未替换的源码占位符）才清空转交互；网关注入的真实地址直接使用
if ($GatewayUrl -notmatch '^https?://') { $GatewayUrl = '' }
if (-not $GatewayUrl -and [Environment]::UserInteractive) {
  try { $GatewayUrl = Read-Host '企业网关地址（回车 = 默认 http://127.0.0.1:8899）' } catch {}
}
if (-not $GatewayUrl) { $GatewayUrl = 'http://127.0.0.1:8899' }
$GatewayUrl = $GatewayUrl.Trim().TrimEnd('/')
if ($GatewayUrl -notmatch '^https?://') { $GatewayUrl = "http://$GatewayUrl" }
Log "  使用: $GatewayUrl"

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
try { Invoke-WebRequest "$GatewayUrl/plugin-packages/dsh-enterprise" -OutFile $entTgz -TimeoutSec 120 -UserAgent 'dsh-setup'; $fromGw = $true } catch {}
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
    desktopVersion: '2.0.11', dshVersion: '0.1.5-rc.2', setupRevision: 1,
    recordedAt: new Date().toISOString() }, null, 2))
  done.push('wizard receipt')
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
& node $prov
$rc = $LASTEXITCODE
Remove-Item Env:ENT_GATEWAY_PRESET -ErrorAction SilentlyContinue
Remove-Item $prov -Force -ErrorAction SilentlyContinue
if ($rc -ne 0) { Die '预置失败，请把上方报错发给 IT' }

# ===== [6/6] 启动 =====
Log '[6/6] 启动 DSH Desktop'
Start-Process -FilePath $Exe
Log '完成！应用已打开，输入企业账号密码即可使用。'
