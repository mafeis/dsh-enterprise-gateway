/**
 * 页面模块 · 登录/登出 + 健康状态灯
 */
import { GW, session, $, toast, confirmDlg } from './core.mjs?v=20260914120000';
import { navigate } from './router.mjs?v=20260914120000';

export function showLogin() { $('loginMask').classList.remove('hidden'); $('mainWrap').style.display = 'none'; }

export async function logout() {
  const ok = await confirmDlg({
    title: '退出登录',
    message: '退出后需要重新输入账号密码才能进入管理台，确定退出吗？',
    confirmText: '退出登录',
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
  toast('已退出登录');
}

export async function doLogin() {
  const u = $('loginUser').value.trim(), p = $('loginPass').value;
  $('loginErr').textContent = '';
  $('loginBtn').disabled = true; $('loginBtn').textContent = '登录中…';
  try {
    const res = await fetch(GW + '/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: u, password: p }),
    });
    const body = await res.json();
    if (!res.ok || !body.token) {
      $('loginErr').textContent = body?.error?.message ?? '登录失败（HTTP ' + res.status + '）';
      return;
    }
    session.jwt = body.token;
    localStorage.setItem('ent_user', body.user?.username ?? 'admin');
    $('loginMask').classList.add('hidden');
    $('mainWrap').style.display = '';
    toast('登录成功，欢迎 ' + (body.user?.displayName || body.user?.username));
    navigate(location.hash.replace('#/', '') || 'overview');
  } catch (e) {
    $('loginErr').textContent = '无法连接网关：' + e.message + '（请确认网关已运行）';
  } finally {
    $('loginBtn').disabled = false; $('loginBtn').textContent = '登 录';
  }
}

export async function checkHealth() {
  try {
    const h = await (await fetch(GW + '/health')).json();
    $('healthPill').classList.remove('down');
    $('healthText').textContent = '网关运行中 · ' + h.version;
    const lv = $('logoVer');
    if (lv) lv.textContent = '管理台 · v' + h.version;
  } catch {
    $('healthPill').classList.add('down');
    $('healthText').textContent = '网关离线';
  }
}
