export const GENERAL = 'general'
export const MAX_PERSONAS = 12
export const STARTER_PERSONAS = Object.freeze([
  { id: 'ideas', name: '点子搭子', when: '用户正在分享还没成形的点子、发散可能性，或者想一起聊灵感。', style: '先陪用户展开想法，再在合适时讨论可行性。' },
  { id: 'execution', name: '执行搭子', when: '方向基本确定，用户想推进任务、排步骤、交付或者解决具体卡点。', style: '先给能推进事情的下一步，再补实施细节。' },
  { id: 'review', name: '评审搭子', when: '用户明确想让助手检查、比较或评价已有成果，例如审稿、代码评审或挑方案的毛病。', style: '先指出最值得处理的问题，并给出具体依据。' },
  { id: 'support', name: '陪聊搭子', when: '用户主要在表达烦心、失落或挫败，希望先被听见，或者明确说想聊聊感受。', style: '先回应用户此刻的感受，再看对方想继续聊，还是想一起理清下一步。' },
])

export function ruleScopes(rule) {
  return rule.personaIds ?? [GENERAL]
}

export function selectScopes(personas, ids, { allowPaused = false } = {}) {
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_PERSONAS ||
      ids.some((id) => typeof id !== 'string')) throw new Error('请选择至少一个人格，或选择通用偏好')
  const result = [...new Set(ids)]
  if (result.includes(GENERAL)) {
    if (result.length !== 1) throw new Error('通用偏好和指定人格只能选一种')
    return result
  }
  if (result.some((id) => !personas.some((persona) => persona.id === id && (allowPaused || !persona.paused)))) {
    throw new Error('所选人格已停用或删除，请重新选择')
  }
  return result.sort()
}

export function suggestedScopes(ids, personas) {
  if (!Array.isArray(ids)) return []
  const active = new Set(personas.filter((persona) => !persona.paused).map((persona) => persona.id))
  const result = [...new Set(ids.filter((id) => active.has(id)))]
  if (result.length) return result.sort()
  return ids.includes(GENERAL) ? [GENERAL] : []
}

export function personaFields(input) {
  const read = (key, label, max, required) => {
    const value = typeof input[key] === 'string' ? input[key].trim().replace(/\s+/gu, ' ') : ''
    if ((required && !value) || value.length > max) throw new Error(`${label}须为 ${required ? 1 : 0}～${max} 个字符`)
    return value
  }
  return {
    name: read('name', '人格名称', 24, true),
    when: read('when', '适用情景', 200, true),
    style: read('style', '回应方式', 180, false),
  }
}
