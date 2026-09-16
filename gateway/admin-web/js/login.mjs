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
  session.jwt = '';
  localStorage.removeItem('ent_user');
  showLogin();
  toast(T('已退出登录', 'Signed out'));
}

export async function doLogin() {
  const u = $('loginUser').value.trim(), p = $('loginPass').value;
  $('loginErr').textContent = '';
  $('loginBtn').disabled = true; $('loginBtn').textContent = T('登录中…', 'Signing in…');
  try {
    const res = await fetch(GW + '/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: u, password: p }),
    });
    const body = await res.json();
    if (!res.ok || !body.token) {
      $('loginErr').textContent = body?.error?.message ?? T('登录失败（HTTP {s}）', 'Sign-in failed (HTTP {s})', { s: res.status });
      return;
    }
    session.jwt = body.token;
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
