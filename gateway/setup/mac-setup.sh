#!/bin/bash
# DSH 企业客户端 · Mac 一键安装（curl | bash 直跑版）
# 托管: 网关自带接入页 http://<网关>:8899/setup 下发本脚本，__GATEWAY_URL__ 占位符按请求来源自动替换
# 流程: 网关地址 → 装 Node/pnpm(网关镜像优先) → 装桌面(网关镜像优先) → 装企业插件 → 预置(零弹窗/增项模式/网关预填/工作空间) → 启动落在登录页
# 来源优先级：企业网关已发布物料（releases.json / env.json，均含 sha256）> 官方源与国内镜像
# 纯内网可用前提：网关「桌面客户端」页把安装包 + 环境物料都同步并发布，并在需要时关闭公网回退
# 用法:
#   curl -fsSL http://<网关>:8899/setup/mac-setup.sh | bash
#   curl -fsSL <脚本URL> | bash -s -- 10.102.101.42:8890   # 显式覆盖网关地址
set -uo pipefail

# PATH 前置：非交互 shell（SSH/管道）不含用户目录与 Homebrew 路径，必须先补再检测 node
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

log(){ echo "[dsh-enterprise] $*"; }
die(){ echo "[dsh-enterprise][FATAL] $*" >&2; exit 1; }
trap 'echo "[dsh-enterprise][FATAL] 第 ${LINENO} 行执行失败，已中止（重跑本脚本即可继续）" >&2' ERR

# ===== 参数与工具检查 =====
GW_URL="${1:-__GATEWAY_URL__}"
# 非 URL 格式（含未替换的源码占位符）才清空转交互；网关注入的真实地址直接使用
case "$GW_URL" in http://*|https://*) ;; *) GW_URL="" ;; esac
DEFAULT_GW="http://127.0.0.1:8899"
# 企业插件版本：留空 = 跟随网关插件仓库（或官方源）的当前版；只有临时锁版才需要设这个变量
PLUGIN_VER="${DSH_ENTERPRISE_PLUGIN_VERSION:-}"
APP='/Applications/DSH Desktop.app'

command -v curl >/dev/null || die '需要 curl'
command -v python3 >/dev/null || die '需要 python3（macOS 自带）'

# ===== [1/6] 网关地址（放在最前：后面每一步都从网关取东西，包括 Node 本体） =====
log '[1/6] 网关地址'
if [ -z "$GW_URL" ] && [ -t 0 ]; then
  printf '企业网关地址（回车 = 默认 %s）: ' "$DEFAULT_GW"
  read GW_URL || true
fi
GW_URL="${GW_URL:-$DEFAULT_GW}"
GW_URL="${GW_URL%/}"
case "$GW_URL" in http://*|https://*) ;; *) GW_URL="http://$GW_URL" ;; esac
log "  使用: $GW_URL"

# ===== [2/6] Node 与 pnpm（缺什么补什么，企业网关镜像优先，公网只作兜底） =====
# 这一步原先是「没 Homebrew 就现装 Homebrew，再 brew install node + npm i -g pnpm」：
# 要交互、要公网、全局装还可能要 sudo —— 纯内网直接卡死。
# 现在按官方 tarball 装进用户目录（~/.local/share），命令软链到 ~/.local/bin：
# 无 root、无交互、无 brew，且校验值与官方 SHASUMS 一致。已装好的机器一律沿用现成的。
log '[2/6] Node 与 pnpm'
BIN_DIR="$HOME/.local/bin"
SHARE_DIR="$HOME/.local/share"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/dsh-env.XXXXXX")"
trap 'rm -rf "${TMP_DIR:-}" 2>/dev/null || true' EXIT   # 中途失败也别把几十 MB 的包留在 /tmp
mkdir -p "$BIN_DIR" "$SHARE_DIR"
case "$(uname -m)" in
  arm64|arm) NODE_PLAT='mac-arm64'; NODE_ARCH_TAG='arm64' ;;
  x86_64) NODE_PLAT='mac-x64'; NODE_ARCH_TAG='x64' ;;
  *) die "不支持的 CPU 架构：$(uname -m)" ;;
esac
# pnpm 12 起主 npm 包不再自带运行时：install.js 用 optionalDependencies 的 @pnpm/exe.<平台>
# 顶掉占位 bin，顶不到就首次运行时去 get.pnpm.io / registry.npmjs.org 下载 —— 纯内网两头都不通。
# 所以这里取的是官方原生包，解出来直接就是可执行文件（不依赖 Node，也不用 npm i -g）。
case "$NODE_PLAT" in
  mac-arm64) PNPM_PKG='exe.darwin-arm64' ;;
  *) PNPM_PKG='exe.darwin-x64' ;;
esac

verify_sha(){ # $1=文件 $2=期望 sha256（空 = 上游没给，如实提示后放行）
  if [ -z "${2:-}" ]; then log "  注意：$1 没有可用校验值，跳过校验"; return 0; fi
  echo "$2  $1" | shasum -a 256 -c - >/dev/null || die "$(basename "$1") 校验失败（包不完整或被篡改）"
}
# 企业插件要求 ^22.19.0 || >=24.0.0；低于此的 node 装了也白装，直接补一个新的
node_ok(){ command -v node >/dev/null 2>&1   && node -e 'const [M,m]=process.versions.node.split(".").map(Number);process.exit((M===22&&m>=19)||M>=24?0:1)' 2>/dev/null; }

# 环境物料事实源：/setup/env.json（版本、路径、sha256 全由网关给，脚本里不写死）
# 取不到 = 空对象，后面自动降级为公网兜底；ENV_FALLBACK=0 表示企业策略禁止出网
ENV_JSON=$(curl -fsSL --max-time 10 "$GW_URL/setup/env.json" 2>/dev/null || true)
NODE_PATH=''; NODE_SHA=''; NODE_VER=''; PNPM_PATH=''; PNPM_SHA=''; PNPM_VER=''; ENV_FALLBACK=1
if [ -n "$ENV_JSON" ]; then
  # 一次取全部字段：空格分隔的 read 会让空字段塌陷，必须 shlex 引好再 eval
  eval "$(printf '%s' "$ENV_JSON" | python3 -c '
import json, shlex, sys
try:
    e = json.load(sys.stdin)
except Exception:
    e = {}
plat = sys.argv[1]
node = e.get("node") or {}
pnpm = e.get("pnpm") or {}
mine = (node.get("files") or {}).get(plat) or {}
mine_p = (pnpm.get("files") or {}).get(plat) or {}
vals = {
    "NODE_PATH": mine.get("path") or "",
    "NODE_SHA": mine.get("sha256") or "",
    "NODE_VER": node.get("version") or "",
    "PNPM_PATH": mine_p.get("path") or "",
    "PNPM_SHA": mine_p.get("sha256") or "",
    "PNPM_VER": pnpm.get("version") or "",
    "ENV_FALLBACK": "1" if e.get("allowUpstreamFallback", True) else "0",
}
print(";".join("%s=%s" % (k, shlex.quote(str(v))) for k, v in vals.items()))
' "$NODE_PLAT" 2>/dev/null)" || true
fi

# ---- Node ----
if node_ok; then
  log "  已检测到可用的 Node $(node -v)，沿用"
else
  NODE_TGZ="$TMP_DIR/node.tar.gz"
  NODE_SRC=''
  if [ -n "$NODE_PATH" ]; then
    log "  本机没有可用 Node，从企业网关取 Node ${NODE_VER}（${NODE_PLAT}）"
    if curl -L --fail --silent --show-error -C - --max-time 900 -o "$NODE_TGZ" "$GW_URL$NODE_PATH"; then
      verify_sha "$NODE_TGZ" "$NODE_SHA" && NODE_SRC="企业网关 ${NODE_VER}"
    else
      log '  网关上没有本机架构的 Node 构建（或下载失败）'
      rm -f "$NODE_TGZ"
    fi
  fi
  if [ -z "$NODE_SRC" ]; then
    if [ "$ENV_FALLBACK" = "0" ]; then
      die '企业策略已禁止回退公网，且网关上没有本机可用的 Node。请让 IT 在「桌面客户端 → 环境物料」同步并发布 Node LTS'
    fi
    log '  回退公网取 Node LTS（版本动态探测，不写死）'
    # 镜像在前：国内出口直连 nodejs.org 常慢；两处都用 SHASUMS256.txt 校验后才安装
    for base in https://npmmirror.com/mirrors/node https://nodejs.org/dist; do
      NV=$(curl -fsSL --max-time 20 "$base/index.json" 2>/dev/null | python3 -c '
import json, sys
try:
    rows = json.load(sys.stdin)
except Exception:
    rows = []
for r in rows:
    if r.get("lts"):
        print(str(r.get("version", "")).lstrip("v"))
        break
' 2>/dev/null)
      [ -z "$NV" ] && continue
      F="node-v$NV-darwin-$NODE_ARCH_TAG.tar.gz"
      SHA=$(curl -fsSL --max-time 20 "$base/v$NV/SHASUMS256.txt" 2>/dev/null | awk -v f="$F" '$2==f{print $1; exit}')
      [ -z "$SHA" ] && continue
      if curl -L --fail --silent --show-error -C - --max-time 900 -o "$NODE_TGZ" "$base/v$NV/$F"; then
        if echo "$SHA  $NODE_TGZ" | shasum -a 256 -c - >/dev/null; then
          NODE_SRC="公网 $base ${NV}"
          break
        fi
        log "  $base 的包校验不过，换下一个源"
        rm -f "$NODE_TGZ"
      fi
    done
  fi
  [ -n "$NODE_SRC" ] || die 'Node 未能安装：网关与公网都没有可用的构建'
  mkdir -p "$SHARE_DIR/nodejs"
  tar -xzf "$NODE_TGZ" -C "$SHARE_DIR/nodejs" || die 'Node 解压失败'
  NODE_HOME_LATEST=$(ls -d "$SHARE_DIR"/nodejs/node-v*/ 2>/dev/null | sort -V | tail -1)
  [ -n "$NODE_HOME_LATEST" ] || die 'Node 解压后找不到目录'
  for b in node npm npx corepack; do
    [ -e "${NODE_HOME_LATEST}bin/$b" ] && ln -sf "${NODE_HOME_LATEST}bin/$b" "$BIN_DIR/$b"
  done
  export PATH="$BIN_DIR:$PATH"
  hash -r 2>/dev/null || true
  node_ok || die 'Node 安装后仍不可用（检查 ~/.local/bin 是否在 PATH）'
  log "  已安装 Node $(node -v) ← ${NODE_SRC}"
  rm -f "$NODE_TGZ"
fi

# ---- pnpm ----
if command -v pnpm >/dev/null 2>&1; then
  log "  已检测到 pnpm $(pnpm -v)，沿用"
else
  PNPM_TGZ="$TMP_DIR/pnpm.tgz"
  PNPM_SRC=''
  if [ -n "$PNPM_PATH" ]; then
    log "  从企业网关取 pnpm ${PNPM_VER}"
    if curl -L --fail --silent --show-error -C - --max-time 300 -o "$PNPM_TGZ" "$GW_URL$PNPM_PATH"; then
      verify_sha "$PNPM_TGZ" "$PNPM_SHA" && PNPM_SRC="企业网关 ${PNPM_VER}"
    else
      rm -f "$PNPM_TGZ"
    fi
  fi
  if [ -z "$PNPM_SRC" ]; then
    [ "$ENV_FALLBACK" = "0" ] && die '企业策略已禁止回退公网，且网关上没有 pnpm。请让 IT 在「桌面客户端 → 环境物料」同步并发布 pnpm'
    log "  回退公网取 pnpm 原生包（${PNPM_PKG}，含 integrity 校验）"
    for reg in https://registry.npmmirror.com https://registry.npmjs.org; do
      # 先问主包要「现在的最新版」，再取该版的原生包；平台包漏发这个版时才退回它自己的 latest
      PV=$(curl -fsSL --max-time 30 "$reg/pnpm/latest" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version",""))' 2>/dev/null)
      META=''
      [ -n "$PV" ] && META=$(curl -fsSL --max-time 30 "$reg/@pnpm%2F$PNPM_PKG/$PV" 2>/dev/null || true)
      [ -z "$META" ] && META=$(curl -fsSL --max-time 30 "$reg/@pnpm%2F$PNPM_PKG/latest" 2>/dev/null || true)
      [ -z "$META" ] && continue
      TARBALL=$(printf '%s' "$META" | python3 -c 'import json,sys; print((json.load(sys.stdin).get("dist") or {}).get("tarball",""))' 2>/dev/null)
      WANT=$(printf '%s' "$META" | python3 -c 'import json,sys; print((json.load(sys.stdin).get("dist") or {}).get("integrity",""))' 2>/dev/null)
      [ -z "$TARBALL" ] && continue
      curl -L --fail --silent --show-error -C - --max-time 300 -o "$PNPM_TGZ" "$TARBALL" || { rm -f "$PNPM_TGZ"; continue; }
      # npm 的 integrity 是 sha512-base64，用它自校验（拿不到就跳过，与网关同口径）
      if [ -n "$WANT" ]; then
        OK=$(python3 - "$PNPM_TGZ" "$WANT" <<'PYCHK'
import base64, hashlib, sys
want = sys.argv[2].split('-', 1)
if len(want) != 2 or want[0] != 'sha512':
    print('skip'); raise SystemExit
got = base64.b64encode(hashlib.sha512(open(sys.argv[1], 'rb').read()).digest()).decode()
print('ok' if got.rstrip('=') == want[1].rstrip('=') else 'bad')
PYCHK
) || OK='bad'
        [ "$OK" = "bad" ] && { log '  pnpm 包 integrity 校验不过，换一个源'; rm -f "$PNPM_TGZ"; continue; }
      fi
      PNPM_SRC="公网 $reg"
      break
    done
  fi
  [ -n "$PNPM_SRC" ] || die 'pnpm 未能安装：网关与公网都没有可用的包'
  # 原生包解出来就是一个可执行文件（npm 包里路径固定是 package/pnpm），不依赖 Node、不用 npm i -g
  rm -rf "$SHARE_DIR/pnpm"
  mkdir -p "$SHARE_DIR/pnpm"
  tar -xzf "$PNPM_TGZ" -C "$SHARE_DIR/pnpm" --strip-components=1 || die 'pnpm 解压失败'
  PNPM_BIN="$SHARE_DIR/pnpm/pnpm"
  [ -f "$SHARE_DIR/pnpm/pnpm.exe" ] && PNPM_BIN="$SHARE_DIR/pnpm/pnpm.exe"
  [ -f "$PNPM_BIN" ] || die 'pnpm 包里找不到可执行文件（不是官方的 @pnpm/exe 包？）'
  chmod +x "$PNPM_BIN"
  ln -sf "$PNPM_BIN" "$BIN_DIR/pnpm"
  export PATH="$BIN_DIR:$PATH"
  hash -r 2>/dev/null || true
  command -v pnpm >/dev/null || die 'pnpm 安装后仍不可用（检查 ~/.local/bin 是否在 PATH）'
  log "  已安装 pnpm $(pnpm -v) ← ${PNPM_SRC}"
  rm -f "$PNPM_TGZ"
fi
rmdir "$TMP_DIR" 2>/dev/null || true
export PATH="$BIN_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
command -v node >/dev/null && command -v pnpm >/dev/null || die 'node/pnpm 仍不可用，请检查环境'
log "  node $(node -v) / pnpm $(pnpm -v)"

# ===== [3/6] DSH Desktop（网关镜像优先，公网只作兜底） =====
# 版本、包地址、sha256 全部来自网关的 releases.json —— 脚本里不再有任何写死的版本号或校验值。
# 网关已经把包拉到内网：这里走局域网，几百 MB 几秒完事，也不吃 GitHub 限流。
log '[3/6] DSH Desktop 版本检查'
TARGET_VER=''; DMG_URL=''; DMG_SHA256=''; SRC='企业网关'
ALLOW_FALLBACK=1
REL=$(curl -fsSL --max-time 10 "$GW_URL/setup/releases.json" 2>/dev/null || true)
if [ -n "$REL" ]; then
  # 四个字段一起取：下发版本 / mac 包路径 / sha256 / 是否允许回退公网。
  # 用 python 生成 shlex 引好的赋值再 eval —— 空格分隔的 read 会把空字段塌陷
  # （网关只镜像了 Windows 包时，「包路径」会吃到回退标志，拼出一个不存在的下载地址）。
  eval "$(printf '%s' "$REL" | python3 -c '
import json, shlex, sys
try:
    r = json.load(sys.stdin)
except Exception:
    r = {}
mac = r.get("mac") or {}
vals = {
    "TARGET_VER": r.get("version") or "",
    "PKG_PATH": mac.get("path") or "",
    "DMG_SHA256": mac.get("sha256") or "",
    "ALLOW_FALLBACK": "1" if r.get("allowUpstreamFallback", True) else "0",
}
print(";".join("%s=%s" % (k, shlex.quote(str(v))) for k, v in vals.items()))
' 2>/dev/null)"
  [ -n "$TARGET_VER" ] && [ -n "$PKG_PATH" ] && DMG_URL="$GW_URL$PKG_PATH"
  if [ -n "$DMG_URL" ] && [ -z "$DMG_SHA256" ]; then
    # 网关上有包但没校验值：不常见（上传包/上游未给摘要），如实告知而不是静默放行
    log '  注意：网关未提供该包的 sha256，跳过校验'
  fi
fi
if [ -z "$DMG_URL" ]; then
  [ "$ALLOW_FALLBACK" = "0" ] && die '网关上没有 macOS 安装包，且企业策略已禁止回退公网，请联系 IT 在「桌面客户端」页同步并发布'
  log '  网关暂无 macOS 包，回退公网下载源'
  API='https://api.github.com/repos/anywhere-labs/dsh-desktop/releases/latest'
  LATEST=$(curl -s --fail --max-time 20 "$API" | python3 -c '
import json, sys
r = json.load(sys.stdin)
tag = r["tag_name"].lstrip("v")
dmg = next((a["browser_download_url"] for a in r["assets"] if a["name"].endswith(".dmg")), "")
digest = next((a.get("digest", "") for a in r["assets"] if a["name"].endswith(".dmg")), "").replace("sha256:", "")
print(tag, dmg, digest, sep="\n")
' 2>/dev/null) || LATEST=''
  if [ -n "$LATEST" ]; then
    SRC='GitHub'
    TARGET_VER=$(echo "$LATEST" | sed -n 1p); DMG_URL=$(echo "$LATEST" | sed -n 2p); DMG_SHA256=$(echo "$LATEST" | sed -n 3p)
  else
    # 兜底镜像：版本列表与 sha256 都由镜像目录动态给出（不再钉死某个版本）
    log '  GitHub 不可达，降级 ModelScope 镜像'
    SRC='ModelScope 镜像'
    MIRROR=$(curl -s --fail --max-time 30 'https://modelscope.cn/api/v1/models/t4wefan/deepseek-harness-desktop/repo/files?Revision=master&Recursive=true' | python3 -c '
import json, re, sys
try:
    files = json.load(sys.stdin)["Data"]["Files"]
except Exception:
    raise SystemExit(0)
best = None
for f in files:
    name = f.get("Name", "")
    m = re.fullmatch(r"DSH Desktop-(\d+\.\d+\.\d+)-universal\.dmg", name)
    if not m:
        continue
    key = tuple(int(x) for x in m.group(1).split("."))
    if best is None or key > best[0]:
        best = (key, m.group(1), name, (f.get("Sha256") or "").lower())
if best:
    from urllib.parse import quote
    print(best[1]); print("https://modelscope.cn/models/t4wefan/deepseek-harness-desktop/resolve/master/" + quote(best[2]))
    print(best[3])
' 2>/dev/null) || MIRROR=''
    if [ -n "$MIRROR" ]; then
      TARGET_VER=$(echo "$MIRROR" | sed -n 1p); DMG_URL=$(echo "$MIRROR" | sed -n 2p); DMG_SHA256=$(echo "$MIRROR" | sed -n 3p)
    else
      die '三个下载源都拿不到 macOS 安装包，请检查网络或让 IT 在网关上同步后重试'
    fi
  fi
fi
NEED_INSTALL=1
if [ -d "$APP" ]; then
  CUR_VER=$(python3 -c 'import json; print(json.load(open("'"$APP"'/Contents/Resources/app/package.json"))["version"])' 2>/dev/null || echo unknown)
  log "  已装: $CUR_VER / 目标: ${TARGET_VER}（来源: ${SRC}）"
  [ "$CUR_VER" = "$TARGET_VER" ] && NEED_INSTALL=0
fi
if [ "$NEED_INSTALL" = "1" ]; then
  log "  下载并安装 ${TARGET_VER}（来源 ${SRC}，约 270MB，请耐心等待）..."
  osascript -e 'quit app "DSH Desktop"' >/dev/null 2>&1 || true
  sleep 3; pkill -f 'MacOS/DSH Desktop' >/dev/null 2>&1 || true; sleep 2
  # -C -：同一台机器重跑脚本时从断点接着下，不必把几百 MB 再下一遍
  curl -L --fail --silent --show-error -C - -o /tmp/dsh-desktop.dmg "$DMG_URL" || die 'dmg 下载失败'
  if [ -n "$DMG_SHA256" ]; then
    echo "$DMG_SHA256  /tmp/dsh-desktop.dmg" | shasum -a 256 -c - >/dev/null || die 'dmg sha256 校验失败（包不完整或被篡改）'
  fi
  MNT=$(hdiutil attach /tmp/dsh-desktop.dmg -nobrowse | awk -F'\t' '/Volumes/{print $NF}' | tail -1)
  rm -rf "$APP"
  ditto "$MNT/DSH Desktop.app" "$APP" || die 'app 拷贝失败'
  hdiutil detach "$MNT" >/dev/null 2>&1 || true
  rm -f /tmp/dsh-desktop.dmg
  xattr -dr com.apple.quarantine "$APP" >/dev/null 2>&1 || true
  log "  已安装 $TARGET_VER"
else
  log '  版本已是最新，跳过'
fi

# ===== [4/6] 企业插件 =====
log '[4/6] 安装企业插件 dsh-enterprise'
mkdir -p ~/.local/bin
cat > ~/.local/bin/dsh <<'EOF'
#!/bin/zsh
export ELECTRON_RUN_AS_NODE=1
export DSH_HOME="$HOME/.dsh"
exec '/Applications/DSH Desktop.app/Contents/MacOS/DSH Desktop' --expose-internals '/Applications/DSH Desktop.app/Contents/Resources/app/lib/desktop-cli.js' "$@"
EOF
chmod +x ~/.local/bin/dsh
grep -q '.local/bin' ~/.zshrc 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc

P="$HOME/.dsh/profiles/desktop"
mkdir -p "$P"
[ -f "$P/package.json" ] || cat > "$P/package.json" <<'EOF'
{
  "name": "dsh-profile-desktop",
  "private": true,
  "dependencies": {},
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"], "patchReload": "live" } }
}
EOF
[ -f "$P/cordis.patch.yml" ] || printf '[]\n' > "$P/cordis.patch.yml"
[ -f "$P/cordis.yml" ] || printf '[]\n' > "$P/cordis.yml"
cd "$P"
# 优先从企业网关插件仓库拉包（url 模式 /plugin-packages/），官方 npm 源兜底
ENT_TGZ="$HOME/.dsh/enterprise/dsh-enterprise.tgz"
ENT_SPEC="dsh-enterprise${PLUGIN_VER:+@$PLUGIN_VER}"
mkdir -p "$HOME/.dsh/enterprise"
# 与桌面应用统一 pnpm：应用启动迁移用它自带的 pnpm（app 包内 node_modules/pnpm），
# 脚本用其它大版本会把 profile 的 node_modules store 踩出 ERR_PNPM_UNEXPECTED_STORE。
# 应用在场直接用自带 pnpm；不在场退回系统 pnpm，store 不一致仍由下方自愈兜底
APP_PNPM="$APP/Contents/Resources/app/node_modules/pnpm/bin/pnpm.mjs"
if [ -f "$APP_PNPM" ]; then
  PNPM_CMD=(node "$APP_PNPM")
else
  PNPM_CMD=(pnpm)
fi
# 机器上若有别的 pnpm 大版本装过这个 node_modules（store 路径记在 .modules.yaml），
# pnpm 会拒装 ERR_PNPM_UNEXPECTED_STORE —— 按其官方指引清掉重装，一次自愈
add_plugin() {
  local out
  out=$("${PNPM_CMD[@]}" add "$@" 2>&1) && return 0
  if printf '%s' "$out" | grep -q 'ERR_PNPM_UNEXPECTED_STORE'; then
    log '  检测到 node_modules 与当前 pnpm 的 store 不一致（机器上切换过 pnpm 大版本），清空重装'
    rm -rf node_modules
    out=$("${PNPM_CMD[@]}" add "$@" 2>&1) && return 0
  fi
  printf '%s\n' "$out" >&2
  return 1
}
if curl -fsSL --max-time 120 -o "$ENT_TGZ" "$GW_URL/plugin-packages/dsh-enterprise"; then
  log '  从企业网关插件仓库安装'
  add_plugin "file:$ENT_TGZ" || die '插件安装失败'
else
  log '  网关仓库不可达，回退官方 npm 源'
  add_plugin "$ENT_SPEC" --registry=https://registry.npmjs.org/ || die '插件安装失败'
fi
[ -d node_modules/dsh-enterprise ] || die '插件安装后未找到实体'
node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
if (!p.dsh.profile.bundles.includes("dsh-enterprise")) p.dsh.profile.bundles.push("dsh-enterprise");
fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
'
if [ -f "$ENT_TGZ" ]; then
  dsh plugin --profile ent add "file:$ENT_TGZ" >/dev/null 2>&1 || log '  （ent profile CLI 安装跳过，不影响桌面端）'
else
  dsh plugin --profile ent add "$ENT_SPEC" --registry=https://registry.npmjs.org/ >/dev/null 2>&1 \
    || dsh plugin --profile ent add "$ENT_SPEC" >/dev/null 2>&1 || log '  （ent profile CLI 安装跳过，不影响桌面端）'
fi
[ -f ~/.dsh/.credentials.yaml ] && chmod 600 ~/.dsh/.credentials.yaml
[ -d ~/.dsh/enterprise ] && chmod -R 700 ~/.dsh/enterprise
log "  已装: $(node -e 'console.log(require("./node_modules/dsh-enterprise/package.json").version)')"

# ===== [5/6] 预置（零弹窗 + 增项模式 + 网关预填 + 工作空间） =====
log '[5/6] 预置配置'
python3 - "$GW_URL" "${TARGET_VER:-unknown}" <<'PYEOF'
import hashlib, json, os, re, sys, datetime, uuid
gw = sys.argv[1]
desktop_version = sys.argv[2]
home = os.path.expanduser("~")

# settings.yaml: 内测声明跳过 + 增项模式
sp = home + "/.dsh/settings.yaml"
notice = 'ui-onboarding:\n  welcomeNoticeVersion: "2026-08-13.1"\n'
desktop = 'dsh-desktop:\n  mode: advanced\n'
if os.path.exists(sp):
    s = open(sp, encoding="utf-8").read()
    if not re.search(r'^ui-onboarding:', s, re.M): s += "\n" + notice
    if not re.search(r'^dsh-desktop:', s, re.M): s += "\n" + desktop
    open(sp, "w", encoding="utf-8").write(s)
else:
    os.makedirs(os.path.dirname(sp), exist_ok=True)
    open(sp, "w", encoding="utf-8").write(notice + "\n" + desktop)

# 向导跳过标记（profile-setup/<sha256(profile目录)>/state.json）
profile_dir = home + "/.dsh/profiles/desktop"
user_data = home + "/Library/Application Support/DSH Desktop"
h = hashlib.sha256(profile_dir.encode()).hexdigest()
d = os.path.join(user_data, "profile-setup", h)
os.makedirs(d, exist_ok=True)
os.chmod(os.path.dirname(d), 0o700); os.chmod(d, 0o700)
state = {"desktopVersion": desktop_version, "dshVersion": "0.1.5-rc.2", "outcome": "skipped", "profileHash": h,
         "recordedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
         "setupRevision": 1, "version": 2}
tmp = os.path.join(d, "state.json.tmp")
open(tmp, "w").write(json.dumps(state, indent=2) + "\n")
os.replace(tmp, os.path.join(d, "state.json")); os.chmod(os.path.join(d, "state.json"), 0o600)

# 出厂网关地址（登录框预填）
ent = home + "/.dsh/enterprise"; os.makedirs(ent, exist_ok=True); os.chmod(ent, 0o700)
open(ent + "/gateway-url.txt", "w").write(gw + "\n")

# 默认工作空间（dsh-enterprise- 前缀避免撞车）
ws_dir = home + "/dsh-enterprise-workspace"; os.makedirs(ws_dir, exist_ok=True)
wp = home + "/.dsh/storages/workspace.json"
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
if not os.path.exists(wp):
    os.makedirs(os.path.dirname(wp), exist_ok=True)
    wid = str(uuid.uuid4())
    s = {"unit": {"name": "workspace", "version": 2},
         "global": {"initialized": True, "workspaceIds": [wid], "archivedSessionIds": []},
         "tables": {"workspaces": {wid: {"path": ws_dir, "title": "dsh-enterprise-workspace",
                                          "sessionIds": [], "createdAt": now, "updatedAt": now}}}}
    open(wp + ".tmp", "w").write(json.dumps(s, indent=2))
    os.replace(wp + ".tmp", wp)
else:
    s = json.load(open(wp, encoding="utf-8"))
    if not s["global"]["workspaceIds"]:
        wid = str(uuid.uuid4())
        s["global"]["workspaceIds"] = [wid]
        s["tables"]["workspaces"][wid] = {"path": ws_dir, "title": "dsh-enterprise-workspace",
                                          "sessionIds": [], "createdAt": now, "updatedAt": now}
        open(wp + ".tmp", "w").write(json.dumps(s, indent=2))
        os.replace(wp + ".tmp", wp)

# 凭证文件（launchd umask 陷阱：必须启动前预创建 600）
cp = home + "/.dsh/.credentials.yaml"
if not os.path.exists(cp):
    open(cp, "w").close()
os.chmod(cp, 0o600)
print("  预置完成")
PYEOF

# ===== [6/6] 启动 =====
log '[6/6] 启动 DSH Desktop'
open -a 'DSH Desktop'
log '完成！应用已打开，输入企业账号密码即可使用。'
[ -x "$BIN_DIR/node" ] && log "提示：Node 装在本机用户目录，若新终端找不到 node，请在 ~/.zshrc 加：export PATH=\"$BIN_DIR:\$PATH\""
