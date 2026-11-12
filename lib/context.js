/**
 * Read only the exact command Agent's conversation when making one situational
 * test. A standalone Web panel supplies an optional short hint instead of
 * looking up an untrusted or ambiguous session id.
 */
const MAX_SITUATION_CHARS = 1000
const MAX_HINT_CHARS = 400
const MAX_MESSAGE_CHARS = 280

function clip(value, limit) {
  const normalized = String(value ?? '').replace(/[\r\n\t]+/gu, ' ').replace(/\s{2,}/gu, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`
}

function directText(message) {
  if (message?.role === 'user') {
    if (!['user', 'user-rpc'].includes(message.source?.kind)) return null
  } else if (message?.role === 'assistant') {
    if (message.source?.kind !== 'model') return null
  } else {
    return null
  }
  if (!Array.isArray(message.content)) return null
  const text = message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ')
  const bounded = clip(text, MAX_MESSAGE_CHARS)
  if (message.role === 'user' && /^\/attune(?:\s|$)/iu.test(bounded)) return null
  return bounded ? { role: message.role, text: bounded } : null
}

function selectedSession({ commandContext }) {
  const commandAgent = commandContext?.agent
  if (commandAgent?.session?.deriveMessages) return commandAgent.session
  return null
}

export function getSituation(ctx, options = {}) {
  const lines = []
  const hint = clip(options.userHint, MAX_HINT_CHARS)
  if (hint) lines.push(`用户给出的当前情境：${hint}`)

  const session = selectedSession(options)
  let messages = []
  try {
    messages = session?.deriveMessages?.() ?? []
  } catch {
    // Unavailable projection should not stop a new optional question.
  }
  if (Array.isArray(messages)) {
    const selected = []
    // Two user messages and one assistant reply are enough to tailor a test.
    // Skip tool-heavy tails without reading unrelated sessions or files.
    let users = 0
    let assistants = 0
    for (let i = messages.length - 1, scanned = 0; i >= 0 && scanned < 200; i--, scanned++) {
      const item = directText(messages[i])
      if (!item) continue
      if (item.role === 'user' && users < 2) { selected.push(item); users++ }
      if (item.role === 'assistant' && assistants < 1) { selected.push(item); assistants++ }
      if (users >= 2 && assistants >= 1) break
    }
    selected.reverse()
    for (const item of selected) lines.push(`${item.role === 'user' ? '用户' : '助手'}：${item.text}`)
  }

  return clip(lines.join('\n'), MAX_SITUATION_CHARS)
}
