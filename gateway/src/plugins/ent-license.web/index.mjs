/**
 * 插件页面 · 商业授权（付费页 · 旗舰观感）
 * 数据源：/admin/license（ent-license 域插件）
 * 设计语言：
 *   - 深色渐变 hero（全页唯一重色块）+ 状态辉光，licensee 大字上墙 = 「名字刻在产品里」的仪式感
 *   - 授权详情做成证书卡（双线框 + 印章），付费客户看它像看奖状
 *   - 社区许可 vs 商业授权 权益对照，付费动机不靠说教靠对比
 */
import { api, $, toast, esc } from '/admin/static/contract.mjs'
import { T, isEn } from '/admin/static/js/i18n.mjs';

const STATE_BADGE = {
  free:         { cls: 'dim',  text: () => T('社区许可', 'Community') },
  licensed:     { cls: 'ok',   text: () => T('商业授权', 'Licensed') },
  'over-limit': { cls: 'warn', text: () => T('需商业授权', 'License required') },
  invalid:      { cls: 'bad',  text: () => T('授权码无效', 'Invalid key') },
}

/** 状态 → hero 辉光与 chip 配色 */
const STATE_HERO = {
  free:         { glow: 'rgba(37,99,235,.35)',   chipBg: 'rgba(96,165,250,.16)',  chipFg: '#93c5fd' },
  licensed:     { glow: 'rgba(16,185,129,.35)',  chipBg: 'rgba(52,211,153,.16)',  chipFg: '#6ee7b7' },
  'over-limit': { glow: 'rgba(217,119,6,.35)',   chipBg: 'rgba(251,191,36,.16)',  chipFg: '#fcd34d' },
  invalid:      { glow: 'rgba(220,38,38,.35)',   chipBg: 'rgba(248,113,113,.16)', chipFg: '#fca5a5' },
}

function fmtDate(v) {
  return v ? String(v).slice(0, 10) : T('永久', 'Never expires')
}

function fmtSeats(seats) {
  if (seats === 'unlimited') return T('不限', 'Unlimited')
  return seats != null ? String(seats) : '–'
}

export default {
  page: 'ent-license',
  html: `
  <div class="headrow" data-ent-page="ent-license">
    <div><h1>${T('商业授权','Commercial license')}</h1></div>
  </div>

  <!-- 状态 hero：深色渐变 + 状态辉光，licensee 上墙 -->
  <div class="lic-hero" id="licHero">
    <div class="lic-hero-glow" id="licHeroGlow"></div>
    <div class="lic-hero-main">
      <div class="lic-hero-title">
        <span class="badge" id="licBadge">–</span>
        <span class="lic-seatchip" id="licSeatChip">–</span>
      </div>
      <div class="lic-hero-name" id="licHeroName">–</div>
      <div class="lic-hero-msg" id="licMsg">–</div>
      <div class="lic-seatbar"><i id="licSeatFill" style="width:0%"></i></div>
      <div class="lic-seatcap" id="licSeatCap">–</div>
    </div>
    <div class="lic-hero-contact">
      <div class="lic-contact-t">${T('需要扩大规模？','Need more seats?')}</div>
      <div class="lic-contact-t2">${T('商业授权 · 按席位订阅','Commercial license · per-seat')}</div>
      <a class="lic-mail" href="mailto:mafeis@gmail.com">mafeis@gmail.com</a>
    </div>
  </div>

  <!-- 证书卡 + 录入卡 -->
  <div class="grid2" style="margin-top:20px">
    <div class="lic-cert card" id="licCertCard">
      <div class="lic-cert-inner">
        <div class="lic-cert-eyebrow">${T('授权证书','License certificate')}</div>
        <div class="lic-cert-name" id="licCertName">–</div>
        <div class="lic-cert-attrs" id="licCertAttrs"></div>
        <div class="lic-cert-seal" id="licCertSeal">D</div>
        <div class="lic-cert-foot">${T('DSH 企业版 · Ed25519 验签','DSH Enterprise · Ed25519 verified')}</div>
      </div>
    </div>

    <div class="card">
      <h2><span class="bar"></span>${T('授权码','License key')}</h2>
      <div class="sub" id="licKeyHint"></div>
      <textarea class="input" id="licKey" rows="3" placeholder="DSHE1.xxxx.xxxx" style="width:100%;resize:vertical;font-family:Consolas,'Cascadia Code',monospace;font-size:12.5px;line-height:1.6" autocomplete="off" spellcheck="false"></textarea>
      <div style="display:flex;gap:8px;align-items:center;margin-top:10px">
        <button class="btn primary sm" id="licSaveBtn">${T('保存授权码','Save key')}</button>
        <button class="btn sm" id="licClearBtn" hidden>${T('清除','Clear')}</button>
        <span style="flex:1"></span>
        <span class="sub2" id="licKeyState"></span>
      </div>
      <div class="hint" style="margin-top:14px">${T('保存即验签：格式、签名、席位、有效期当场校验，落盘重启不丢。','Verified on save: format, signature, seats and expiry are checked immediately and persisted.')}</div>
    </div>
  </div>

  <!-- 版本对照：同一张表逐行对比，商业列高亮 -->
  <div class="card" style="margin-top:20px">
    <h2><span class="bar"></span>${T('社区版 vs 商业版','Community vs Commercial')}</h2>
    <div class="lic-vs">
      <div class="lic-vs-head">
        <span></span>
        <span>${T('社区版','Community')}<span class="badge dim" style="margin-left:6px">${T('免费','Free')}</span></span>
        <span class="lic-vs-c hit">${T('商业版','Commercial')}<span class="badge" style="margin-left:6px">${T('按席位','Per-seat')}</span></span>
      </div>
      <div class="lic-vs-row">
        <span class="lic-vs-k">${T('支持通道','Support')}</span>
        <span class="lic-vs-c dim2">${T('GitHub Issues，按社区节奏处理','GitHub Issues, handled at community pace')}</span>
        <span class="lic-vs-c hit">${T('专属客服，问题优先响应','Dedicated support with priority response')}</span>
      </div>
      <div class="lic-vs-row">
        <span class="lic-vs-k">${T('响应时效','Response time')}</span>
        <span class="lic-vs-c dim2">${T('无承诺，排队等回复','No SLA, wait in queue')}</span>
        <span class="lic-vs-c hit">${T('工作日当天响应','Same business-day response')}</span>
      </div>
      <div class="lic-vs-row">
        <span class="lic-vs-k">${T('更新节奏','Release cadence')}</span>
        <span class="lic-vs-c dim2">${T('更新频繁，功能新，可能遇到 bug','Frequent, fresh features, may hit bugs')}</span>
        <span class="lic-vs-c hit">${T('更新克制，经过验证更稳定','Curated releases, field-tested and stable')}</span>
      </div>
      <div class="lic-vs-row">
        <span class="lic-vs-k">${T('规模上限','Seat ceiling')}</span>
        <span class="lic-vs-c dim2">${T('≤30 席位','≤30 seats')}</span>
        <span class="lic-vs-c hit">${T('席位自选，不限规模','Any seat count')}</span>
      </div>
      <div class="lic-vs-row">
        <span class="lic-vs-k">${T('授权方式','Licensing')}</span>
        <span class="lic-vs-c dim2">${T('开箱即用','Works out of the box')}</span>
        <span class="lic-vs-c hit">${T('永久或按年授权','Perpetual or annual terms')}</span>
      </div>
      <div class="lic-vs-row">
        <span class="lic-vs-k">${T('到期影响','Expiry impact')}</span>
        <span class="lic-vs-c dim2">${T('—','—')}</span>
        <span class="lic-vs-c hit">${T('到期提醒，绝不拦截服务','Reminders only, never a hard stop')}</span>
      </div>
    </div>
    <div style="margin-top:14px;font-size:12.5px;color:var(--dim)">${T('商业授权联系 <a class="lic-mail-inline" href="mailto:mafeis@gmail.com">mafeis@gmail.com</a> 获取报价', 'Contact <a class="lic-mail-inline" href="mailto:mafeis@gmail.com">mafeis@gmail.com</a> for pricing')}</div>
  </div>`,
  async load() { await loadLicense() },
  bind() {
    $('licSaveBtn').addEventListener('click', saveLicenseKey)
    $('licKey').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveLicenseKey() } })
    $('licClearBtn').addEventListener('click', clearLicenseKey)
  },
}

async function loadLicense() {
  let lic
  try { lic = await api('/admin/license') } catch { return }
  const state = STATE_BADGE[lic.state] ? lic.state : 'invalid'
  const badge = STATE_BADGE[state]
  const hero = STATE_HERO[state]

  // hero：辉光 + 徽章 + chip
  $('licBadge').className = 'badge ' + badge.cls
  $('licBadge').textContent = badge.text()
  $('licHeroGlow').style.background = `radial-gradient(420px 200px at 18% 0%, ${hero.glow}, transparent 70%)`
  $('licSeatChip').style.background = hero.chipBg
  $('licSeatChip').style.color = hero.chipFg
  $('licMsg').textContent = isEn() ? (lic.messageEn ?? lic.message) : lic.message

  // hero 主名：有授权亮被授权方，否则亮规模口号
  const unlimited = lic.seats === 'unlimited'
  const cap = lic.hasKey && lic.seats != null ? lic.seats : lic.freeSeatLimit
  const valid = lic.state === 'licensed'
  if (valid && lic.licensee) {
    $('licHeroName').textContent = lic.licensee
  } else if (state === 'free') {
    $('licHeroName').textContent = T(`已启用 ${lic.userCount} 个账号，社区许可免费使用`, `${lic.userCount} enabled accounts, free under Community license`)
  } else if (state === 'over-limit') {
    $('licHeroName').textContent = lic.licensee ? lic.licensee : T('启用账号已超出免费席位', 'Enabled accounts exceed the free seat limit')
  } else {
    $('licHeroName').textContent = T('授权码需要更新', 'License key needs attention')
  }

  // 席位条
  const capTxt = unlimited ? T('不限席位', 'unlimited') : `${cap}`
  $('licSeatChip').textContent = `${lic.userCount} / ${capTxt}`
  const fill = $('licSeatFill')
  if (unlimited) {
    fill.style.width = '28%'
    fill.style.background = 'linear-gradient(180deg,#34d399,var(--ok))'
  } else {
    const pct = Math.min(100, Math.round((lic.userCount / (Number(cap) || 1)) * 100))
    fill.style.width = `${pct}%`
    fill.style.background = pct >= 100 ? 'linear-gradient(180deg,#f87171,var(--bad))' : pct >= 90 ? 'linear-gradient(180deg,#fbbf24,var(--warn))' : 'linear-gradient(180deg,#60a5fa,var(--accent))'
  }
  $('licSeatCap').textContent = unlimited
    ? (lic.expiresAt ? T('商业授权 · 不限席位 · 有效期至 {d}', 'Commercial · unlimited seats · valid until {d}', { d: fmtDate(lic.expiresAt) }) : T('商业授权 · 不限席位 · 永久有效', 'Commercial · unlimited seats · no expiry'))
    : T('席位口径 = 启用账号数', 'Seat basis = enabled accounts')

  // 授权码卡
  $('licKeyHint').textContent = lic.hasKey
    ? T('已录入授权码，重复录入直接覆盖。', 'A key is set; saving again overwrites it.')
    : T('从授权方取得后粘贴到这里。', 'Paste the key you received from the licensor.')
  $('licKeyState').textContent = lic.hasKey ? T('已配置', 'Configured') : T('未配置', 'Not set')
  $('licClearBtn').hidden = !lic.hasKey

  // 证书卡：有效授权才「盖章」，其余置灰占位
  const hasCert = valid && lic.licensee
  $('licCertCard').classList.toggle('lic-cert-active', hasCert)
  if (hasCert) {
    $('licCertName').textContent = lic.licensee
    const seatsAttr = lic.seats === 'unlimited' ? T('不限席位', 'Unlimited seats') : T('{n} 席位', '{n} seats', { n: lic.seats })
    const expAttr = lic.expiresAt ? T('有效期至 {d}', 'Valid until {d}', { d: fmtDate(lic.expiresAt) }) : T('永久授权', 'Perpetual')
    const issuedAttr = lic.issuedAt ? T('签发于 {d}', 'Issued {d}', { d: fmtDate(lic.issuedAt) }) : ''
    $('licCertAttrs').innerHTML = [
      `<span class="lic-cert-attr">${esc(seatsAttr)}</span>`,
      `<span class="lic-cert-attr">${esc(expAttr)}</span>`,
      issuedAttr ? `<span class="lic-cert-attr dim2">${esc(issuedAttr)}</span>` : '',
    ].join('')
  } else {
    $('licCertName').textContent = T('待录入授权', 'Awaiting license')
    $('licCertAttrs').innerHTML = `<span class="lic-cert-attr dim2">${T('录入有效授权码后，证书在此点亮。', 'Your certificate lights up here once a valid key is saved.')}</span>`
  }
}

async function saveLicenseKey() {
  const key = $('licKey').value.trim()
  try {
    const r = await api('/admin/license', { method: 'PATCH', body: JSON.stringify({ key }) })
    if (r?.error) { toast('✗ ' + (r.error.message ?? T('保存失败','Save failed')), 'bad'); return }
    $('licKey').value = ''
    toast(key ? T('授权码已保存','License key saved') : T('授权码已清除','License key cleared'))
    loadLicense()
  } catch (e) { if (e.message !== '401') toast('✗ ' + e.message, 'bad') }
}

async function clearLicenseKey() {
  try {
    await api('/admin/license', { method: 'PATCH', body: JSON.stringify({ key: '' }) })
    toast(T('授权码已清除','License key cleared'))
    loadLicense()
  } catch (e) { if (e.message !== '401') toast('✗ ' + e.message, 'bad') }
}
