import { mkdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

const VERSION = 1
const MAX_RULES_IN_PROMPT = 8
const MAX_PROMPT_CHARS = 900
const LOCK_STALE_MS = 120_000
const newPublicId = () => randomBytes(9).toString('base64url')

function initialState() {
  return {
    version: VERSION,
    revision: 0,
    tests: [],
    rules: [],
    proposals: [],
    answers: [],
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
    id: test.id, dimension: test.dimension, title: test.title, prompt: test.prompt,
    options: test.options.map(({ id, label, detail }) => ({ id, label, detail })),
  }
}

function publicProposal(proposal) {
  return {
    id: proposal.id,
    testId: proposal.testId,
    text: proposal.text,
    evidence: proposal.evidence,
    status: 'pending',
    conflictText: proposal.conflictText ?? null,
    reinforcesRuleId: proposal.reinforcesRuleId ?? null,
    replacesRuleId: proposal.replacesRuleId ?? null,
    createdAt: proposal.createdAt,
  }
}

function publicRule(rule, answers) {
  return {
    id: rule.id,
    text: rule.text,
    scope: 'global',
    dimension: rule.dimension,
    evidence: rule.sourceIds.map((id) => answers.find((a) => a.id === id)).filter(Boolean).map(evidenceFor),
    confirmedAt: rule.confirmedAt,
    correctedAt: rule.correctedAt ?? null,
  }
}

function publicState(state) {
  return {
    revision: state.revision,
    rules: state.rules.map((rule) => publicRule(rule, state.answers)),
    proposals: state.proposals.map(publicProposal),
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
export function createAttuneEngine({ filePath, now = () => new Date(), generateQuestion }) {
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
        return { proposal: proposal ? publicProposal(proposal) : null, repeated: true }
      }
      const test = state.tests.find((item) => item.id === testId)
      const option = test?.options.find((item) => item.id === optionId)
      if (!test || !option) throw new Error('找不到这个题目或选项，请重新生成题目')

      const at = nowIso(now)
      const answer = {
        id: randomUUID(), submissionId: receiptId, testId, optionId,
        dimension: test.dimension, title: test.title,
        optionLabel: option.label, at,
      }
      const existing = state.rules.find((rule) => rule.dimension === test.dimension)
      const proposal = {
        id: newPublicId(), testId, answerId: answer.id,
        dimension: test.dimension, mode: option.mode,
        text: option.rule, evidence: evidenceFor(answer),
        conflictText: existing && existing.mode !== option.mode ? existing.text : null,
        reinforcesRuleId: existing && existing.mode === option.mode ? existing.id : null,
        replacesRuleId: existing && existing.mode !== option.mode ? existing.id : null,
        createdAt: at,
      }
      state.answers.push(answer)
      for (const old of state.proposals.filter((p) => p.dimension === test.dimension)) {
        state.answers = state.answers.filter((item) => item.id !== old.answerId)
        for (const [receiptId, receipt] of Object.entries(state.receipts)) {
          if (receipt.proposalId === old.id) state.receipts[receiptId] = { forgotten: true }
        }
      }
      state.proposals = state.proposals.filter((p) => p.dimension !== test.dimension)
      state.proposals.push(proposal)
      state.receipts[receiptId] = { testId, optionId, proposalId: proposal.id }
      return { proposal: publicProposal(proposal), repeated: false }
    })
  }

  async function decide({ proposalId, action, text }) {
    safeId(proposalId, 'proposalId')
    if (!['remember', 'session', 'reject'].includes(action)) throw new Error('未知的处理方式')
    return change((state) => {
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
      const prior = state.rules.find((rule) => rule.dimension === proposal.dimension)
      if (prior && prior.mode === proposal.mode) {
        if (!prior.sourceIds.includes(proposal.answerId)) prior.sourceIds.push(proposal.answerId)
        prior.confirmedAt = at
        // An earlier manual correction stays authoritative.
        if (text != null) {
          prior.text = acceptedText
          prior.correctedAt = at
        }
        return { rule: publicRule(prior, state.answers), reinforced: true }
      }
      if (prior) {
        state.rules = state.rules.filter((rule) => rule.id !== prior.id)
        const oldIds = new Set(prior.sourceIds)
        const oldAnswers = state.answers.filter((answer) => oldIds.has(answer.id))
        state.answers = state.answers.filter((answer) => !oldIds.has(answer.id))
        for (const oldAnswer of oldAnswers) {
          const receipt = state.receipts[oldAnswer.submissionId]
          if (receipt) state.receipts[oldAnswer.submissionId] = { forgotten: true }
        }
      }
      const rule = {
        id: newPublicId(), dimension: proposal.dimension, mode: proposal.mode,
        text: acceptedText, sourceIds: [proposal.answerId], confirmedAt: at,
        ...(text != null ? { correctedAt: at } : {}),
      }
      state.rules.push(rule)
      return { rule: publicRule(rule, state.answers), replaced: Boolean(prior) }
    })
  }

  async function mutateRule({ ruleId, action, text, forgetEvidence = false }) {
    safeId(ruleId, 'ruleId')
    if (!['edit', 'delete'].includes(action)) throw new Error('未知的偏好操作')
    return change((state) => {
      const index = state.rules.findIndex((item) => item.id === ruleId)
      if (index < 0) throw new Error('这条偏好已变化，请刷新')
      const rule = state.rules[index]
      if (action === 'edit') {
        rule.text = cleanText(text)
        rule.correctedAt = nowIso(now)
        return { rule: publicRule(rule, state.answers) }
      }
      state.rules.splice(index, 1)
      if (forgetEvidence === true) {
        const ids = new Set(rule.sourceIds)
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

  function promptFor() {
    let rules
    try {
      rules = readStateSync().rules.slice(0, MAX_RULES_IN_PROMPT)
    } catch {
      // A damaged plugin file must not prevent unrelated DSH turns.
      return ''
    }
    if (rules.length === 0) return ''
    const lines = ['用户亲自确认的协作偏好。只在相关场景应用；当前明确要求优先，工具授权和安全边界不因偏好改变：']
    for (const rule of rules) {
      const next = `- ${rule.text}`
      if (lines.join('\n').length + next.length + 1 > MAX_PROMPT_CHARS) break
      lines.push(next)
    }
    return lines.join('\n')
  }

  async function generateTest({ context = '', signal } = {}) {
    if (typeof generateQuestion !== 'function') throw new Error('当前 DSH 没有可用的测试生成模型')
    const snapshot = await readState()
    const recentTitles = snapshot.tests.slice(-5).map((test) => test.title)
    const question = await generateQuestion({
      context: String(context).slice(0, 1000),
      confirmedRules: snapshot.rules.map((rule) => rule.text),
      openQuestions: ['opening', 'length', 'explain', 'stuck', 'feedback', 'ideas']
        .filter((dimension) => !snapshot.rules.some((rule) => rule.dimension === dimension)),
      recentTitles,
      signal,
    })
    if (signal?.aborted) throw new Error('出题已取消')
    return change((state) => {
      const test = { ...question, id: newPublicId(), createdAt: nowIso(now) }
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
    setInvitations,
    maybeInvite,
    promptFor,
  }
}
