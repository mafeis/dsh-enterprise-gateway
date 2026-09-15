/**
 * 应用装配：登录/登出 + 启动（页面逻辑全部在插件 .web/ 模块里，壳零页面代码）
 */
import { $, api, session } from './core.mjs?v=20260914120000';
import { doLogin, logout, checkHealth } from './login.mjs?v=20260914120000';
import { navigate, initRouter, refreshCurrent } from './router.mjs?v=20260914120000';

/* ---- 事件绑定（仅壳私有区域：登录/顶栏；页面事件由各插件模块自带） ---- */
function bindEvents() {
  $('loginBtn').addEventListener('click', doLogin);
  $('loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('logoutBtn').addEventListener('click', logout);
  $('refreshBtn').addEventListener('click', refreshCurrent);
}

/* ---- 启动 ---- */
bindEvents();
initRouter();
checkHealth();
if (session.jwt) {
  (async () => {
    try {
      await api('/admin/stats');
    } catch { return; }
    // 老会话补发会话 cookie（必须先于 navigate）：动态 import 的插件页面模块只带 cookie
    // 不带 Bearer，登录早于 cookie 机制的会话（JWT 在 localStorage 里仍有效）不补则插件页面 401
    await api('/auth/refresh', { method: 'POST' }).catch(() => {});
    $('loginMask').classList.add('hidden');   // 有有效令牌：隐藏登录遮罩（刷新后免登的关键一步）
    $('mainWrap').style.display = '';
    navigate(location.hash.replace('#/', '') || 'overview');
  })();
}
