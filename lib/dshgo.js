import { randomUUID } from 'node:crypto'
import { GENERAL } from './personas.js'

// DSH Go executes this adapter in the DSH Host. Its Android app receives only
// a bounded JSON view; it never executes plugin JavaScript.
const PANEL_ID = 'attune'
// Keep the combined native form within DSH Go's 4 KiB UTF-8 input budget.
const NATIVE_EXCERPT_CHARS = 750
const NATIVE_FEEDBACK_CHARS = 160
const TEXT = {
  zh: {
    title: '大肥鱼的默契小屋',
    hint: '闲下来，陪大肥鱼玩一道小题吧。选完再决定要不要记住。',
    hello: '🐳 今天想让我多了解你一点吗？',
    thinking: '🐳 容我想一道新题……',
    reviewing: '🐳 我这样理解你，对吗？',
    ready: '🐳 小题送到，选你更喜欢的就好。',
    tone: '教我怎么问',
    toneHint: '称呼、语气、邀请方式，都可以慢慢教给我。',
    toneContext: '想调整哪种问法？（可选）',
    toneContextHint: '例如：喜欢俏皮一点，但少用叠词',
    toneLabel: '提问方式',
    preferenceLabel: '相处偏好',
    noQuestion: '还没有题目。可以写下当前情境，再点「生成一题」。',
    generate: '生成一题',
    generating: '正在出题',
    generated: '新题来了。',
    context: '当前情境（可选）',
    contextHint: '例如：我想先聊想法，再讨论具体方案',
    excerpt: '粘贴要回顾的片段',
    feedback: '哪里不太顺？（选填）',
    fromExcerpt: '根据选段出题',
    excerptHint: '复制一段对话或工作内容再贴到这里。出题时会把选段和补充发给 DSH 配置的模型。',
    missingExcerpt: '请先粘贴一段对话或工作内容。',
    general: '通用偏好',
    choosePersonas: '请选择人格，再点下方确认。',
    rememberScopes: '记给选中的人格',
    rememberReplace: '确认更新所选人格的同类偏好',
    scopeConflict: '已有偏好',
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
    title: 'Attune · Little whale nook',
    hint: 'Have a quiet moment? Try a little question, then decide what to remember.',
    hello: '🐳 Shall we get to know each other a little better?',
    thinking: '🐳 Thinking up a fresh little question…',
    reviewing: '🐳 Did I understand you correctly?',
    ready: '🐳 Your little question is ready. Pick what feels right.',
    tone: 'Teach me how to ask',
    toneHint: 'Teach me your preferred tone, address, and invitations.',
    toneContext: 'Which wording should change? (optional)',
    toneContextHint: 'For example: playful, with fewer pet names',
    toneLabel: 'Question style',
    preferenceLabel: 'Working preferences',
    noQuestion: 'No question yet. Add a situation and tap Generate.',
    generate: 'Generate',
    generating: 'Generating',
    generated: 'New question ready.',
    context: 'Current situation (optional)',
    contextHint: 'For example: explore an idea before discussing a plan',
    excerpt: 'Paste the excerpt to review',
    feedback: 'What felt off? (optional)',
    fromExcerpt: 'Make a quiz from the excerpt',
    excerptHint: 'Copy part of a conversation or work item. Generating sends it and your notes to the model configured in DSH.',
    missingExcerpt: 'Paste part of a conversation or work item first.',
    general: 'General preferences',
    choosePersonas: 'Select personas, then confirm below.',
    rememberScopes: 'Remember for selected personas',
    rememberReplace: 'Confirm updates for the selected personas',
    scopeConflict: 'Existing preference',
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
  const toneGenerator = contextInput
    ? { type: 'form', submit: 'generate-tone', submitLabel: t.tone, children: [
        { type: 'textField', label: t.toneContext, placeholder: t.toneContextHint,
          bind: 'data.form.toneContext', maxLength: 200 },
      ] }
    : { type: 'actions', items: [{ label: t.tone, action: 'generate-tone', icon: 'puzzle' }] }
  return {
    v: contextInput ? 2 : 1,
    type: 'stack',
    title: t.title,
    children: [
      { type: 'callout', text: bound('companion'), tone: 'info' },
      { type: 'text', text: t.hint },
      generator,
      ...(contextInput ? [
        { type: 'text', text: t.excerptHint },
        { type: 'form', submit: 'generate-excerpt', submitLabel: t.fromExcerpt, children: [
          { type: 'textField', label: t.excerpt, bind: 'data.form.excerpt', required: true,
            multiline: true, maxLength: NATIVE_EXCERPT_CHARS },
          { type: 'textField', label: t.feedback, bind: 'data.form.excerptFeedback', maxLength: NATIVE_FEEDBACK_CHARS },
        ] },
      ] : []),
      { type: 'text', text: t.toneHint },
      toneGenerator,
      { type: 'text', text: bound('question') },
      { type: 'options', id: 'choose', options: bound('options') },
      { type: 'callout', text: t.pending, tone: 'info' },
      { type: 'text', text: bound('proposal') },
      { type: 'list', items: bound('personaRows') },
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
    const assignments = new Map()

    const choicesFor = (state, locale) => [
      { id: GENERAL, name: words(locale).general },
      ...array(state.personas).filter((persona) => !persona.paused),
    ]
    const selectedFor = (scope, proposal, choices) => {
      const draft = assignments.get(keyOf(scope))
      const ids = draft?.proposalId === proposal.id ? draft.ids : proposal.suggestedPersonaIds
      return array(ids).filter((id) => choices.some((choice) => choice.id === id))
    }

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
      const choices = choicesFor(state, locale)
      const scoped = proposal?.suggestedPersonaIds !== undefined
      const selected = scoped ? selectedFor(scope, proposal, choices) : []
      const conflicts = scoped ? array(proposal.existingRules).filter((rule) =>
        rule.personaIds.some((id) => selected.includes(id))) : []
      const personaRows = scoped ? choices.map((persona) => {
        const conflict = conflicts.find((rule) => rule.personaIds.includes(persona.id))
        return {
          title: `${selected.includes(persona.id) ? '✓' : '○'} ${persona.name}`,
          subtitle: conflict ? `${t.scopeConflict}：${conflict.text.slice(0, 160)}` : persona.when?.slice(0, 100),
          action: { id: 'select-persona', args: { proposalId: proposal.id, personaId: persona.id } },
        }
      }) : []
      if (selected.length) personaRows.push({
        title: conflicts.length ? t.rememberReplace : t.rememberScopes,
        action: { id: 'remember-scoped', args: {
          proposalId: proposal.id, personaIds: selected, replaceRuleIds: conflicts.map((rule) => rule.id),
        } },
      })
      const error = errors.get(keyOf(scope))
      const rules = array(state?.rules).slice(0, 20)
      const ruleRows = rules.flatMap((rule) => [
        {
          title: `✏ ${String(rule.text ?? '').slice(0, 110)}`,
          subtitle: `${rule.topic === 'tone' ? t.toneLabel : t.preferenceLabel} · ${t.source}：${String(array(rule.evidence)[0] ?? '').slice(0, 140)}`,
          action: { id: 'edit-rule', args: { ruleId: rule.id } },
        },
        {
          title: `🗑 ${String(rule.text ?? '').slice(0, 80)}`,
          subtitle: `${rule.topic === 'tone' ? t.toneLabel : t.preferenceLabel} · ${t.source}：${String(array(rule.evidence)[0] ?? '').slice(0, 140)}`,
          action: { id: 'delete-rule', args: { ruleId: rule.id } },
        },
      ])
      if (ruleRows.length === 0) ruleRows.push({ title: t.empty })
      return {
        form: { context: '', toneContext: '' },
        companion: busy.has(keyOf(scope)) ? t.thinking : proposal ? t.reviewing : test ? t.ready : t.hello,
        question: error
          ? `${error}${test ? `\n${test.title ?? ''}\n${test.prompt ?? ''}` : ''}`
          : test ? `${test.topic === 'tone' ? `${t.toneLabel} · ` : ''}${test.title ?? ''}\n${test.prompt ?? ''}` : t.noQuestion,
        options: (busy.has(keyOf(scope)) ? [] : array(test?.options)).slice(0, 8).map((option) => ({
          label: String(option.label ?? option.id ?? '').slice(0, 200),
          description: option.detail ? String(option.detail).slice(0, 200) : undefined,
          value: String(option.id),
        })),
        proposal: proposal
          ? [
            `${proposal.topic === 'tone' ? `${t.toneLabel} · ` : ''}${String(proposal.text ?? '').slice(0, 280)}`,
            `${t.source}：${String(proposal.evidence ?? '').slice(0, 180)}`,
            ...(scoped ? [t.choosePersonas] : []),
          ].join('\n')
          : t.noPending,
        personaRows,
        ruleRows,
      }
    }

    const broadcast = async () => {
      await Promise.allSettled([...subscriptions].map(async ({ scope, emit, locale }) => {
        emit(await dataFor(scope, locale))
      }))
    }
    const generate = (scope, event, mode = 'preference') => {
      const t = words(event?.locale)
      const key = keyOf(scope)
      if (busy.has(key)) return { toast: t.busy }
      if (typeof engine.generateTest !== 'function') return { toast: t.failed }
      const values = event?.value?.values
      const topic = mode === 'tone' ? 'tone' : 'preference'
      const raw = values?.[topic === 'tone' ? 'data.form.toneContext' : 'data.form.context']
      const context = typeof raw === 'string' ? raw.trim().slice(0, 200) : ''
      const excerpt = values?.['data.form.excerpt']
      if (mode === 'excerpt' && (typeof excerpt !== 'string' || !excerpt.trim())) return { toast: t.missingExcerpt }
      const request = mode === 'excerpt'
        ? { review: { excerpt, feedback: values?.['data.form.excerptFeedback'] } }
        : { context, topic }
      busy.add(key)
      return {
        pending: { label: t.generating, timeoutMs: 60_000 },
        result: async (signal) => {
          try {
            if (signal?.aborted) return undefined
            if (activeProposal(await engine.getState())) return { toast: t.reviewFirst }
            await broadcast()
            const result = await engine.generateTest({ ...request, signal })
            if (signal?.aborted) return undefined
            const tests = array(engine.listTests())
            const index = tests.findIndex((test) => test.id === result?.test?.id)
            if (index >= 0) indices.set(key, index)
            errors.delete(key)
            return { toast: t.generated }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            errors.set(key, message.slice(0, 200))
            return { toast: message.slice(0, 40) || t.failed }
          } finally {
            busy.delete(key)
            await broadcast()
          }
        },
      }
    }
    bridge.panel(PANEL_ID, {
      view: (_scope, caps) => view(caps?.locale, caps),
      data: (scope, emit, caps) => {
        const sub = { scope, emit, locale: caps?.locale }
        subscriptions.add(sub)
        void dataFor(scope, caps?.locale).then(emit).catch(() => emit({
          question: words(caps?.locale).failed,
          companion: words(caps?.locale).hello,
          form: { context: '', toneContext: '' },
          options: [],
          proposal: words(caps?.locale).noPending,
          personaRows: [],
          ruleRows: [],
        }))
        return () => subscriptions.delete(sub)
      },
      actions: {
        generate: (scope, event) => generate(scope, event),
        'generate-tone': (scope, event) => generate(scope, event, 'tone'),
        'generate-excerpt': (scope, event) => generate(scope, event, 'excerpt'),
        choose: async (scope, event) => {
          const test = current(scope)
          const optionId = event?.value?.value
          const t = words(event?.locale)
          if (busy.has(keyOf(scope))) return { toast: t.busy }
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
          if (proposal.suggestedPersonaIds !== undefined) return { toast: t.choosePersonas }
          await engine.decide({ proposalId: proposal.id, action: 'remember', scope: 'global' })
          await broadcast()
          return { toast: t.saved }
        },
        'select-persona': async (scope, event) => {
          const t = words(event?.locale)
          const state = await engine.getState()
          const proposal = activeProposal(state)
          const { proposalId, personaId } = event?.value ?? {}
          if (!proposal || proposal.suggestedPersonaIds === undefined || proposal.id !== proposalId) return { toast: t.noProposal }
          const choices = choicesFor(state, event?.locale)
          if (!choices.some((choice) => choice.id === personaId)) return { toast: t.choosePersonas }
          const selected = selectedFor(scope, proposal, choices)
          const ids = selected.includes(personaId) ? selected.filter((id) => id !== personaId)
            : personaId === GENERAL ? [GENERAL] : [...selected.filter((id) => id !== GENERAL), personaId]
          assignments.set(keyOf(scope), { proposalId, ids })
          if (assignments.size > 32) assignments.delete(assignments.keys().next().value)
          await broadcast()
        },
        'remember-scoped': async (scope, event) => {
          const t = words(event?.locale)
          const { proposalId, personaIds, replaceRuleIds } = event?.value ?? {}
          const proposal = activeProposal(await engine.getState())
          if (!proposal || proposal.id !== proposalId || proposal.suggestedPersonaIds === undefined) return { toast: t.noProposal }
          try {
            await engine.decide({ proposalId, action: 'remember', personaIds, replaceRuleIds })
          } catch (error) {
            await broadcast()
            return { toast: String(error?.message ?? t.failed).slice(0, 40) }
          }
          assignments.delete(keyOf(scope))
          await broadcast()
          return { toast: t.saved }
        },
        reject: async (_scope, event) => {
          const t = words(event?.locale)
          const proposal = activeProposal(await engine.getState())
          if (!proposal) return { toast: t.noProposal }
          await engine.decide({ proposalId: proposal.id, action: 'reject' })
          assignments.delete(keyOf(_scope))
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
