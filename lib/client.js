/**
 * dsh-attune Web/Desktop face. Every action has a text-command counterpart in the Host.
 * Uses the public client slots and the authenticated, same-origin Host fetch route.
 */
window.__ModuleLoader__.load({
  id: 'dsh-attune',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { useEffect, useRef, useState } = React
    const h = React.createElement

    const zh = {
      entry: '🎲 默契小实验', title: '默契小实验', intro: 'DSH 根据你的情境出一道题。选出更合心意的答案，再决定是否记住这条偏好。',
      play: '做个小测试', rules: '我的偏好', close: '关闭', retry: '重试', loading: '正在读取…',
      emptyTests: '还没有生成过题目。可以先生成一题。', emptyRules: '还没有保存的偏好。做一道题试试。',
      choose: '选择这项', learned: '我可能学到了', candidateHint: '可以先改成你真正想表达的意思，再决定是否记住。',
      remember: '记住这个', session: '这次不记住', reject: '理解错了',
      edit: '纠正', save: '保存纠正', cancel: '取消', remove: '删除',
      confirmRemove: '确认删除', forgetEvidence: '同时忘记这条规则的答题依据',
      evidence: '依据', scopeGlobal: '长期偏好', scopeSession: '本次会话',
      done: '已经更新。', help: '任何时候都能纠正或删除；当前明确要求始终优先。',
      problem: '操作没有完成', pending: '待确认', noProposal: '这次选择还不足以形成规律。可以继续试一题。',
      how: '怎么回答', selectTest: '已生成的题目', menu: '菜单',
      contextLabel: '眼前在忙什么？', contextPlaceholder: '可选，例如：我在规划一次旅行', contextHint: '留空也可以出题；填写的情境会用于生成题目。', generate: '生成一题', generating: '正在生成题目…', finishPending: '请先处理上面待确认的偏好。', noGenerated: '没有生成题目，请重试。',
      invitation: '打开默契页时偶尔推荐一道题', invitationHint: '推荐遵守间隔限制；可以随时关闭。', recommended: '本次推荐',
      conflict: '这与之前记住的偏好不同；确认后会替换旧规则。',
    }
    const en = {
      entry: '🎲 Attune', title: 'Tiny attunement tests', intro: 'DSH creates a question for your situation. Choose what fits, then decide whether to save the preference.',
      play: 'Try a test', rules: 'My preferences', close: 'Close', retry: 'Retry', loading: 'Loading…',
      emptyTests: 'No questions have been generated yet. Generate one to begin.', emptyRules: 'No saved preferences yet. Try a test.',
      choose: 'Choose this', learned: 'I may have learned', candidateHint: 'Edit this until it says what you mean, then decide whether to remember it.',
      remember: 'Remember this', session: 'Do not remember this time', reject: 'That is wrong',
      edit: 'Correct', save: 'Save correction', cancel: 'Cancel', remove: 'Delete',
      confirmRemove: 'Confirm deletion', forgetEvidence: 'Also forget the answer that supported this rule',
      evidence: 'Evidence', scopeGlobal: 'Long-term', scopeSession: 'This session',
      done: 'Updated.', help: 'You can correct or delete a preference at any time. Explicit requests take priority.',
      problem: 'Could not complete that action', pending: 'Pending', noProposal: 'This choice was not enough to form a rule. Try another test.',
      how: 'How to answer', selectTest: 'Generated questions', menu: 'Menu',
      contextLabel: 'What are you doing right now?', contextPlaceholder: 'Optional, e.g. planning a trip', contextHint: 'You can leave this blank. A supplied situation helps generate the question.', generate: 'Generate a question', generating: 'Generating a question…', finishPending: 'Resolve the pending preference above first.', noGenerated: 'No question was generated. Please try again.',
      invitation: 'Occasionally suggest a test when I open this page', invitationHint: 'Recommendations respect a cooldown and can be turned off anytime.', recommended: 'Suggested',
      conflict: 'This differs from a saved preference. Confirming will replace the older rule.',
    }

    // Relative to the document's own directory: /ui/ proxies become /ui/api/attune/;
    // Desktop's dsh-app://app/ becomes dsh-app://app/api/attune/.
    const base = new URL('api/attune/', document.baseURI).href
    async function api(path, body) {
      const response = await fetch(base + path, body === undefined
        ? { headers: { accept: 'application/json' }, credentials: 'same-origin' }
        : {
            method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(body),
          })
      const data = await response.json().catch(() => null)
      if (!response.ok || data === null || data.error !== undefined) {
        throw new Error(String(data?.error ?? `HTTP ${response.status}`))
      }
      return data
    }
    const asList = (value, key) => Array.isArray(value) ? value : Array.isArray(value?.[key]) ? value[key] : []
    const nextId = () => typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const labelOf = (value) => typeof value === 'string' ? value : String(value?.label ?? value?.text ?? value?.title ?? value?.id ?? '')
    const evidenceOf = (evidence) => {
      if (typeof evidence === 'string') return evidence
      if (Array.isArray(evidence)) return evidence.map(evidenceOf).filter(Boolean).join(' · ')
      if (evidence && typeof evidence === 'object') {
        return String(evidence.summary ?? evidence.label ?? evidence.testTitle ?? evidence.optionLabel ?? '')
      }
      return ''
    }

    const listeners = new Set()
    let openState = false
    function setOpen(next) {
      openState = Boolean(next)
      for (const notify of listeners) notify(openState)
    }
    function useOpen() {
      const [open, update] = useState(openState)
      useEffect(() => {
        listeners.add(update)
        return () => listeners.delete(update)
      }, [])
      return open
    }

    const css = `
      .at-backdrop{position:fixed;inset:0;z-index:950;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:rgba(12,25,23,.54)}
      .at-dialog{--at-bg:var(--dsw-alias-bg-base,#fffdfa);--at-surface:var(--dsw-alias-bg-layer-1,#f5f7f3);--at-text:var(--dsw-alias-label-primary,#243a34);--at-muted:var(--dsw-alias-label-secondary,#60746e);--at-line:var(--dsw-alias-line,#d4dfd9);--at-accent:#207764;box-sizing:border-box;width:min(920px,100%);height:min(760px,100%);overflow:hidden;display:flex;flex-direction:column;background:var(--at-bg);color:var(--at-text);border:1px solid var(--at-line);border-radius:18px;box-shadow:0 22px 80px rgba(0,0,0,.25);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
      .at-dialog *{box-sizing:border-box}.at-dialog button,.at-dialog textarea{font:inherit}.at-header{padding:18px 22px;border-bottom:1px solid var(--at-line);display:flex;align-items:flex-start;gap:12px}.at-heading{flex:1;min-width:0}.at-title{margin:0;font-size:20px;line-height:1.3}.at-intro{margin:6px 0 0;color:var(--at-muted)}.at-close{min-width:42px;min-height:42px}
      .at-tabs{display:flex;gap:8px;padding:12px 22px;border-bottom:1px solid var(--at-line)}.at-tab{min-height:42px;padding:7px 14px}.at-tab[aria-selected=true]{background:var(--at-accent);color:#fff;border-color:var(--at-accent)}.at-content{flex:1;overflow:auto;padding:22px}.at-main{max-width:750px;margin:auto}.at-card{border:1px solid var(--at-line);border-radius:14px;background:var(--at-surface);padding:17px;margin:0 0 14px}.at-card h3{font-size:16px;margin:0 0 8px}.at-card p{margin:0 0 12px}.at-test-list{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}.at-button,.at-tab{border:1px solid var(--at-line);border-radius:10px;background:var(--at-bg);color:var(--at-text);cursor:pointer}.at-button{padding:10px 14px;min-height:44px;text-align:left}.at-button:hover,.at-tab:hover{border-color:var(--at-accent)}.at-button:disabled{opacity:.55;cursor:not-allowed}.at-button-primary{background:var(--at-accent);border-color:var(--at-accent);color:#fff}.at-button-danger{color:#a62e2e}.at-option{display:block;width:100%;text-align:left;margin:8px 0;padding:14px 16px;min-height:52px}.at-option strong{display:block}.at-option small{display:block;color:var(--at-muted);margin-top:4px}.at-actions{display:flex;flex-wrap:wrap;gap:8px}.at-field{display:block;width:100%;min-height:100px;padding:12px;border:1px solid var(--at-line);border-radius:10px;background:var(--at-bg);color:var(--at-text);resize:vertical;margin:12px 0}.at-note{font-size:12px;color:var(--at-muted)}.at-error{padding:12px 14px;color:#9c2c27;background:#fff0ee;border:1px solid #efc7c2;border-radius:10px;margin-bottom:14px}.at-success{padding:10px 14px;color:#195d42;background:#e5f6eb;border-radius:10px;margin-bottom:14px}.at-rule{border-bottom:1px solid var(--at-line);padding:14px 0}.at-rule:last-child{border-bottom:0}.at-rule-text{white-space:pre-wrap;margin:0 0 8px}.at-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:var(--at-muted);font-size:12px}.at-check{display:flex;align-items:flex-start;gap:8px;margin:12px 0}.at-check input{margin-top:4px}.at-dialog button:focus-visible,.at-dialog textarea:focus-visible,.at-dialog input:focus-visible{outline:2px solid var(--at-accent);outline-offset:2px}
      .at-invite{display:flex;align-items:flex-start;gap:9px;max-width:750px;margin:0 auto 15px}.at-invite input{width:18px;height:18px;margin-top:3px;accent-color:var(--at-accent)}
      @media(max-width:640px){.at-backdrop{padding:0}.at-dialog{width:100%;height:100%;height:100dvh;border:0;border-radius:0}.at-header{padding:15px 16px}.at-tabs{padding:9px 16px}.at-content{padding:16px}.at-title{font-size:18px}.at-test-list{display:grid;grid-template-columns:1fr 1fr}.at-actions{display:grid;grid-template-columns:1fr 1fr}.at-actions .at-button{justify-content:center;text-align:center}.at-option{min-height:56px}}
    `

    function Button({ children, primary, danger, className = '', ...props }) {
      return h('button', { type: 'button', className: `at-button${primary ? ' at-button-primary' : ''}${danger ? ' at-button-danger' : ''}${className ? ` ${className}` : ''}`, ...props }, children)
    }
    function Entry({ t }) {
      const open = useOpen()
      return h('button', {
        type: 'button', onClick: () => setOpen(!open), 'aria-expanded': open,
        style: { display: 'block', width: '100%', minHeight: 42, padding: '8px 12px', border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit' },
      }, t('entry'))
    }

    function Workbench({ t }) {
      const open = useOpen()
      const [tab, setTab] = useState('play')
      const [state, setState] = useState(null)
      const [tests, setTests] = useState([])
      const [testId, setTestId] = useState('')
      const [context, setContext] = useState('')
      const [suggestedId, setSuggestedId] = useState('')
      const [proposal, setProposal] = useState(null)
      const [proposalText, setProposalText] = useState('')
      const [editing, setEditing] = useState('')
      const [editText, setEditText] = useState('')
      const [deleting, setDeleting] = useState('')
      const [forgetEvidence, setForgetEvidence] = useState(false)
      const [busy, setBusy] = useState(false)
      const [loading, setLoading] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const inFlight = useRef(false)
      const dialog = useRef(null)

      const refresh = async () => {
        const [freshState, freshTests] = await Promise.all([api('state'), api('tests')])
        setState(freshState)
        const list = asList(freshTests, 'tests')
        setTests(list)
        setTestId((old) => list.some((item) => item.id === old) ? old : String(list[0]?.id ?? ''))
        return freshState
      }
      useEffect(() => {
        if (!open) return
        let alive = true
        setLoading(true)
        setError('')
        setSuggestedId('')
        Promise.all([api('state'), api('tests')]).then(([freshState, freshTests]) => {
          if (!alive) return
          const list = asList(freshTests, 'tests')
          setState(freshState)
          const pending = asList(freshState, 'proposals').at(-1) ?? null
          setProposal(pending)
          setProposalText(String(pending?.text ?? ''))
          setTests(list)
          setTestId((old) => list.some((item) => item.id === old) ? old : String(list[0]?.id ?? ''))
          setLoading(false)
          if (freshState?.settings?.invitationsEnabled === true) {
            // One recommendation check per panel opening. Refreshing rules or
            // answering a test does not increment the Host's invitation count.
            api('invite', { action: 'next' }).then((result) => {
              if (!alive || !result?.test) return
              const recommendedId = String(result.test.id ?? '')
              if (!list.some((item) => String(item.id) === recommendedId)) {
                setTests((existing) => [...existing, result.test])
              }
              setSuggestedId(recommendedId)
              setTestId(recommendedId)
            }).catch(() => {})
          }
        }).catch((problem) => {
          if (!alive) return
          setError(problem.message)
          setLoading(false)
        })
        queueMicrotask(() => dialog.current?.focus())
        return () => { alive = false }
      }, [open])
      if (!open) return null

      const run = async (action, after) => {
        if (inFlight.current) return
        inFlight.current = true
        setBusy(true)
        setError('')
        setNotice('')
        try {
          const result = await action()
          await refresh()
          after?.(result)
          return result
        } catch (problem) {
          setError(problem.message)
          return null
        } finally {
          inFlight.current = false
          setBusy(false)
        }
      }
      const answer = (item, option) => run(
        () => api('answer', { testId: item.id, optionId: option.id, submissionId: nextId() }),
        (result) => {
          const next = result?.proposal ?? result?.candidate ?? null
          setProposal(next)
          setProposalText(String(next?.text ?? next?.rule ?? ''))
          if (!next) setNotice(t('noProposal'))
        },
      )
      const generate = () => run(
        () => api('generate', { context: context.trim() }),
        (result) => {
          if (!result?.test?.id) {
            setError(t('noGenerated'))
            return
          }
          setTests((existing) => existing.some((item) => String(item.id) === String(result.test.id)) ? existing : [...existing, result.test])
          setTestId(String(result.test.id))
          setSuggestedId('')
          setContext('')
        },
      )
      const decide = (action) => {
        if (!proposal?.id) return
        const editedText = proposalText.trim()
        const body = { proposalId: proposal.id, action }
        if (action === 'remember' && editedText !== String(proposal.text ?? '').trim()) body.text = editedText
        run(() => api('proposal', body), () => {
          setProposal(null)
          setProposalText('')
          setNotice(t('done'))
        })
      }
      const current = tests.find((item) => String(item.id) === testId)
      const rules = asList(state, 'rules')
      const invitationSetting = state?.settings?.invitationsEnabled
      const invitationControl = typeof invitationSetting === 'boolean' ? h('label', { className: 'at-invite' },
        h('input', { type: 'checkbox', checked: invitationSetting, disabled: busy, onChange: (event) => {
          run(() => api('invite', { action: event.target.checked ? 'enable' : 'disable' }), () => setNotice(t('done')))
        } }),
        h('span', null, t('invitation'), h('small', { className: 'at-note', style: { display: 'block' } }, t('invitationHint'))),
      ) : null

      const proposalCard = proposal ? h('section', { className: 'at-card', 'aria-live': 'polite' },
        h('h3', null, t('learned')),
        h('p', { className: 'at-note' }, t('candidateHint')),
        proposal.conflictText ? h('p', { className: 'at-error' }, t('conflict'), h('br'), String(proposal.conflictText)) : null,
        h('textarea', { className: 'at-field', value: proposalText, maxLength: 280, 'aria-label': t('learned'), onChange: (event) => setProposalText(event.target.value) }),
        evidenceOf(proposal.evidence) ? h('p', { className: 'at-note' }, `${t('evidence')}：${evidenceOf(proposal.evidence)}`) : null,
        h('div', { className: 'at-actions' },
          h(Button, { primary: true, disabled: busy || !proposalText.trim(), onClick: () => decide('remember') }, t('remember')),
          h(Button, { disabled: busy || !proposalText.trim(), onClick: () => decide('session') }, t('session')),
          h(Button, { disabled: busy, onClick: () => decide('reject') }, t('reject')),
        ),
      ) : null
      const play = h('div', { className: 'at-main' },
        invitationControl,
        h('section', { className: 'at-card' },
          h('label', { htmlFor: 'dsh-attune-context' }, t('contextLabel')),
          h('textarea', { id: 'dsh-attune-context', className: 'at-field', value: context, maxLength: 240, placeholder: t('contextPlaceholder'), disabled: busy, onChange: (event) => setContext(event.target.value) }),
          h('p', { className: 'at-note' }, t('contextHint')),
          h(Button, { primary: true, disabled: busy || Boolean(proposal), onClick: generate }, busy ? t('generating') : t('generate')),
          proposal ? h('p', { className: 'at-note', style: { marginTop: 10 } }, t('finishPending')) : null,
        ),
        h('p', { className: 'at-note' }, t('selectTest')),
        h('div', { className: 'at-test-list' }, ...tests.map((item) => h(Button, {
          key: item.id, onClick: () => { setTestId(String(item.id)); setNotice('') },
          disabled: busy, 'aria-pressed': String(item.id) === testId,
          style: String(item.id) === testId ? { borderColor: 'var(--at-accent)', color: 'var(--at-accent)' } : undefined,
        }, `${String(item.title ?? item.name ?? item.id)}${String(item.id) === suggestedId ? ` · ${t('recommended')}` : ''}`))),
        proposalCard,
        !proposal && current ? h('section', { className: 'at-card' },
          h('h3', null, String(current.title ?? current.name ?? t('how'))),
          h('p', null, String(current.prompt ?? current.question ?? current.description ?? '')),
          ...asList(current, 'options').map((option, index) => {
            const optionId = typeof option === 'string' ? String(index) : String(option.id ?? index)
            return h(Button, { key: optionId, className: 'at-option', disabled: busy, onClick: () => answer(current, { id: optionId }) },
              h('strong', null, `${String.fromCharCode(65 + index)} · ${labelOf(option)}`),
              option.detail ? h('small', null, String(option.detail)) : null,
            )
          }),
        ) : null,
        !proposal && tests.length === 0 && !loading ? h('p', null, t('emptyTests')) : null,
      )
      const ruleRows = rules.map((rule) => {
        const id = String(rule.id)
        return h('section', { className: 'at-rule', key: id },
          h('p', { className: 'at-rule-text' }, String(rule.text ?? rule.rule ?? '')),
          h('div', { className: 'at-meta' }, h('span', null, rule.scope === 'session' ? t('scopeSession') : t('scopeGlobal')),
            evidenceOf(rule.evidence) ? h('span', null, `${t('evidence')}：${evidenceOf(rule.evidence)}`) : null),
          editing === id ? h('div', null,
            h('textarea', { className: 'at-field', value: editText, maxLength: 280, 'aria-label': t('edit'), onChange: (event) => setEditText(event.target.value) }),
            h('div', { className: 'at-actions' },
              h(Button, { primary: true, disabled: busy || !editText.trim(), onClick: () => run(() => api('rule', { ruleId: id, action: 'edit', text: editText.trim() }), () => { setEditing(''); setNotice(t('done')) }) }, t('save')),
              h(Button, { disabled: busy, onClick: () => setEditing('') }, t('cancel')),
            ),
          ) : null,
          deleting === id ? h('div', null,
            h('label', { className: 'at-check' }, h('input', { type: 'checkbox', checked: forgetEvidence, onChange: (event) => setForgetEvidence(event.target.checked) }), t('forgetEvidence')),
            h('div', { className: 'at-actions' },
              h(Button, { danger: true, disabled: busy, onClick: () => run(() => api('rule', { ruleId: id, action: 'delete', forgetEvidence }), () => { setDeleting(''); setForgetEvidence(false); setNotice(t('done')) }) }, t('confirmRemove')),
              h(Button, { disabled: busy, onClick: () => { setDeleting(''); setForgetEvidence(false) } }, t('cancel')),
            ),
          ) : null,
          editing !== id && deleting !== id ? h('div', { className: 'at-actions', style: { marginTop: 12 } },
            h(Button, { disabled: busy, onClick: () => { setEditing(id); setEditText(String(rule.text ?? rule.rule ?? '')); setDeleting('') } }, t('edit')),
            h(Button, { danger: true, disabled: busy, onClick: () => { setDeleting(id); setForgetEvidence(false); setEditing('') } }, t('remove')),
          ) : null,
        )
      })
      const rulePanel = h('div', { className: 'at-main' }, rules.length ? h('div', { className: 'at-card' }, ...ruleRows) : h('p', null, t('emptyRules')),
        h('p', { className: 'at-note' }, t('help')))
      return h('div', { className: 'at-backdrop', onMouseDown: (event) => { if (event.target === event.currentTarget) setOpen(false) } },
        h('style', null, css),
        h('div', { className: 'at-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': t('title'), tabIndex: -1, ref: dialog, onKeyDown: (event) => { if (event.key === 'Escape') setOpen(false) } },
          h('header', { className: 'at-header' },
            h('div', { className: 'at-heading' }, h('h2', { className: 'at-title' }, t('title')), h('p', { className: 'at-intro' }, t('intro'))),
            h(Button, { className: 'at-close', 'aria-label': t('close'), onClick: () => setOpen(false) }, '×'),
          ),
          h('div', { className: 'at-tabs', role: 'tablist' },
            h('button', { type: 'button', className: 'at-tab', role: 'tab', 'aria-selected': tab === 'play', onClick: () => setTab('play') }, t('play')),
            h('button', { type: 'button', className: 'at-tab', role: 'tab', 'aria-selected': tab === 'rules', onClick: () => setTab('rules') }, t('rules')),
          ),
          h('div', { className: 'at-content' },
            error ? h('div', { className: 'at-error', role: 'alert' }, `${t('problem')}：${error} `, h(Button, { onClick: () => { setError(''); setLoading(true); refresh().catch((e) => setError(e.message)).finally(() => setLoading(false)) } }, t('retry'))) : null,
            notice ? h('div', { className: 'at-success', role: 'status' }, notice) : null,
            loading ? h('p', { className: 'at-main' }, t('loading')) : tab === 'play' ? play : rulePanel,
          ),
        ),
      )
    }

    exports.name = 'dsh-attune'
    exports.inject = ['slots', 'locale']
    exports.apply = (ctx) => {
      ctx.effect(() => ctx.locale.register('dsh-attune', { zh, en }), 'dsh-attune: i18n')
      const t = ctx.locale.bind('dsh-attune')
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
        { name: 'sidebar.footer.action', id: 'dsh-attune', order: 12, label: () => t('entry') },
        (props) => h(Entry, { ...props, t }),
      ))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'dsh-attune-overlay', order: 26 },
        (props) => h(Workbench, { ...props, t }),
      ))
    }
    return module.exports
  },
})
