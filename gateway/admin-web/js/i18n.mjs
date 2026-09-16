/**
 * 管理台 i18n 内核：中英双语（zh / en）
 * - 语言选择：localStorage('ent_lang') 手动优先 → 浏览器语言自动 → 默认中文
 * - 用法：T('中文', 'English') / T('你好 {n}', 'Hello {n}', { n: name })
 * - 切换语言 = 写 localStorage 后整页 reload（页面模块在装配时渲染文案，reload 即全量生效）
 * - 页面模块（/admin/plug/<name>/）与本壳统一从本模块取词，保证术语一致
 */
const LANG_KEY = 'ent_lang';

let _lang = null;

/** 当前语言：'zh' | 'en'（模块内缓存，切语言必经整页 reload，无需动态失效） */
export function getLang() {
  if (_lang) return _lang;
  try {
    const saved = (localStorage.getItem(LANG_KEY) || '').toLowerCase();
    if (saved === 'zh' || saved === 'en') { _lang = saved; return _lang; }
  } catch { /* localStorage 不可用：走浏览器语言 */ }
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'zh-CN';
  _lang = String(nav).toLowerCase().startsWith('zh') ? 'zh' : 'en';
  return _lang;
}

/** 是否英文界面 */
export const isEn = () => getLang() === 'en';

/** 切换语言并整页生效 */
export function setLang(lang) {
  const v = lang === 'en' ? 'en' : 'zh';
  try { localStorage.setItem(LANG_KEY, v); } catch { /* 忽略：本次会话仍可生效 */ }
  location.reload();
}

/**
 * 双语取词：zh 缺失回退 en；支持 {name} 占位符
 * @param {string} zh 中文文案（也是兜底）
 * @param {string} en 英文文案
 * @param {Record<string, *>} [params] 占位符参数
 */
export function T(zh, en, params) {
  let s = (getLang() === 'en' && en) ? en : (zh ?? en ?? '');
  if (params) s = s.replace(/\{(\w+)\}/g, (m, n) => (n in params) ? String(params[n]) : m);
  return s;
}

/** 壳静态文案（views/*.html 里的固定文字，启动时按 data-i18n 替换） */
const SHELL_DICT = {
  title:        { zh: 'DSH 企业网关 · 管理台', en: 'DSH Enterprise Gateway · Admin' },
  brand:        { zh: 'DSH 企业网关', en: 'DSH Enterprise Gateway' },
  console:      { zh: '管理台', en: 'Admin Console' },
  connecting:   { zh: '连接中…', en: 'Connecting…' },
  logout:       { zh: '退出登录', en: 'Sign out' },
  refreshPage:  { zh: '↻ 刷新本页', en: '↻ Refresh' },
  loginTitle:   { zh: '登录管理台', en: 'Admin Sign-in' },
  loginSub:     { zh: 'DSH 企业网关 · 需管理员账号', en: 'DSH Enterprise Gateway · Admin account required' },
  loginUser:    { zh: '用户名', en: 'Username' },
  loginPass:    { zh: '密码', en: 'Password' },
  loginBtn:     { zh: '登 录', en: 'Sign in' },
  loginHint1:   { zh: '首次启动的初始密码在网关控制台日志中（仅打印一次）', en: 'First-start initial password is printed once in the gateway console log' },
  loginHint2:   { zh: '登录后所有数据来自网关实时接口：', en: 'All data comes live from the gateway: ' },
  loginHintSrc: { zh: '本页地址即网关（同源直连）', en: 'this page is served by the gateway' },
};

/** 启动时套用壳静态文案 + <html lang> + document.title；返回字典供 login.mjs 复用 */
export function applyShellI18n() {
  const lang = getLang();
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.title = T(SHELL_DICT.title.zh, SHELL_DICT.title.en);
  const map = {
    logoBrand: SHELL_DICT.brand, logoConsole: SHELL_DICT.console,
    healthText: null,   // 连接中… 由 checkHealth 动态改写，仅初始态在此设置
    logoutBtn: SHELL_DICT.logout, refreshBtn: SHELL_DICT.refreshPage,
    loginTitle: SHELL_DICT.loginTitle, loginSub: SHELL_DICT.loginSub,
    loginUser: SHELL_DICT.loginUser, loginPass: SHELL_DICT.loginPass,
    loginBtn: SHELL_DICT.loginBtn, loginHint1: SHELL_DICT.loginHint1,
    loginHint2: SHELL_DICT.loginHint2, loginHintSrc: SHELL_DICT.loginHintSrc,
  };
  for (const [id, d] of Object.entries(map)) {
    if (!d) continue;
    const el = document.getElementById(id);
    if (el) el.textContent = T(d.zh, d.en);
  }
  const health = document.getElementById('healthText');
  if (health && !health.dataset.i18nDone) health.textContent = T(SHELL_DICT.connecting.zh, SHELL_DICT.connecting.en);
  const ph = { loginUser: SHELL_DICT.loginUser, loginPass: SHELL_DICT.loginPass };
  for (const [id, d] of Object.entries(ph)) {
    const el = document.getElementById(id);
    if (el) el.placeholder = T(d.zh, d.en);
  }
  return SHELL_DICT;
}

/** 语言切换按钮：所有 [data-lang-toggle] 点击后切到另一语言；按钮文案 = 目标语言 */
export function bindLangToggle() {
  const label = () => getLang() === 'zh' ? 'EN' : '中文';
  document.querySelectorAll('[data-lang-toggle]').forEach((btn) => {
    btn.textContent = label();
    btn.addEventListener('click', () => setLang(getLang() === 'zh' ? 'en' : 'zh'));
  });
}
