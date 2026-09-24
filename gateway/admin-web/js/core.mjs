/**
 * 内核：网关地址、JWT 会话、API 调用、DOM 工具
 */
/**
 * 网关地址：生产部署下管理台页面由网关自身托管，同源直连即可（任意端口/主机名都正确）。
 * 本地开发把 admin-web 用别的静态服务器打开时，可用 ?gw=http://host:port 显式指定，
 * 或 localStorage.setItem('ent_gw', 'http://host:port') 持久指定。
 */
import { T, getLang } from './i18n.mjs';

export const GW = localStorage.getItem('ent_gw')
    || new URLSearchParams(location.search).get('gw')
    || location.origin;

export const session = {
  // localStorage：跨标签页共享、关浏览器不丢；仅在登出或令牌过期(7天)时需重新登录
  get jwt() { return localStorage.getItem('ent_jwt') || ''; },
  set jwt(v) { v ? localStorage.setItem('ent_jwt', v) : localStorage.removeItem('ent_jwt'); },
};

const THEME_KEY = 'ent_admin_theme';

export function getTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* localStorage unavailable: follow system */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function refreshThemeButton(btn, theme) {
  if (!btn) return;
  btn.textContent = theme === 'dark' ? T('浅色', 'Light') : T('深色', 'Dark');
  btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
}

export function setTheme(theme, { persist = true } = {}) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  if (persist) {
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
  }
  refreshThemeButton(document.getElementById('themeToggle'), next);
}

export function bindThemeToggle() {
  const btn = document.getElementById('themeToggle');
  setTheme(getTheme(), { persist: false });
  btn?.addEventListener('click', () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'));
}


export const $ = (id) => document.getElementById(id);

export function toast(msg, type = 'ok') {
  const t = $('toastEl');
  t.textContent = msg;
  t.classList.remove('ok', 'bad');
  t.classList.add('show', type === 'bad' ? 'bad' : 'ok');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), type === 'bad' ? 4200 : 2400);
}

/** 业务断言：网关 4xx 也返回 JSON（不抛网络错），这里统一转异常，错误文案进 e.message */
export function must(r) {
  if (r && r.error) throw new Error(r.error.message || T('请求失败', 'Request failed'));
  return r;
}

/* ---------- 自定义确认弹窗（替代浏览器 confirm） ----------
 * confirmDlg({ title, message, confirmText, danger }) → Promise<boolean>
 * 单例 DOM：首次调用时注入，取消按钮 / Esc = 取消；点击遮罩空白不关闭（全站规范 §5.5，防误触）
 */
let _confirmEls = null;
export function confirmDlg({ title, message, confirmText, cancelText, danger = false } = {}) {
  title = title ?? T('确认操作', 'Confirm');
  confirmText = confirmText ?? T('确定', 'OK');
  cancelText = cancelText ?? T('取消', 'Cancel');
  return new Promise((resolve) => {
    if (!_confirmEls) {
      const mask = document.createElement('div');
      mask.className = 'confirm-mask';
      mask.innerHTML = `
        <div class="confirm-box" role="dialog" aria-modal="true">
          <div class="confirm-icon" id="cfrmIcon"></div>
          <h3 id="cfrmTitle"></h3>
          <div class="confirm-msg" id="cfrmMsg"></div>
          <div class="confirm-foot">
            <button class="btn" id="cfrmCancel"></button>
            <button class="btn primary" id="cfrmOk"></button>
          </div>
        </div>`;
      document.body.appendChild(mask);
      _confirmEls = {
        mask,
        title: mask.querySelector('#cfrmTitle'),
        msg: mask.querySelector('#cfrmMsg'),
        icon: mask.querySelector('#cfrmIcon'),
        ok: mask.querySelector('#cfrmOk'),
        cancel: mask.querySelector('#cfrmCancel'),
      };
    }
    const { mask, title: tEl, msg: mEl, icon, ok, cancel } = _confirmEls;
    tEl.textContent = title;
    mEl.textContent = message;
    icon.textContent = danger ? '!' : '?';
    icon.className = 'confirm-icon' + (danger ? ' danger' : '');
    ok.textContent = confirmText;
    ok.className = 'btn ' + (danger ? 'danger' : 'primary');
    cancel.textContent = cancelText;
    mask.classList.add('show');

    const done = (val) => {
      mask.classList.remove('show');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onKey = (e) => {
      if (e.key === 'Escape') done(false);
      // 危险操作不允许 Enter 确认：触发保存的 Enter 按键会在弹窗挂上监听后继续冒泡到 document，
      // 若此处放行，同一个按键事件会瞬间"自动确认"改名等危险操作（用户根本看不到弹窗）
      if (e.key === 'Enter' && !danger) done(true);
    };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
    // 聚焦取消按钮（危险操作防手滑回车；Enter 仍确认非危险操作）
    setTimeout(() => (danger ? cancel : ok).focus(), 30);
  });
}

/* ---------- 统一业务弹窗（.dlg-* 交互契约） ----------
 * 规范：docs/admin-plugin-pages.zh.md §5.5 —— 全站业务弹窗只有一套结构与交互：
 *   结构：.dlg-mask（遮罩） > .dlg（盒） > .dlg-head（标题常驻，不随内容滚动） + .dlg-body（唯一滚动区） + .dlg-foot（可选）
 *   交互：右上角 [data-dlg-close]（× 与取消按钮）/ Esc 两路关闭；点击遮罩空白【不关闭】（防误触丢掉填了一半的表单）
 *   openDlg(el) 打开 · closeDlg(el) 关闭；el = .dlg-mask 遮罩元素；后开在上（栈），Esc 只作用于栈顶
 *   打开锁页面滚动，全部关闭后恢复；确认弹窗（confirmDlg）在场时 Esc 让位给它
 */
const _dlgStack = [];
export function openDlg(el, { onClose } = {}) {
  if (!el) return;
  el.hidden = false;
  if (!_dlgStack.some((d) => d.el === el)) _dlgStack.push({ el, onClose });
  document.body.style.overflow = 'hidden';
}
export function closeDlg(el) {
  if (!el) return;
  const i = _dlgStack.findIndex((d) => d.el === el);
  if (i >= 0) {
    const [d] = _dlgStack.splice(i, 1);
    d.onClose?.();
  }
  el.hidden = true;
  if (!_dlgStack.length) document.body.style.overflow = '';
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !_dlgStack.length) return;
  if (document.querySelector('.confirm-mask.show')) return;   // 确认弹窗在场：让位给它自己的 Esc 处理
  closeDlg(_dlgStack[_dlgStack.length - 1].el);
});
document.addEventListener('click', (e) => {
  // 右上角 ×（及一切 data-dlg-close 按钮：取消等）——关闭按钮所在的弹窗。
  // 注意：点击遮罩空白不关闭（全站规范 §5.5），点到弹窗外没有任何动作。
  const x = e.target.closest('[data-dlg-close]');
  if (x) closeDlg(x.closest('.dlg-mask'));
});

export async function api(path, opts = {}) {
  // 传对象就当 JSON 发：漏写 JSON.stringify 时，fetch 会把对象变成 "[object Object]"，
  // 而网关把解析失败的体当空对象处理 → 请求「成功」但什么都没改（静默失效，极难发现）。
  if (opts.body !== null && typeof opts.body === 'object' && !(opts.body instanceof ArrayBuffer)
    && !ArrayBuffer.isView(opts.body) && typeof opts.body.arrayBuffer !== 'function' && typeof opts.body.text !== 'function') {
    opts = { ...opts, body: JSON.stringify(opts.body) };
  }
  const res = await fetch(GW + path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(session.jwt ? { Authorization: 'Bearer ' + session.jwt } : {}), ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    const { showLogin } = await import('./login.mjs');
    showLogin();
    throw new Error('401');
  }
  return res.json();
}

/** token 计数格式化：zh 用「万」，en 用「k」 */
export const fmtTok = (n) => {
  const v = n ?? 0;
  if (getLang() === 'en') return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v);
  return v >= 10000 ? (v / 10000).toFixed(1) + '万' : String(v);
};

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
