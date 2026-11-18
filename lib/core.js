import { mkdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { dimensionsFor, normalizeExcerptReview, normalizeTopic } from './generator.js'
import { GENERAL, MAX_PERSONAS, STARTER_PERSONAS, personaFields, ruleScopes, selectScopes, suggestedScopes } from './personas.js'
import { MIN_FEEDBACK_GROUPS, publicReview, reviewInput, reviewSignature, validatePlan } from './persona-review.js'

const VERSION = 1
const MAX_RULES_IN_PROMPT = 8
const MAX_PROMPT_CHARS = 900
const LOCK_STALE_MS = 120_000
const newPublicId = () => randomBytes(9).toString('base64url')
const topicOf = (item) => item.topic === 'tone' ? 'tone' : 'preference'
const samePreference = (left, right) => topicOf(left) === topicOf(right) && left.dimension === right.dimension

function initialState() {
  return {
    version: VERSION,
    revision: 0,
    tests: [],
    rules: [],
    proposals: [],
    answers: [],
    personas: STARTER_PERSONAS.map((persona) => ({ ...persona, paused: false })),
    receipts: {},
    settings: { invitationsEnabled: false, lastInvitationAt: null, invitationDates: [], invitedTestIds: [] },
  }
}

function validState(data) {
  if (!data || data.version !== VERSION || !Array.isArray(data.rules) ||
      !Array.isArray(data.proposals) || !Array.isArray(data.answers) ||
      !data.receipts || typeof data.receipts !== 'object' || !data.settings) {
    throw new Error('偏好档案格式不受支持；原文件已保留，请先备份并检查版本。')
  }
  if (!Array.isArray(data.tests)) data.tests = []
  if (data.personas === undefined) data.personas = initialState().personas
  if (!Array.isArray(data.personas)) throw new Error('人格档案格式不受支持')
  if (!Array.isArray(data.settings.invitedTestIds)) data.settings.invitedTestIds = []
  return data
}

function safeId(value, name) {
  if (typeof value !== 'string' || !/^[\w-]{1,120}$/.test(value)) {
    throw new Error(`${name} 无效`)
  }
  return value
}

function cleanText(value) {
  if (typeof value !== 'string') throw new Error('请填写偏好内容')
  const result = value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  if (result.length < 4 || result.length > 280) throw new Error('偏好内容须为 4～280 个字符')
  return result
}

function nowIso(now) {
  const date = now()
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('时间来源无效')
  return date.toISOString()
}

function evidenceFor(answer) {
  return `${answer.title}：${answer.optionLabel}`
}

function publicTest(test) {
  return {
    id: test.id, topic: topicOf(test), dimension: test.dimension, title: test.title, prompt: test.prompt,
    options: test.options.map(({ id, label, detail }) => ({ id, label, detail })),
  }
}

function matchingRules(rules, proposal, scopes) {
  return rules.filter((rule) => samePreference(rule, proposal) &&
    (topicOf(proposal) === 'tone' || ruleScopes(rule).some((id) => scopes.includes(id))))
}

function sameScopeSet(rule, scopes) {
  return ruleScopes(rule).length === scopes.length && ruleScopes(rule).every((id) => scopes.includes(id))
}

function publicProposal(proposal, state) {
  const scoped = topicOf(proposal) === 'preference'
  return {
    id: proposal.id,
    testId: proposal.testId,
    topic: topicOf(proposal),
    dimension: proposal.dimension,
    text: proposal.text,
    evidence: proposal.evidence,
    status: 'pending',
    conflictText: proposal.conflictText ?? null,
    reinforcesRuleId: proposal.reinforcesRuleId ?? null,
    replacesRuleId: proposal.replacesRuleId ?? null,
    createdAt: proposal.createdAt,
    ...(scoped ? {
      ...(proposal.suggestedPersonaIds !== undefined ? {
        suggestedPersonaIds: suggestedScopes(proposal.suggestedPersonaIds, state.personas),
      } : {}),
      existingRules: state.rules.filter((rule) => samePreference(rule, proposal)).map((rule) => ({
        id: rule.id, text: rule.text, personaIds: ruleScopes(rule),
        sameMode: rule.mode === proposal.mode,
      })),
    } : {}),
  }
}

function publicRule(rule, answers) {
  return {
    id: rule.id,
    text: rule.text,
    scope: 'global',
    topic: topicOf(rule),
    dimension: rule.dimension,
    ...(topicOf(rule) === 'preference' ? { personaIds: ruleScopes(rule) } : {}),
    evidence: rule.sourceIds.map((id) => answers.find((a) => a.id === id)).filter(Boolean).map(evidenceFor),
    confirmedAt: rule.confirmedAt,
    correctedAt: rule.correctedAt ?? null,
  }
}

function publicState(state) {
  return {
    revision: state.revision,
    rules: state.rules.map((rule) => publicRule(rule, state.answers)),
    proposals: state.proposals.map((proposal) => publicProposal(proposal, state)),
    personas: state.personas.map((persona) => ({ ...persona })),
    personaSuggestion: publicReview(state),
    answersCount: state.answers.length,
    answeredTestIds: [...new Set(state.answers.map((answer) => answer.testId))],
    settings: {
      invitationsEnabled: state.settings.invitationsEnabled === true,
      lastInvitationAt: state.settings.lastInvitationAt ?? null,
    },
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Small, dependency-free file store. A lock directory serializes writes even
 * when Web and Desktop point at the same DSH_HOME in different processes.
 * Data is written to a sibling file and atomically renamed after validation.
 */
export function createAttuneEngine({ filePath, now = () => new Date(), generateQuestion, recommendPersonas }) {
  if (typeof filePath !== 'string' || filePath.trim() === '') throw new Error('需要偏好档案文件路径')
  const lockPath = `${filePath}.lock`

  async function readState() {
    try {
      return validState(JSON.parse(await readFile(filePath, 'utf8')))
    } catch (error) {
      if (error?.code === 'ENOENT') return initialState()
      throw error
    }
  }

  function readStateSync() {
    try {
      return validState(JSON.parse(readFileSync(filePath, 'utf8')))
    } catch (error) {
      if (error?.code === 'ENOENT') return initialState()
      throw error
    }
  }

  async function lock() {
    await mkdir(dirname(filePath), { recursive: true })
    const deadline = Date.now() + 6000
    for (;;) {
      try {
        await mkdir(lockPath)
        return
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
      }
      const info = await stat(lockPath).catch(() => null)
      if (info && Date.now() - info.mtimeMs > LOCK_STALE_MS) {
        await rmdir(lockPath).catch(() => {})
      }
      if (Date.now() > deadline) throw new Error('偏好档案正被另一个 DSH 进程使用，请稍后再试')
      await delay(25)
    }
  }

  async function writeState(state) {
    state.revision += 1
    const temp = `${filePath}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, JSON.stringify(state, null, 2), { encoding: 'utf8', flag: 'wx' })
      await rename(temp, filePath)
    } finally {
      await rm(temp, { force: true }).catch(() => {})
    }
  }

  async function change(mutator) {
    await lock()
    try {
      const state = await readState()
      const result = await mutator(state)
      await writeState(state)
      return result
    } finally {
      await rmdir(lockPath).catch(() => {})
    }
  }

  async function answer({ testId, optionId, submissionId }) {
    safeId(testId, 'testId')
    safeId(optionId, 'optionId')
    const receiptId = submissionId == null ? randomUUID() : safeId(submissionId, 'submissionId')
    return change((state) => {
      const previous = state.receipts[receiptId]
      if (previous) {
        if (previous.forgotten === true) return { proposal: null, repeated: true }
        if (previous.testId !== testId || previous.optionId !== optionId) throw new Error('同一提交编号不能改成另一个答案')
        const proposal = state.proposals.find((p) => p.id === previous.proposalId)
        return { proposal: proposal ? publicProposal(proposal, state) : null, repeated: true }
      }
      const test = state.tests.find((item) => item.id === testId)
      const option = test?.options.find((item) => item.id === optionId)
      if (!test || !option) throw new Error('找不到这个题目或选项，请重新生成题目')

      const at = nowIso(now)
      const answer = {
        id: randomUUID(), submissionId: receiptId, testId, optionId,
        topic: topicOf(test), dimension: test.dimension, title: test.title,
        optionLabel: option.label, at,
        ...(test.feedbackGroup ? { feedbackGroup: test.feedbackGroup } : {}),
      }
      const suggestions = test.suggestedPersonaIds === undefined ? undefined : suggestedScopes(test.suggestedPersonaIds, state.personas)
      const existing = matchingRules(state.rules, test, suggestions ?? [GENERAL])[0]
      const proposal = {
        id: newPublicId(), testId, answerId: answer.id,
        topic: topicOf(test), dimension: test.dimension, mode: option.mode,
        text: option.rule, evidence: evidenceFor(answer),
        conflictText: suggestions === undefined && existing && existing.mode !== option.mode ? existing.text : null,
        reinforcesRuleId: existing && existing.mode === option.mode ? existing.id : null,
        replacesRuleId: existing && existing.mode !== option.mode ? existing.id : null,
        createdAt: at,
        ...(suggestions !== undefined ? { suggestedPersonaIds: suggestions } : {}),
      }
      state.answers.push(answer)
      for (const old of state.proposals.filter((p) => samePreference(p, test))) {
        state.answers = state.answers.filter((item) => item.id !== old.answerId)
        for (const [receiptId, receipt] of Object.entries(state.receipts)) {
          if (receipt.proposalId === old.id) state.receipts[receiptId] = { forgotten: true }
        }
      }
      state.proposals = state.proposals.filter((p) => !samePreference(p, test))
      state.proposals.push(proposal)
      state.receipts[receiptId] = { testId, optionId, proposalId: proposal.id }
      return { proposal: publicProposal(proposal, state), repeated: false }
    })
  }

  function removeRule(state, rule, forgetEvidence) {
    state.rules = state.rules.filter((item) => item.id !== rule.id)
    if (!forgetEvidence) return
    const sourceIds = new Set(rule.sourceIds.filter((id) => !state.rules.some((other) => other.sourceIds.includes(id))))
    const discarded = state.answers.filter((answer) => sourceIds.has(answer.id))
    state.answers = state.answers.filter((answer) => !sourceIds.has(answer.id))
    for (const answer of discarded) {
      if (state.receipts[answer.submissionId]) state.receipts[answer.submissionId] = { forgotten: true }
    }
  }

  async function decide({ proposalId, action, text, personaIds, replaceRuleIds }) {
    safeId(proposalId, 'proposalId')
    if (!['remember', 'session', 'reject'].includes(action)) throw new Error('未知的处理方式')
    const result = await change((state) => {
      const index = state.proposals.findIndex((item) => item.id === proposalId)
      if (index < 0) throw new Error('这条候选偏好已处理，请刷新')
      const proposal = state.proposals[index]
      state.proposals.splice(index, 1)
      if (action !== 'remember') {
        // "This time do not remember" and rejection discard the tentative
        // answer; a receipt remains only to reject stale duplicate submits.
        state.answers = state.answers.filter((answer) => answer.id !== proposal.answerId)
        for (const [receiptId, receipt] of Object.entries(state.receipts)) {
          if (receipt.proposalId === proposalId) state.receipts[receiptId] = { forgotten: true }
        }
        return { rule: null, discarded: true }
      }
      const acceptedText = cleanText(text ?? proposal.text)
      const at = nowIso(now)
      const isTone = topicOf(proposal) === 'tone'
      if (!isTone && proposal.suggestedPersonaIds !== undefined && personaIds === undefined) {
        throw new Error('请先确认这条偏好记给哪些人格')
      }
      const scopes = isTone ? [GENERAL] : selectScopes(state.personas, personaIds ?? [GENERAL])
      const matches = matchingRules(state.rules, proposal, scopes)
      const prior = matches.find((rule) => rule.mode === proposal.mode &&
        (isTone || (sameScopeSet(rule, scopes) || rule.text === acceptedText) &&
          (text == null || sameScopeSet(rule, scopes))))
      const replaced = matches.filter((rule) => rule !== prior)
      if (!isTone && personaIds !== undefined && replaced.length &&
          (!Array.isArray(replaceRuleIds) || !replaced.every((rule) => replaceRuleIds.includes(rule.id)))) {
        throw new Error('所选人格已有同类偏好，请查看并确认替换')
      }
      for (const old of replaced) {
        const remaining = ruleScopes(old).filter((id) => !scopes.includes(id))
        if (remaining.length && !isTone) old.personaIds = remaining
        else removeRule(state, old, true)
      }
      if (prior) {
        if (!isTone) prior.personaIds = [...new Set([...ruleScopes(prior), ...scopes])].sort()
        if (!prior.sourceIds.includes(proposal.answerId)) prior.sourceIds.push(proposal.answerId)
        prior.confirmedAt = at
        // An earlier manual correction stays authoritative.
        if (text != null) {
          prior.text = acceptedText
          prior.correctedAt = at
        }
        return { rule: publicRule(prior, state.answers), reinforced: true }
      }
      const rule = {
        id: newPublicId(), topic: topicOf(proposal), dimension: proposal.dimension, mode: proposal.mode,
        text: acceptedText, sourceIds: [proposal.answerId], confirmedAt: at,
        ...(text != null ? { correctedAt: at } : {}),
        ...(!isTone ? { personaIds: scopes } : {}),
      }
      state.rules.push(rule)
      return { rule: publicRule(rule, state.answers), replaced: replaced.length > 0 }
    })
    if (action === 'remember' && recommendPersonas) checkPersonaReview().catch(() => {})
    return result
  }

  async function mutateRule({ ruleId, action, text, personaIds, forgetEvidence = false }) {
    safeId(ruleId, 'ruleId')
    if (!['edit', 'delete'].includes(action)) throw new Error('未知的偏好操作')
    return change((state) => {
      const index = state.rules.findIndex((item) => item.id === ruleId)
      if (index < 0) throw new Error('这条偏好已变化，请刷新')
      const rule = state.rules[index]
      if (action === 'edit') {
        if (personaIds !== undefined && topicOf(rule) === 'preference') {
          const scopes = selectScopes(state.personas, personaIds, { allowPaused: true })
          if (matchingRules(state.rules.filter((item) => item.id !== rule.id), rule, scopes).length) {
            throw new Error('所选人格已有同类偏好，请先调整已有规则的适用范围')
          }
          rule.personaIds = scopes
        }
        if (text !== undefined) rule.text = cleanText(text)
        rule.correctedAt = nowIso(now)
        return { rule: publicRule(rule, state.answers) }
      }
      state.rules.splice(index, 1)
      if (forgetEvidence === true) {
        const ids = new Set(rule.sourceIds.filter((id) => !state.rules.some((other) => other.sourceIds.includes(id))))
        const discarded = state.answers.filter((answer) => ids.has(answer.id))
        state.answers = state.answers.filter((answer) => !ids.has(answer.id))
        const testIds = new Set(discarded.map((answer) => answer.testId))
        state.tests = state.tests.filter((test) => !testIds.has(test.id) ||
          state.answers.some((answer) => answer.testId === test.id) ||
          state.proposals.some((proposal) => proposal.testId === test.id))
        for (const answer of discarded) {
          const receipt = state.receipts[answer.submissionId]
          if (receipt) state.receipts[answer.submissionId] = { forgotten: true }
        }
      }
      return { deleted: true, forgotEvidence: forgetEvidence === true }
    })
  }

  async function mutatePersona({ action, personaId, orphanAction, expectedRuleIds, ...fields }) {
    if (!['create', 'edit', 'pause', 'resume', 'delete'].includes(action)) throw new Error('未知的人格操作')
    return change((state) => {
      if (action === 'create') {
        if (state.personas.length >= MAX_PERSONAS) throw new Error('人格数量已达到上限')
        const persona = { id: newPublicId(), ...personaFields(fields), paused: false }
        state.personas.push(persona)
        return { persona }
      }
      safeId(personaId, 'personaId')
      const persona = state.personas.find((item) => item.id === personaId)
      if (!persona) throw new Error('找不到这个人格，请刷新')
      if (action === 'edit') Object.assign(persona, personaFields(fields))
      if (action === 'pause' || action === 'resume') persona.paused = action === 'pause'
      if (action !== 'delete') return { persona }
      const linked = state.rules.filter((rule) => topicOf(rule) === 'preference' && ruleScopes(rule).includes(personaId))
      if (!Array.isArray(expectedRuleIds) || expectedRuleIds.length !== linked.length ||
          !linked.every((rule) => expectedRuleIds.includes(rule.id))) throw new Error('关联的偏好已变化，请重新查看后再删除')
      const exclusive = linked.filter((rule) => ruleScopes(rule).length === 1)
      if (exclusive.length && !['general', 'delete'].includes(orphanAction)) throw new Error('请选择怎样处理这个人格独用的偏好')
      for (const rule of exclusive) {
        if (orphanAction === 'general' && matchingRules(state.rules, rule, [GENERAL]).length) {
          throw new Error('已有同类通用偏好，请先在小本本里调整这些规则')
        }
      }
      for (const rule of linked) {
        const remaining = ruleScopes(rule).filter((id) => id !== personaId)
        if (remaining.length) rule.personaIds = remaining
        else if (orphanAction === 'general') rule.personaIds = [GENERAL]
        else removeRule(state, rule, true)
      }
      state.personas = state.personas.filter((item) => item.id !== personaId)
      return { deleted: true }
    })
  }

  let reviewing
  async function buildPersonaReview(manual) {
    const state = await readState()
    const current = publicReview(state)
    if (current) return { suggestion: current, status: 'ready' }
    if (!recommendPersonas) return { suggestion: null, status: 'unavailable' }
    const snapshot = reviewInput(state)
    const reviewed = new Set(state.personaReview?.groups ?? [])
    if (snapshot.groups.length < MIN_FEEDBACK_GROUPS ||
        !manual && snapshot.groups.filter((group) => !reviewed.has(group)).length < MIN_FEEDBACK_GROUPS) {
      return { suggestion: null, status: 'more-feedback' }
    }
    const signature = reviewSignature(state, snapshot)
    const response = await recommendPersonas({ input: snapshot, signal: AbortSignal.timeout(30_000) })
    const plan = validatePlan(response, state)
    return change((latest) => {
      const concurrent = publicReview(latest)
      if (concurrent) return { suggestion: concurrent, status: 'ready' }
      if (reviewSignature(latest) !== signature) return { suggestion: null, status: 'changed' }
      latest.personaReview = {
        groups: snapshot.groups,
        suggestion: plan ? { id: newPublicId(), plan, signature } : null,
      }
      return { suggestion: publicReview(latest), status: plan ? 'ready' : response?.action === 'none' ? 'none' : 'invalid' }
    })
  }

  function checkPersonaReview({ manual = false } = {}) {
    if (reviewing) return reviewing
    reviewing = buildPersonaReview(manual).finally(() => { reviewing = undefined })
    return reviewing
  }

  async function decidePersonaReview({ suggestionId, action }) {
    safeId(suggestionId, 'suggestionId')
    if (action !== 'apply' && action !== 'dismiss') throw new Error('未知的人格建议操作')
    return change((state) => {
      const suggestion = publicReview(state)
      if (suggestion?.id !== suggestionId) throw new Error('人格或偏好已变化，请重新检查建议')
      state.personaReview.suggestion = null
      if (action === 'dismiss') return { dismissed: true }
      const plan = validatePlan(suggestion, state)
      if (!plan) throw new Error('建议已不符合当前人格和偏好')
      const from = plan.action === 'create' ? GENERAL : plan.sourceId
      const targetId = plan.action === 'merge' ? plan.targetId : newPublicId()
      if (plan.profile) state.personas.push({ id: targetId, ...plan.profile, paused: false })
      for (const rule of state.rules.filter((item) => plan.moveRuleIds.includes(item.id))) {
        const remaining = ruleScopes(rule).filter((id) => id !== from)
        const equivalent = plan.action === 'merge' ? state.rules.find((other) => other.id !== rule.id &&
          samePreference(other, rule) && ruleScopes(other).includes(targetId)) : null
        if (equivalent) {
          equivalent.sourceIds = [...new Set([...equivalent.sourceIds, ...rule.sourceIds])]
          equivalent.personaIds = [...new Set([...ruleScopes(equivalent), ...remaining])].sort()
          removeRule(state, rule, false)
        } else {
          rule.personaIds = [...new Set([...remaining, targetId])].sort()
        }
      }
      if (plan.action === 'merge') state.personas = state.personas.filter((persona) => persona.id !== from)
      return { applied: true, action: plan.action, personaId: targetId }
    })
  }

  async function setInvitations({ enabled }) {
    if (typeof enabled !== 'boolean') throw new Error('enabled 必须为 true 或 false')
    return change((state) => {
      state.settings.invitationsEnabled = enabled
      return { settings: publicState(state).settings }
    })
  }

  async function maybeInvite() {
    // Prepare a fresh situational question outside the file lock. Model calls
    // can take seconds; holding the lock would block corrections and deletion.
    const preview = await readState()
    const currentTime = now().getTime()
    const recent = (preview.settings.invitationDates ?? [])
      .filter((value) => new Date(value).getTime() >= currentTime - 7 * 24 * 60 * 60 * 1000)
    const lastTime = preview.settings.lastInvitationAt ? new Date(preview.settings.lastInvitationAt).getTime() : 0
    const eligible = preview.settings.invitationsEnabled === true &&
      (!lastTime || currentTime - lastTime >= 72 * 60 * 60 * 1000) && recent.length < 2
    const hasFresh = preview.tests.some((test) =>
      !preview.answers.some((answer) => answer.testId === test.id) &&
      !preview.settings.invitedTestIds.includes(test.id))
    if (eligible && !hasFresh && typeof generateQuestion === 'function') {
      await generateTest({ context: '' })
    }
    return change((state) => {
      if (!state.settings.invitationsEnabled) return { test: null, reason: 'disabled' }
      const current = now()
      const last = state.settings.lastInvitationAt ? new Date(state.settings.lastInvitationAt) : null
      if (last && current.getTime() - last.getTime() < 72 * 60 * 60 * 1000) return { test: null, reason: 'cooldown' }
      const weekAgo = current.getTime() - 7 * 24 * 60 * 60 * 1000
      state.settings.invitationDates = (state.settings.invitationDates ?? []).filter((value) => new Date(value).getTime() >= weekAgo)
      if (state.settings.invitationDates.length >= 2) return { test: null, reason: 'weekly-limit' }
      const tests = state.tests.map(publicTest)
      const chosen = tests.find((test) => !state.answers.some((a) => a.testId === test.id) &&
        !state.settings.invitedTestIds.includes(test.id)) ?? null
      if (!chosen) return { test: null, reason: 'generate-first' }
      const at = nowIso(now)
      state.settings.lastInvitationAt = at
      state.settings.invitationDates.push(at)
      state.settings.invitedTestIds.push(chosen.id)
      if (state.settings.invitedTestIds.length > 40) state.settings.invitedTestIds.splice(0, state.settings.invitedTestIds.length - 40)
      return { test: chosen, reason: 'due' }
    })
  }

  function promptFor({ personaId } = {}) {
    let state
    try {
      state = readStateSync()
    } catch {
      // A damaged plugin file must not prevent unrelated DSH turns.
      return ''
    }
    const persona = state.personas.find((item) => item.id === personaId && !item.paused)
    const preferences = state.rules.filter((rule) => topicOf(rule) === 'preference')
    const specific = persona ? preferences.filter((rule) => ruleScopes(rule).includes(persona.id)) : []
    const rules = [...specific, ...preferences.filter((rule) => ruleScopes(rule).includes(GENERAL) &&
      !specific.some((item) => samePreference(item, rule)))].slice(0, MAX_RULES_IN_PROMPT)
    if (!persona && rules.length === 0) return ''
    const lines = ['以下是本轮回应方式。按本轮明确要求和当前适用的已确认偏好回应；已确认偏好优先于人格的一般风格。没有当前要求时，不自行照搬历史回复中其他人格的固定开场、称呼或格式。工具授权和安全边界不因此改变。']
    if (persona) lines.push(`当前人格：${persona.name}${persona.style ? `。回应方式：${persona.style}` : ''}`)
    if (rules.length) lines.push('用户已确认的偏好：')
    for (const rule of rules) {
      const next = `- ${rule.text}`
      if (lines.join('\n').length + next.length + 1 > MAX_PROMPT_CHARS) break
      lines.push(next)
    }
    if (persona) lines.push('根据本轮适用的偏好决定开场。只保留本轮明确要求或本轮偏好写出的固定开场、称呼和格式；其余直接按当前人格的方式回答。')
    return lines.join('\n')
  }

  async function generateTest({ context = '', topic = 'preference', signal, review } = {}) {
    normalizeTopic(topic)
    const excerptReview = review === undefined ? undefined : normalizeExcerptReview(review)
    if (excerptReview && topic !== 'preference') throw new Error('选段用于沟通偏好小测试')
    if (typeof generateQuestion !== 'function') throw new Error('当前 DSH 没有可用的测试生成模型')
    const snapshot = await readState()
    const recentTitles = snapshot.tests.slice(-5).map((test) => test.title)
    const question = await generateQuestion({
      topic,
      context: excerptReview ? '' : String(context).slice(0, 1000),
      confirmedRules: snapshot.rules.filter((rule) => topicOf(rule) === 'preference' &&
        (topic !== 'tone' || ruleScopes(rule).includes(GENERAL)))
        .map((rule) => topic === 'tone' ? rule.text : { text: rule.text, personaIds: ruleScopes(rule) }),
      personas: topic === 'preference' ? snapshot.personas.filter((persona) => !persona.paused) : [],
      questionStyleRules: snapshot.rules.filter((rule) => topicOf(rule) === 'tone').map((rule) => rule.text),
      openQuestions: Object.keys(dimensionsFor(topic))
        .filter((dimension) => !snapshot.rules.some((rule) => topicOf(rule) === topic && rule.dimension === dimension)),
      recentTitles,
      signal,
      ...(excerptReview ? { review: excerptReview } : {}),
    })
    if (signal?.aborted) throw new Error('出题已取消')
    // The request, not model-authored metadata, determines the effect's scope.
    if (!question || !Object.hasOwn(dimensionsFor(topic), question.dimension)) throw new Error('题目维度与所选主题不匹配')
    if (excerptReview?.usedDimensions.includes(question.dimension)) throw new Error('这道题和本组前面的维度重复了，可以重试')
    return change((state) => {
      const id = newPublicId()
      const test = {
        ...question, topic, id, createdAt: nowIso(now),
        ...(excerptReview ? { feedbackGroup: excerptReview.groupId ?? id } : {}),
        ...(topic === 'preference' && question.suggestedPersonaIds !== undefined ? {
          suggestedPersonaIds: suggestedScopes(question.suggestedPersonaIds, state.personas),
        } : {}),
      }
      state.tests.push(test)
      // Keep a bounded question bank; evidence snapshots live with answers.
      if (state.tests.length > 40) state.tests.splice(0, state.tests.length - 40)
      return { test: publicTest(test) }
    })
  }

  return {
    getState: async () => publicState(await readState()),
    listTests: () => readStateSync().tests.map(publicTest),
    generateTest,
    answer,
    decide,
    mutateRule,
    mutatePersona,
    checkPersonaReview,
    decidePersonaReview,
    setInvitations,
    maybeInvite,
    promptFor,
  }
}
