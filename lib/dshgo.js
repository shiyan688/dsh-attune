import { randomUUID } from 'node:crypto'

// DSH Go executes this adapter in the DSH Host. Its Android app receives only
// a bounded JSON view; it never executes plugin JavaScript.
const PANEL_ID = 'attune'
const TEXT = {
  zh: {
    title: '默契小实验',
    hint: '选一个更顺眼的答案，稍后决定要不要记住。',
    noQuestion: '还没有题目。可以写下当前情境，再点「生成一题」。',
    generate: '生成一题',
    generating: '正在出题',
    generated: '新题来了。',
    context: '当前情境（可选）',
    contextHint: '例如：正在决定周末怎么安排',
    busy: '上一题还在生成，请稍等。',
    pending: '待你确认的习惯',
    source: '选择依据',
    noPending: '还没有待确认的习惯。',
    rules: '已记住的习惯（点一条可改或删除）',
    empty: '还没有已记住的习惯。',
    next: '换一题',
    remember: '记住这个',
    reject: '理解错了',
    questionDone: '已记录选择，请查看待确认的习惯。',
    saved: '已记住。',
    rejected: '已放弃这条推断。',
    noProposal: '先回答一道小题。',
    noAnswer: '选项已变化，请刷新面板。',
    reviewFirst: '请先确认或放弃上一条候选习惯。',
    editHint: '修正命令已放进输入框，请写上正确说法后发送。',
    deleteHint: '删除命令已放进输入框，发送后才会删除。',
    failed: '暂时读不到偏好，请稍后再试。',
  },
  en: {
    title: 'Attune',
    hint: 'Pick the answer you like, then decide whether to remember it.',
    noQuestion: 'No question yet. Add a situation and tap Generate.',
    generate: 'Generate',
    generating: 'Generating',
    generated: 'New question ready.',
    context: 'Current situation (optional)',
    contextHint: 'For example: planning my weekend',
    busy: 'A question is still being generated.',
    pending: 'Awaiting your confirmation',
    source: 'From your choice',
    noPending: 'No preference awaiting confirmation.',
    rules: 'Remembered preferences (tap to edit or delete)',
    empty: 'No remembered preferences yet.',
    next: 'Another test',
    remember: 'Remember',
    reject: 'Not right',
    questionDone: 'Choice saved. Review the suggested preference.',
    saved: 'Remembered.',
    rejected: 'Suggestion discarded.',
    noProposal: 'Answer a question first.',
    noAnswer: 'The choices changed. Refresh this panel.',
    reviewFirst: 'Confirm or dismiss the previous suggestion first.',
    editHint: 'Edit command inserted. Add the right wording and send it.',
    deleteHint: 'Delete command inserted. Send it to confirm deletion.',
    failed: 'Preferences are temporarily unavailable. Try again.',
  },
}

function words(locale) {
  return locale?.startsWith('en') ? TEXT.en : TEXT.zh
}

function keyOf(scope) {
  return typeof scope?.sessionId === 'string' ? scope.sessionId : ''
}

function array(value) {
  return Array.isArray(value) ? value : []
}

function activeProposal(state) {
  return array(state?.proposals).find((proposal) => proposal?.status === 'pending') ?? null
}

function view(locale, caps = {}) {
  const t = words(locale)
  const bound = (path) => ({ $: `data.${path}` })
  const contextInput = caps.components?.includes('form') && caps.components?.includes('textField')
  const generator = contextInput
    ? { type: 'form', submit: 'generate', submitLabel: t.generate, children: [
        { type: 'textField', label: t.context, placeholder: t.contextHint,
          bind: 'data.form.context', maxLength: 200 },
      ] }
    : { type: 'actions', items: [{ label: t.generate, action: 'generate', icon: 'puzzle', style: 'primary' }] }
  return {
    v: contextInput ? 2 : 1,
    type: 'stack',
    title: t.title,
    children: [
      { type: 'text', text: t.hint },
      generator,
      { type: 'text', text: bound('question') },
      { type: 'options', id: 'choose', options: bound('options') },
      { type: 'callout', text: t.pending, tone: 'info' },
      { type: 'text', text: bound('proposal') },
      { type: 'actions', items: [
        { label: t.remember, action: 'remember', icon: 'check', style: 'primary' },
        { label: t.reject, action: 'reject', icon: 'remove' },
      ] },
      { type: 'callout', text: t.rules, tone: 'good' },
      { type: 'list', items: bound('ruleRows') },
    ],
  }
}

/**
 * Register the optional DSH Go native panel. The caller also registers
 * standard DSH slash commands, which cover DSH Go's SSH and relay modes.
 * This bridge is deliberately optional: the same package runs on ordinary
 * DSH Web, Desktop, DSHA, Whaleness, and headless hosts without it.
 */
export function registerDshGo(ctx, engine) {
  if (typeof ctx?.inject !== 'function') return
  ctx.inject(['dshGo'], (owner) => {
    const bridge = owner?.dshGo
    if (typeof bridge?.panel !== 'function') return
    const indices = new Map()
    const errors = new Map()
    const busy = new Set()
    const subscriptions = new Set()

    const current = (scope) => {
      const tests = array(engine.listTests())
      if (tests.length === 0) return null
      return tests[(indices.get(keyOf(scope)) ?? tests.length - 1) % tests.length]
    }
    const dataFor = async (scope, locale) => {
      const t = words(locale)
      const state = await engine.getState()
      const test = current(scope)
      const proposal = activeProposal(state)
      const error = errors.get(keyOf(scope))
      const rules = array(state?.rules).slice(0, 20)
      const ruleRows = rules.flatMap((rule) => [
        {
          title: `✏ ${String(rule.text ?? '').slice(0, 110)}`,
          subtitle: `${t.source}：${String(array(rule.evidence)[0] ?? '').slice(0, 140)}`,
          action: { id: 'edit-rule', args: { ruleId: rule.id } },
        },
        {
          title: `🗑 ${String(rule.text ?? '').slice(0, 80)}`,
          subtitle: `${t.source}：${String(array(rule.evidence)[0] ?? '').slice(0, 140)}`,
          action: { id: 'delete-rule', args: { ruleId: rule.id } },
        },
      ])
      if (ruleRows.length === 0) ruleRows.push({ title: t.empty })
      return {
        form: { context: '' },
        question: error
          ? `${error}${test ? `\n${test.title ?? ''}\n${test.prompt ?? ''}` : ''}`
          : test ? `${test.title ?? ''}\n${test.prompt ?? ''}` : t.noQuestion,
        options: array(test?.options).slice(0, 8).map((option) => ({
          label: String(option.label ?? option.id ?? '').slice(0, 200),
          description: option.detail ? String(option.detail).slice(0, 200) : undefined,
          value: String(option.id),
        })),
        proposal: proposal
          ? `${String(proposal.text ?? '').slice(0, 280)}\n${t.source}：${String(proposal.evidence ?? '').slice(0, 180)}`
          : t.noPending,
        ruleRows,
      }
    }

    const broadcast = async () => {
      await Promise.allSettled([...subscriptions].map(async ({ scope, emit, locale }) => {
        emit(await dataFor(scope, locale))
      }))
    }
    bridge.panel(PANEL_ID, {
      view: (_scope, caps) => view(caps?.locale, caps),
      data: (scope, emit, caps) => {
        const sub = { scope, emit, locale: caps?.locale }
        subscriptions.add(sub)
        void dataFor(scope, caps?.locale).then(emit).catch(() => emit({
          question: words(caps?.locale).failed,
          form: { context: '' },
          options: [],
          proposal: words(caps?.locale).noPending,
          ruleRows: [],
        }))
        return () => subscriptions.delete(sub)
      },
      actions: {
        generate: (scope, event) => {
          const t = words(event?.locale)
          const key = keyOf(scope)
          if (busy.has(key)) return { toast: t.busy }
          if (typeof engine.generateTest !== 'function') return { toast: t.failed }
          const raw = event?.value?.values?.['data.form.context']
          const context = typeof raw === 'string' ? raw.trim().slice(0, 200) : ''
          busy.add(key)
          return {
            pending: { label: t.generating, timeoutMs: 60_000 },
            result: async (signal) => {
              try {
                if (signal?.aborted) return undefined
                const result = await engine.generateTest({ context, signal })
                if (signal?.aborted) return undefined
                const tests = array(engine.listTests())
                const index = tests.findIndex((test) => test.id === result?.test?.id)
                if (index >= 0) indices.set(key, index)
                errors.delete(key)
                await broadcast()
                return { toast: t.generated }
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                errors.set(key, message.slice(0, 200))
                await broadcast()
                return { toast: message.slice(0, 40) || t.failed }
              } finally {
                busy.delete(key)
              }
            },
          }
        },
        choose: async (scope, event) => {
          const test = current(scope)
          const optionId = event?.value?.value
          const t = words(event?.locale)
          if (!test || !array(test.options).some((option) => option.id === optionId)) {
            return { toast: t.noAnswer }
          }
          if (activeProposal(await engine.getState())) return { toast: t.reviewFirst }
          await engine.answer({ testId: test.id, optionId, submissionId: randomUUID() })
          await broadcast()
          return { toast: t.questionDone }
        },
        remember: async (_scope, event) => {
          const t = words(event?.locale)
          const proposal = activeProposal(await engine.getState())
          if (!proposal) return { toast: t.noProposal }
          await engine.decide({ proposalId: proposal.id, action: 'remember', scope: 'global' })
          await broadcast()
          return { toast: t.saved }
        },
        reject: async (_scope, event) => {
          const t = words(event?.locale)
          const proposal = activeProposal(await engine.getState())
          if (!proposal) return { toast: t.noProposal }
          await engine.decide({ proposalId: proposal.id, action: 'reject' })
          await broadcast()
          return { toast: t.rejected }
        },
        'edit-rule': (_scope, event) => {
          const ruleId = String(event?.value?.ruleId ?? '')
          if (!/^[a-zA-Z0-9_-]{1,80}$/.test(ruleId)) return { toast: words(event?.locale).failed }
          return [
            { insert: `/attune correct ${ruleId} ` },
            { toast: words(event?.locale).editHint },
          ]
        },
        'delete-rule': (_scope, event) => {
          const ruleId = String(event?.value?.ruleId ?? '')
          if (!/^[a-zA-Z0-9_-]{1,80}$/.test(ruleId)) return { toast: words(event?.locale).failed }
          return [
            { insert: `/attune delete ${ruleId}` },
            { toast: words(event?.locale).deleteHint },
          ]
        },
      },
    })
  })
}

export const __dshGoInternals = { activeProposal, view, words }
