#!/bin/bash
# DSH 企业客户端 · Mac 一键安装（curl | bash 直跑版）
# 托管: 网关自带接入页 http://<网关>:8899/setup 下发本脚本，__GATEWAY_URL__ 占位符按请求来源自动替换
# 流程: 装桌面(最新版) → 装 pnpm → 装企业插件 → 预置(零弹窗/增项模式/网关预填/工作空间) → 启动 → 落在登录页
# 用法:
#   curl -fsSL http://<网关>:8899/setup/mac-setup.sh | bash
#   curl -fsSL <脚本URL> | bash -s -- 10.102.101.42:8890   # 显式覆盖网关地址
set -uo pipefail

# PATH 前置：非交互 shell（SSH/管道）不含 Homebrew 路径，必须先补再检测 node
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

log(){ echo "[dsh-enterprise] $*"; }
die(){ echo "[dsh-enterprise][FATAL] $*" >&2; exit 1; }
trap 'echo "[dsh-enterprise][FATAL] 第 ${LINENO} 行执行失败，已中止（重跑本脚本即可继续）" >&2' ERR

# ===== 参数与工具检查 =====
GW_URL="${1:-__GATEWAY_URL__}"
# 非 URL 格式（含未替换的源码占位符）才清空转交互；网关注入的真实地址直接使用
case "$GW_URL" in http://*|https://*) ;; *) GW_URL="" ;; esac
DEFAULT_GW="http://127.0.0.1:8899"
PLUGIN_VER="0.9.10"
APP='/Applications/DSH Desktop.app'
BREW_NODE=0

command -v curl >/dev/null || die '需要 curl'
command -v python3 >/dev/null || die '需要 python3（macOS 自带）'

# ===== [1/6] Node + pnpm =====
log '[1/6] 检查 Node 与 pnpm'
if ! command -v node >/dev/null 2>&1; then
  log '  未检测到 Node，尝试 Homebrew 安装'
  BREW_NODE=1
  if command -v brew >/dev/null 2>&1; then
    brew install node >/dev/null 2>&1 || die 'brew install node 失败，请手动安装 Node 后重跑'
  else
    log '  无 Homebrew，先装 Homebrew（需要回车确认）'
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
      || die 'Homebrew 安装失败'
    # Apple Silicon 默认路径即时生效
    [ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
    [ -x /usr/local/bin/brew ] && eval "$(/usr/local/bin/brew shellenv)"
    brew install node >/dev/null 2>&1 || die 'brew install node 失败'
  fi
fi
if ! command -v pnpm >/dev/null 2>&1; then
  log '  安装 pnpm（全局，走官方 npm 源）'
  npm install -g pnpm --registry=https://registry.npmjs.org/ >/dev/null 2>&1 || die 'pnpm 安装失败'
fi
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
command -v node >/dev/null && command -v pnpm >/dev/null || die 'node/pnpm 仍不可用，请检查环境'
log "  node $(node -v) / pnpm $(pnpm -v)"

# ===== [2/6] DSH Desktop（动态最新版，已装一致跳过） =====
log '[2/6] DSH Desktop 版本检查'
API='https://api.github.com/repos/anywhere-labs/dsh-desktop/releases/latest'
LATEST=$(curl -s --fail --max-time 20 "$API" | python3 -c '
import json, sys
r = json.load(sys.stdin)
tag = r["tag_name"].lstrip("v")
dmg = next((a["browser_download_url"] for a in r["assets"] if a["name"].endswith(".dmg")), "")
digest = next((a.get("digest","") for a in r["assets"] if a["name"].endswith(".dmg")), "").replace("sha256:","")
print(tag, dmg, digest, sep="\n")
' 2>/dev/null) || LATEST=""
if [ -n "$LATEST" ]; then
  TARGET_VER=$(echo "$LATEST" | sed -n 1p); DMG_URL=$(echo "$LATEST" | sed -n 2p); DMG_SHA256=$(echo "$LATEST" | sed -n 3p)
else
  log '  GitHub API 不可达，降级 ModelScope 镜像'
  TARGET_VER="2.0.11"
  DMG_URL="https://modelscope.cn/models/t4wefan/deepseek-harness-desktop/resolve/master/DSH%20Desktop-${TARGET_VER}-universal.dmg"
  DMG_SHA256="ff470cd346aa7a951a4e0724b44130ba573021bb463c79002385cd6177fdf2a3"
fi
NEED_INSTALL=1
if [ -d "$APP" ]; then
  CUR_VER=$(python3 -c 'import json; print(json.load(open("'"$APP"'/Contents/Resources/app/package.json"))["version"])' 2>/dev/null || echo unknown)
  log "  已装: $CUR_VER / 最新: $TARGET_VER"
  [ "$CUR_VER" = "$TARGET_VER" ] && NEED_INSTALL=0
fi
if [ "$NEED_INSTALL" = "1" ]; then
  log "  下载并安装 $TARGET_VER（约 270MB，请耐心等待）..."
  osascript -e 'quit app "DSH Desktop"' >/dev/null 2>&1 || true
  sleep 3; pkill -f 'MacOS/DSH Desktop' >/dev/null 2>&1 || true; sleep 2
  curl -L --fail --silent --show-error -o /tmp/dsh-desktop.dmg "$DMG_URL" || die 'dmg 下载失败'
  if [ -n "$DMG_SHA256" ]; then
    echo "$DMG_SHA256  /tmp/dsh-desktop.dmg" | shasum -a 256 -c - >/dev/null || die 'dmg sha256 校验失败'
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

# ===== [3/6] 网关地址 =====
log '[3/6] 网关地址'
if [ -z "$GW_URL" ] && [ -t 0 ]; then
  printf '企业网关地址（回车 = 默认 %s）: ' "$DEFAULT_GW"
  read GW_URL || true
fi
GW_URL="${GW_URL:-$DEFAULT_GW}"
GW_URL="${GW_URL%/}"
case "$GW_URL" in http://*|https://*) ;; *) GW_URL="http://$GW_URL" ;; esac
log "  使用: $GW_URL"

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
ENT_TGZ="$HOME/.dsh/enterprise/dsh-enterprise-$PLUGIN_VER.tgz"
mkdir -p "$HOME/.dsh/enterprise"
if curl -fsSL --max-time 120 -o "$ENT_TGZ" "$GW_URL/plugin-packages/dsh-enterprise"; then
  log '  从企业网关插件仓库安装'
  pnpm add "file:$ENT_TGZ" >/dev/null 2>&1 || pnpm add "file:$ENT_TGZ" || die '插件安装失败'
else
  log '  网关仓库不可达，回退官方 npm 源'
  pnpm add "dsh-enterprise@$PLUGIN_VER" --registry=https://registry.npmjs.org/ >/dev/null 2>&1 \
    || { log '  官方源失败，重试（显示错误）'; pnpm add "dsh-enterprise@$PLUGIN_VER" --registry=https://registry.npmjs.org/ || die '插件安装失败'; }
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
  dsh plugin --profile ent add "dsh-enterprise@$PLUGIN_VER" --registry=https://registry.npmjs.org/ >/dev/null 2>&1 \
    || dsh plugin --profile ent add "dsh-enterprise@$PLUGIN_VER" >/dev/null 2>&1 || log '  （ent profile CLI 安装跳过，不影响桌面端）'
fi
[ -f ~/.dsh/.credentials.yaml ] && chmod 600 ~/.dsh/.credentials.yaml
[ -d ~/.dsh/enterprise ] && chmod -R 700 ~/.dsh/enterprise
log "  已装: $(node -e 'console.log(require("./node_modules/dsh-enterprise/package.json").version)')"

# ===== [5/6] 预置（零弹窗 + 增项模式 + 网关预填 + 工作空间） =====
log '[5/6] 预置配置'
python3 - "$GW_URL" <<'PYEOF'
import hashlib, json, os, re, sys, datetime, uuid
gw = sys.argv[1]
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
state = {"desktopVersion": "2.0.11", "dshVersion": "0.1.5-rc.2", "outcome": "skipped", "profileHash": h,
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
[ "$BREW_NODE" = "1" ] && log '提示：本次通过 Homebrew 安装了 Node，如终端找不到命令请重开终端窗口。'
