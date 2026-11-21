const officialBalance = 'https://api.deepseek.com/user/balance'
const missing = { status: 'missing', source: '', lines: [] }

function amounts(entries, field) {
  const result = new Map()
  for (const entry of Array.isArray(entries) ? entries : []) {
    const currency = entry?.currency
    const value = entry?.[field]
    if ((currency === 'CNY' || currency === 'USD') && typeof value === 'string'
      && /^-?\d{1,12}(?:\.\d{1,8})?$/.test(value)) result.set(currency, value)
  }
  return [...result].map(([currency, value]) => (currency === 'CNY' ? '¥' : '$') + value)
}

async function accountBalance(account, client) {
  if (typeof account?.getBalance !== 'function') return missing
  const source = 'account'
  try {
    const result = await account.getBalance(client)
    if (!result) return missing
    if (result.status !== 'ready') return { status: 'error', source, lines: [] }
    const recharge = amounts(result.value, 'balance')
    const bonus = amounts(result.bonusWallets, 'balance')
    const lines = [
      ...recharge.map((value) => '充值 ' + value),
      ...bonus.map((value) => '赠送 ' + value),
    ]
    return { status: lines.length ? 'ready' : 'empty', source, lines }
  } catch {
    return { status: 'error', source, lines: [] }
  }
}

async function apiBalance(credentials, request) {
  if (typeof credentials?.resolve !== 'function') return missing
  const source = 'api'
  try {
    const key = (await credentials.resolve('DEEPSEEK_API_KEY'))?.value?.trim()
    if (!key) return missing
    const response = await request(officialBalance, {
      headers: { authorization: 'Bearer ' + key, accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(6_000),
    })
    if (response.status === 401 || response.status === 403) return { status: 'invalid', source, lines: [] }
    if (!response.ok) throw new Error('Cannot read DeepSeek balance')
    const result = await response.json()
    if (typeof result.is_available !== 'boolean' || !Array.isArray(result.balance_infos))
      throw new Error('Invalid DeepSeek balance')
    const lines = amounts(result.balance_infos, 'total_balance')
    return { status: lines.length ? 'ready' : 'empty', source, lines }
  } catch {
    return { status: 'error', source, lines: [] }
  }
}

export async function checkDesktopBalance({ account, credentials, platformVersion, preferApi = false, request = fetch }) {
  const getAccount = () => accountBalance(account, {
    version: platformVersion,
    locale: 'zh-CN',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  })
  const getApi = () => apiBalance(credentials, request)
  const primary = await (preferApi ? getApi() : getAccount())
  return primary.status === 'missing' ? (preferApi ? getAccount() : getApi()) : primary
}
