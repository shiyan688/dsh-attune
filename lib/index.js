import { join, resolve, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import { createAttuneEngine } from './core.js'
import { registerDshGo } from './dshgo.js'
import { generateQuestion, resolveModelRoute } from './generator.js'
import { getSituation } from './context.js'

export const name = 'dsh-attune'

export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  dataDir: Schema.string().default(''),
  generatorProvider: Schema.string().default(''),
  generatorModel: Schema.string().default(''),
})

const API = '/api/attune/'
const MAX_BODY_BYTES = 32 * 1024
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

function statePath(config) {
  const configured = String(config?.dataDir ?? '').trim()
  if (configured && !isAbsolute(configured)) {
    throw new Error('dsh-attune dataDir must be an absolute path')
  }
  const home = String(process.env.DSH_HOME ?? '').trim() || join(homedir(), '.dsh')
  return join(configured ? resolve(configured) : join(home, 'storages', 'dsh-attune'), 'state.json')
}

function json(status, value) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS })
}

async function bodyOf(request) {
  const contentType = request.headers.get('content-type') ?? ''
  if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
    throw new Error('Expected application/json request body')
  }
  let size = 0
  const chunks = []
  if (request.body) {
    for await (const chunk of request.body) {
      size += chunk.byteLength
      if (size > MAX_BODY_BYTES) throw new Error('Request body exceeds 32 KiB')
      chunks.push(chunk)
    }
  }
  const value = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object')
  return value
}

function responseFor(ctx, engine, path, method) {
  return async (request) => {
    try {
      if (method === 'GET') {
        if (path === 'state') return json(200, await engine.getState())
        if (path === 'tests') return json(200, engine.listTests())
      }
      const body = await bodyOf(request)
      if (path === 'generate') {
        const context = getSituation(ctx, { userHint: body.context })
        return json(200, await engine.generateTest({ context }))
      }
      if (path === 'answer') return json(200, await engine.answer(body))
      if (path === 'proposal') return json(200, await engine.decide(body))
      if (path === 'rule') return json(200, await engine.mutateRule(body))
      if (path === 'invite') {
        if (body.action === 'enable' || body.action === 'disable') {
          return json(200, await engine.setInvitations({ enabled: body.action === 'enable' }))
        }
        if (body.action === 'next') return json(200, await engine.maybeInvite())
        throw new Error('Invalid invitation action')
      }
      return json(404, { error: 'Unknown route' })
    } catch (error) {
      return json(400, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

export function registerApi(ctx, engine) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['connection'], (owner) => {
    const registry = owner.connection?.fetch
    if (typeof registry?.register !== 'function') return
    for (const path of ['state', 'tests', 'generate', 'answer', 'proposal', 'rule', 'invite']) {
      const method = path === 'state' || path === 'tests' ? 'GET' : 'POST'
      owner.effect(() => registry.register({
        path: API + path,
        methods: [method],
        requestBody: method === 'POST' ? 'streaming' : 'buffered',
        fetch: responseFor(ctx, engine, path, method),
      }))
    }
  })
}

function renderTest(test) {
  return `${test.title}\n${test.prompt}\n${test.options.map((option) => `${option.id}. ${option.label}${option.detail ? ` — ${option.detail}` : ''}`).join('\n')}\n回答：/attune answer ${test.id} <选项>`
}

function evidenceLine(value) {
  const snippets = (Array.isArray(value) ? value : [value])
    .filter((item) => typeof item === 'string' && item.trim())
    .slice(0, 2)
    .map((item) => item.trim().slice(0, 120))
  return snippets.length ? `（依据：${snippets.join('；')}）` : ''
}

function commandHelp() {
  return [
    '默契小实验：',
    '/attune test [当前情境] — 按眼前情况生成一道题',
    '/attune test list — 查看已经生成的题目',
    '/attune test <题目ID> — 重看一道题',
    '/attune answer <题目ID> <选项ID> — 提交选择',
    '/attune remember <候选ID> — 确认偏好',
    '/attune reject <候选ID> — 不采纳',
    '/attune list — 查看偏好与候选',
    '/attune correct <规则ID> <新文字> — 纠正偏好',
    '/attune delete <规则ID> [forget] — 删除偏好；forget 同时忘记证据',
    '/attune on|off — 开关偶尔邀请',
  ].join('\n')
}

export async function executeAttuneCommand(engine, rawInput, options = {}) {
  const input = String(rawInput ?? '').trim()
  if (!input || input === 'help') return commandHelp()
  const [verb, ...args] = input.split(/\s+/u)
  if (verb === 'test') {
    const tests = engine.listTests()
    if (args[0] === 'list') return tests.map((item) => `- ${item.id}: ${item.title}`).join('\n') || '暂时没有题目。'
    const known = args.length === 1 ? tests.find((item) => item.id === args[0]) : null
    const test = known ?? (await engine.generateTest({
      context: typeof options.contextForTest === 'function' ? options.contextForTest(args.join(' ')) : args.join(' '),
    })).test
    if (!test) throw new Error('模型没有生成小测试，请重试。')
    return renderTest(test)
  }
  if (verb === 'answer') {
    const [testId, optionId] = args
    if (!testId || !optionId) throw new Error('用法：/attune answer <题目ID> <选项ID>')
    const result = await engine.answer({ testId, optionId, submissionId: randomUUID() })
    if (!result.proposal) return '这次选择已记录。当前没有新的候选规律，试试另一道题。'
    return `我学到一条候选偏好：${result.proposal.text}${evidenceLine(result.proposal.evidence)}\n候选ID：${result.proposal.id}\n确认：/attune remember ${result.proposal.id}\n不采纳：/attune reject ${result.proposal.id}`
  }
  if (verb === 'remember' || verb === 'reject') {
    const proposalId = args[0]
    if (!proposalId) throw new Error(`用法：/attune ${verb} <候选ID>`)
    const result = await engine.decide({ proposalId, action: verb === 'remember' ? 'remember' : 'reject' })
    return verb === 'remember' ? `已经记住：${result.rule?.text ?? proposalId}` : '已放弃这条候选偏好。'
  }
  if (verb === 'correct') {
    const ruleId = args.shift()
    const text = args.join(' ').trim()
    if (!ruleId || !text) throw new Error('用法：/attune correct <规则ID> <新文字>')
    const result = await engine.mutateRule({ ruleId, action: 'edit', text })
    return `已改成：${result.rule?.text ?? text}`
  }
  if (verb === 'delete') {
    const ruleId = args[0]
    if (!ruleId) throw new Error('用法：/attune delete <规则ID> [forget]')
    await engine.mutateRule({ ruleId, action: 'delete', forgetEvidence: args[1] === 'forget' })
    return args[1] === 'forget' ? '已删除规则和来源证据。' : '已删除规则。'
  }
  if (verb === 'list') {
    const state = await engine.getState()
    const rules = state.rules?.length
      ? state.rules.map((rule) => `- ${rule.id}: ${rule.text}${evidenceLine(rule.evidence)}`).join('\n')
      : '（还没有确认的偏好）'
    const proposals = state.proposals?.length
      ? state.proposals.map((item) => `- ${item.id}: ${item.text}${evidenceLine(item.evidence)}`).join('\n')
      : '（没有待确认的候选）'
    return `已确认：\n${rules}\n待确认：\n${proposals}`
  }
  if (verb === 'on' || verb === 'off') {
    await engine.setInvitations({ enabled: verb === 'on' })
    return verb === 'on' ? '已开启偶尔邀请。' : '已关闭偶尔邀请；仍可随时用 /attune test。'
  }
  throw new Error('未知操作。用 /attune 查看可用命令。')
}

export function registerCommand(ctx, engine) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['commands'], (owner) => {
    if (typeof owner.commands?.register !== 'function') return
    owner.effect(() => owner.commands.register({
      name: 'attune',
      description: '玩一题默契小实验，查看或纠正 DSH 对你的偏好理解',
      input: { hint: 'test | answer | remember | reject | list | correct | delete | on | off' },
      handler: async (invocation) => {
        try {
          return {
            kind: 'success',
            text: await executeAttuneCommand(engine, invocation.rawInput, {
              contextForTest: (hint) => getSituation(owner, { commandContext: invocation, userHint: hint }),
            }),
          }
        } catch (error) {
          return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
        }
      },
    }))
  })
}

export function registerPrompt(ctx, engine) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['systemPrompt'], (owner) => {
    if (typeof owner.systemPrompt?.context !== 'function') return
    owner.effect(() => owner.systemPrompt.context({
      name: 'dsh-attune:confirmed-preferences',
      order: 10150,
      interpolate: false,
      text: () => engine.promptFor({ scope: 'global' }),
    }))
  })
}

export function apply(ctx, config = {}) {
  if (config.enabled === false) return
  const engine = createAttuneEngine({
    filePath: statePath(config),
    generateQuestion: (request) => generateQuestion({
      ...request,
      llm: ctx.get?.('llm'),
      route: resolveModelRoute(ctx, {
        provider: config.generatorProvider,
        model: config.generatorModel,
      }),
    }),
  })
  registerApi(ctx, engine)
  registerCommand(ctx, engine)
  registerPrompt(ctx, engine)
  registerDshGo(ctx, engine)
}
