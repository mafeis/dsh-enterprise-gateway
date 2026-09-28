/**
 * 页面模块 · 登录/登出 + 健康状态灯
 */
import { GW, session, $, toast, confirmDlg } from './core.mjs?v=20260915180000';
import { navigate } from './router.mjs?v=20260915180000';
import { T } from './i18n.mjs';

export function showLogin() { $('loginMask').classList.remove('hidden'); $('mainWrap').style.display = 'none'; }

export async function logout() {
  const ok = await confirmDlg({
    title: T('退出登录', 'Sign out'),
    message: T('退出后需要重新输入账号密码才能进入管理台，确定退出吗？', 'You will need to sign in again to access the admin console. Sign out?'),
    confirmText: T('退出登录', 'Sign out'),
    danger: true,
  });
  if (!ok) return;
  // 尽力通知网关吊销令牌（成功与否不影响本地登出）
  try {
    await fetch(GW + '/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + session.jwt }, signal: AbortSignal.timeout(4000) });
  } catch { /* 网关不可达时仍本地登出 */ }
  session.clear();
  showLogin();
  toast(T('已退出登录', 'Signed out'));
}

/**
 * 把非管理员挡在管理台外：清掉本地凭证、退回登录页并说明原因。
 * 网关侧 /admin 闸门才是边界（不带管理员角色拿不到任何数据），这里只负责让用户看懂「为什么进不去」，
 * 而不是留一个「能打开但每个区块都 403」的半空管理台。
 */
export function rejectNonAdmin() {
  session.clear();
  showLogin();
  const el = $('loginErr');
  if (el) el.textContent = T('该账号不是管理员，无法进入管理台（普通用户请在 DSH 客户端登录）', 'This account is not an administrator, so the console is unavailable (sign in from the DSH client instead).');
}

export async function doLogin() {
  const u = $('loginUser').value.trim(), p = $('loginPass').value;
  $('loginErr').textContent = '';
  $('loginBtn').disabled = true; $('loginBtn').textContent = T('登录中…', 'Signing in…');
  try {
    const res = await fetch(GW + '/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      // scope=console 声明「这次登录是进管理台」：网关据此对非管理员直接给出可读拒绝
      body: JSON.stringify({ username: u, password: p, scope: 'console' }),
    });
    const body = await res.json();
    if (!res.ok || !body.token) {
      $('loginErr').textContent = body?.error?.message ?? T('登录失败（HTTP {s}）', 'Sign-in failed (HTTP {s})', { s: res.status });
      return;
    }
    // 兜底：连到旧版网关（不认 scope）时也不能让普通用户走进外壳
    if (body.user && body.user.role !== 'admin') return rejectNonAdmin();
    session.jwt = body.token;
    session.role = body.user?.role ?? '';
    localStorage.setItem('ent_user', body.user?.username ?? 'admin');
    $('loginMask').classList.add('hidden');
    $('mainWrap').style.display = '';
    toast(T('登录成功，欢迎 ', 'Signed in. Welcome ') + (body.user?.displayName || body.user?.username));
    navigate(location.hash.replace('#/', '') || 'overview');
  } catch (e) {
    $('loginErr').textContent = T('无法连接网关：{m}（请确认网关已运行）', 'Cannot reach the gateway: {m} (make sure it is running)', { m: e.message });
  } finally {
    $('loginBtn').disabled = false; $('loginBtn').textContent = T('登 录', 'Sign in');
  }
}

export async function checkHealth() {
  try {
    const h = await (await fetch(GW + '/health')).json();
    $('healthPill').classList.remove('down');
    $('healthText').dataset.i18nDone = '1';
    $('healthText').textContent = T('网关运行中 · ', 'Gateway online · ') + h.version;
    const lv = $('logoVer');
    if (lv) lv.textContent = T('管理台 · v', 'Console · v') + h.version;
  } catch {
    $('healthPill').classList.add('down');
    $('healthText').dataset.i18nDone = '1';
    $('healthText').textContent = T('网关离线', 'Gateway offline');
  }
}
