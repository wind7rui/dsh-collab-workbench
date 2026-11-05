// Update check and manual-upgrade guidance for the existing Workbench panel;
// embedded into client.js at build time. Styles are owned by these components.
export function createUpdateUI(React, ctx, call) {
  const h = React.createElement
  const NS = 'dwbUpdates'
  const zh = {
    about:'关于', cloud:'有新版本', title:'协作工作台', current:'当前版本', latest:'最新版本',
    check:'检查更新', checking:'正在检查…', update:'可升级',
    ready:'发现新版本，可按下方步骤手动升级。', currentState:'已是最新版本',
    local:'当前从本地文件安装，请从原安装来源更新。', other:'当前安装来源不支持在线检查更新。',
    pending:'尚未检查更新', failed:'检查更新失败', error:'无法检查更新，请检查网络后重试。',
    guideTitle:'升级步骤', note:'当前 Harness 不允许覆盖运行中的插件，因此不会自动安装。',
    step1:'打开 Harness 的插件（管理）页面。', step2:'卸载「协作工作台」。',
    step3:'安装下面这个版本，然后重启 Harness 并刷新页面。', spec:'安装版本',
    warning:'卸载后若安装失败，工作台会暂时不可用；请先备份工作台数据和项目文件，并确认网络与 registry 可用。',
    dataSafe:'升级只替换插件程序；$DSH_HOME/dsh-workbench 中的角色、群组和任务数据会保留。',
  }
  const en = {
    about:'About', cloud:'Update available', title:'Collaboration Workbench', current:'Installed version', latest:'Latest version',
    check:'Check for updates', checking:'Checking…', update:'Upgrade',
    ready:'A new version is available. Follow the steps below to upgrade manually.', currentState:'Up to date',
    local:'Installed from a local file; update it from the original source.', other:'This install source cannot check for updates.',
    pending:'Not checked yet', failed:'Update check failed', error:'Could not check for updates. Check your network and try again.',
    guideTitle:'Upgrade steps', note:'This Harness does not allow replacing a running plugin, so nothing is installed automatically.',
    step1:'Open the Harness plugins page.', step2:'Uninstall Collaboration Workbench.',
    step3:'Install the version below, then restart Harness and refresh the page.', spec:'Install version',
    warning:'If the install fails after uninstalling, the workbench stays unavailable until it succeeds. Back up workbench data and project files, and make sure the network and registry work first.',
    dataSafe:'Upgrading only replaces the plugin program; roles, groups and tasks in $DSH_HOME/dsh-workbench are preserved.',
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'collaboration workbench: update locales')
  const t = ctx.locale.bind(NS)
  const css = `.dwb-update-cloud{width:52px;min-height:42px;padding:5px 0;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-brand-primary);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:2px}.dwb-update-cloud:hover{background:var(--dsw-alias-bg-layer-2)}.dwb-update-cloud:focus-visible,.dwb-update-about button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dwb-update-cloud span{font-size:10px}.dwb-update-about{flex:1;min-width:0;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:56px 24px 24px}.dwb-update-card{max-width:640px;padding:20px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}.dwb-update-about h2{font-size:18px;margin:0 0 18px}.dwb-update-about h3{font-size:14px;margin:18px 0 8px}.dwb-update-about dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:10px 20px;margin:0 0 18px}.dwb-update-about dt{color:var(--dsw-alias-label-secondary)}.dwb-update-about dd{margin:0;overflow-wrap:anywhere}.dwb-update-state{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);margin:0 0 16px}.dwb-update-error{color:var(--dsw-alias-state-error-primary)}.dwb-update-actions{display:flex;gap:10px;flex-wrap:wrap}.dwb-update-about button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 12px;min-height:34px;cursor:pointer}.dwb-update-about button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.dwb-update-about button:disabled{opacity:.5;cursor:default}.dwb-update-steps{margin:0;padding-left:20px;font-size:13px;line-height:1.9}.dwb-update-spec{display:inline-block;margin-top:8px;padding:6px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;user-select:all;overflow-wrap:anywhere}.dwb-update-note,.dwb-update-safe{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary);margin:10px 0 0}.dwb-update-safe{color:var(--dsw-alias-state-success-primary)}`
  function useUpdates() {
    const [status, setStatus] = React.useState({ phase:'idle', source:'unknown', current:null, latest:null, available:false })
    const [error, setError] = React.useState(null)
    const [busy, setBusy] = React.useState(false)
    const refresh = React.useCallback(async (fresh = false) => {
      setBusy(true)
      setError(null)
      try {
        const value = await call('updates.check', { fresh })
        setStatus(value)
        return value
      } catch (failure) {
        setError(String(failure?.message ?? failure))
        return null
      } finally { setBusy(false) }
    }, [])
    React.useEffect(() => {
      let active = true
      const check = async () => {
        try { const value = await call('updates.check', { fresh:false }); if (active) setStatus(value) }
        catch (failure) { if (active) setError(String(failure?.message ?? failure)) }
      }
      void check()
      const timer = setInterval(check, 60_000)
      return () => { active = false; clearInterval(timer) }
    }, [])
    return {status, error, busy, refresh}
  }
  function UpdateCloud({ onClick }) {
    return h(React.Fragment, null, h('style', null, css),
      h('button', { type:'button', className:'dwb-update-cloud', title:t('cloud'), 'aria-label':t('cloud'), onClick },
        h('svg', {width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,'aria-hidden':true},
          h('path',{d:'M7 18h11a4 4 0 0 0 .2-8A6.5 6.5 0 0 0 5.6 9 4.5 4.5 0 0 0 7 18Z'}),
          h('path',{d:'m12 15 0-6m-2.5 2.5L12 9l2.5 2.5'})),
        h('span',null,t('update'))))
  }
  function UpdateAbout({ status, error, busy, refresh }) {
    const failed = Boolean(error) || status.phase === 'failed'
    const state = failed ? t('failed') : status.source === 'local' ? t('local') : status.source !== 'registry' ? t('other')
      : status.available ? t('ready') : status.checkedAt ? status.latest ? t('currentState') : t('error') : t('pending')
    const spec = status.latest ? `dsh-collab-workbench@${status.latest}` : null
    return h('section', {className:'dwb-update-about', 'aria-label':t('title')},
      h('style',null,css),
      h('div',{className:'dwb-update-card'},
        h('h2',null,t('title')),
        h('dl',null,h('dt',null,t('current')),h('dd',null,status.current ?? '—'),h('dt',null,t('latest')),h('dd',null,status.latest ?? '—')),
        h('p',{className:`dwb-update-state ${failed ? 'dwb-update-error' : ''}`,role:failed ? 'alert':undefined},
          state, failed ? `: ${error ?? status.error ?? t('error')}` : ''),
        h('div',{className:'dwb-update-actions'},
          h('button',{type:'button',onClick:()=>refresh(true),disabled:busy},busy?t('checking'):t('check'))),
        status.available ? h(React.Fragment, null,
          h('h3',null,t('guideTitle')),
          h('ol',{className:'dwb-update-steps'},
            h('li',null,t('step1')), h('li',null,t('step2')),
            h('li',null,t('step3'), spec ? h('div',null,h('code',{className:'dwb-update-spec'},spec)) : null)),
          h('p',{className:'dwb-update-note'},t('note')),
          h('p',{className:'dwb-update-note'},t('warning')),
          h('p',{className:'dwb-update-safe'},t('dataSafe'))) : null))
  }
  return {useUpdates, UpdateCloud, UpdateAbout, t}
}
