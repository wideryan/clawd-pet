import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { CATALOG } from './catalog'
import type { Gif } from './catalog'
import { INTENTS, INTENT_SYSTEM, REACTIONS, STATES, isTestCommand, stateOfTool } from './pools'
import type { ReactionName, State } from './pools'
import type { ClawdProps } from './surface'

const gifAtom = atom({ plugin: 'clawd-pet', key: 'gif' } as const, 7)
const hiddenAtom = atom({ plugin: 'clawd-pet', key: 'isHidden' } as const, false)
const plainAtom = atom({ plugin: 'clawd-pet', key: 'isPlain' } as const, false)

const SPRITE_PX = 54 // 原来 80；surface.tsx 会按屏幕缩放取整到整数物理像素
const PAGE_COLOR = 'composerSidebarBackground' // 主题键，对应聊天区的底色，跟随主题
const TICK_MS = 1000
const MIN_HOLD_MS = 6000 // 状态再怎么变，一个动图至少放这么久
const WORK_HOLD_MS = 45_000 // 干活途中换状态（比如从查资料到写代码）的最短间隔
const WORK_STATES: ReadonlySet<State> = new Set<State>([
  'research',
  'coding',
  'debug',
  'creating',
  'writing',
  'running',
  'simulating',
])
const SLEEP_AFTER_MS = 15 * 60_000
const ERRORS_MEAN_DEBUG = 2
const MODEL = 'haiku'

const BY_N = new Map<number, Gif>(CATALOG.map(g => [g.n, g]))

function pick(pool: readonly number[], avoid: number): number {
  const rest = pool.filter(n => n !== avoid)
  const from = rest.length > 0 ? rest : pool
  return from[Math.floor(Math.random() * from.length)] ?? 7
}

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}

export const register: Register = on => {
  // 对话现在在干什么
  let isWorking = false
  let isWaiting = false
  let toolState: State | null = null // 这一轮最近一个有意义的工具对应的状态，还没用工具时是 null
  let intent: State | null = null // 小模型对这一轮任务的判断，优先于工具
  let errors = 0
  let idleSince = 0
  // 现在放的是什么
  let shownState: State = 'idle'
  let shownSince = 0
  let shownGif = pick(STATES.idle, 0)
  let reaction: { gif: number; until: number } | null = null
  let clicks: number[] = []
  let isAiOn = true
  // session.start 里建好的闭包：定时器和后台判断都活得比单次 hook 久
  let tick: (() => Promise<void>) | undefined
  let classify: ((text: string) => Promise<void>) | undefined
  const svgCache = new Map<number, string>()

  function wantedState(now: number): State {
    if (isWaiting) return 'waiting'
    if (!isWorking) return now - idleSince > SLEEP_AFTER_MS ? 'sleeping' : 'idle'
    if (toolState === null) return 'thinking'
    // 仿真一跑就是很久，值得单独显示；其余时候整轮任务保持同一个状态，不跟着每个工具跳
    if (toolState === 'simulating') return 'simulating'
    return intent ?? toolState
  }

  function decide(now: number): number {
    if (reaction !== null) {
      if (now < reaction.until) return reaction.gif
      reaction = null
    }
    const next = wantedState(now)
    const hold = WORK_STATES.has(shownState) && WORK_STATES.has(next) ? WORK_HOLD_MS : MIN_HOLD_MS
    if (next !== shownState && (next === 'waiting' || now - shownSince >= hold)) {
      shownState = next
      shownSince = now
      shownGif = pick(STATES[next], shownGif)
    }
    return shownGif
  }

  function react(now: number, name: ReactionName, minMs = 2600) {
    const n = pick(REACTIONS[name], reaction?.gif ?? shownGif)
    reaction = { gif: n, until: now + Math.max(minMs, BY_N.get(n)?.ms ?? 0) }
  }

  on('session.start', async ($, e, next) => {
    idleSince = await $.clock.now()
    isAiOn = (await $.store.get('ai')) !== false
    const isStoredHidden = (await $.store.get('hidden')) === true
    await update($, hiddenAtom, () => isStoredHidden)
    await update($, plainAtom, () => false)
    await $.command.register({
      name: 'clawd',
      description: '显示或隐藏 Clawd，开关小模型判断，或按编号预览某个动图',
      argumentHint: 'on | off | ai on | ai off | 1-400',
    })

    tick = async () => {
      const want = decide(await $.clock.now())
      if (want !== (await read($, gifAtom))) await update($, gifAtom, () => want)
    }

    classify = async text => {
      if (!isAiOn) return
      try {
        const rows = await $.session.messages()
        const said = rows.filter(r => r.role === 'assistant' && r.text !== '').at(-1)?.text ?? ''
        const answer = await $.model.complete({
          model: MODEL,
          system: INTENT_SYSTEM,
          prompt: `用户这条消息：${clip(text, 600)}\nClaude 上一次说的：${clip(said, 300) || '（无）'}`,
          maxTokens: 8,
          timeoutMs: 15_000,
        })
        if (!answer.isAnswered || !isWorking) return
        const word = answer.text.trim().toLowerCase().match(/[a-z]+/)?.[0] ?? ''
        if (word in INTENTS && intent !== 'debug') intent = INTENTS[word] ?? null
      } catch {
        // 模型被组织策略挡住之类：这个会话不再试，动图按工具走
        isAiOn = false
      }
    }

    $.clock.every(TICK_MS, () => void tick?.().catch(() => undefined))
    return next(e)
  })

  on('command.run', { command: 'clawd' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const now = await $.clock.now()
    if (arg === 'off' || arg === 'on') {
      await update($, hiddenAtom, () => arg === 'off')
      await $.store.set('hidden', arg === 'off')
      return { text: arg === 'off' ? 'Clawd 收起来了。' : 'Clawd 回来了。' }
    }
    if (arg === 'ai off' || arg === 'ai on') {
      isAiOn = arg === 'ai on'
      await $.store.set('ai', isAiOn)
      return { text: isAiOn ? '已开启小模型判断。' : '已关闭小模型判断，只看工具调用。' }
    }
    const gif = BY_N.get(Number(arg))
    if (gif !== undefined) {
      reaction = { gif: gif.n, until: now + Math.max(8_000, gif.ms * 2) }
      await tick?.()
      return { text: `Clawd 正在预览 ${gif.n} ${gif.zh}。` }
    }
    return { text: '用法：/clawd on、off、ai on、ai off，或 1 到 400 的编号。' }
  })

  on('ui.message', async ($, e, next) => {
    const kind = (e.data as { t?: unknown } | null)?.t
    const now = await $.clock.now()
    if (kind === 'click') {
      clicks = [...clicks.filter(t => now - t < 5_000), now]
      react(now, clicks.length >= 7 ? 'rage' : clicks.length >= 4 ? 'annoyed' : 'poke')
    }
    await tick?.()
    return next(e)
  })

  on('ui.fault', async ($, e, next) => {
    await update($, plainAtom, () => true)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      isWorking = true
      isWaiting = false
      toolState = null
      intent = null
      errors = 0
      if (e.text.trim() !== '') void classify?.(e.text)
      await tick?.()
    }
    return next(e)
  })

  on('tool.call', async (_$, e, next) => {
    const args = e as unknown as Record<string, unknown>
    const isMain = e.agentId === undefined
    if (isMain) {
      isWorking = true
      if (e.tool === 'AskUserQuestion') isWaiting = true
      toolState = stateOfTool(e.tool, args) ?? toolState
      void tick?.()
    }
    const ran = await next(e)
    if (isMain) {
      isWaiting = false
      if ('isError' in ran && ran.isError === true) {
        errors += 1
        if (errors >= ERRORS_MEAN_DEBUG || isTestCommand(e.tool, args)) intent = 'debug'
      }
    }
    return ran
  })

  on('classic.PermissionRequest', (_$, e, next) => {
    isWaiting = true
    void tick?.()
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isWorking = false
      isWaiting = false
      toolState = null
      intent = null
      idleSince = await $.clock.now()
      await tick?.()
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey || (await read($, hiddenAtom))) return next(e)
    const gif = BY_N.get(await read($, gifAtom)) ?? CATALOG[0]
    if (gif === undefined) return next(e)
    let svg = svgCache.get(gif.n)
    if (svg === undefined) {
      svg = await $.fs.read(`${$.plugin.root}/assets/${gif.stem}.svg`)
      if (svgCache.size >= 64) svgCache.delete(svgCache.keys().next().value as number)
      svgCache.set(gif.n, svg)
    }
    const alt = `Clawd：${gif.zh}`
    const { Box, Client, Svg } = $.ui.resolve(e)
    const props: ClawdProps = { svg, alt, px: SPRITE_PX }
    // 桌面端给这条区域自带圆角灰底，接口去不掉，只能铺一层页面同色的底盖住。绝对定位是相对
    // 内容区的，所以用负边距向外撑满内边距（竖向 1 单位约 10px；横向 1 单位是 1 个字符宽）。
    // 底色层可以越出灰底，越出去的部分会被裁掉。
    // Clawd 那层上下各 -1，正好吃掉上下内边距，整条区域就和 Clawd 一样高。别再往外压：灰底有约
    // 40px 的最小高度，而底色层和 Clawd 都画不出内容区，内容区比灰底矮多少，底下就露多少灰条，
    // 脚也会被裁掉；上边压过头则削掉头顶。右边 -1 会被切掉最右一列，所以取 -0.9。
    // Client 加载完之前高度是 0，靠根节点的 minHeight（1 行，约 20px）撑到灰底的最小高度，否则切换
    // 会话时灰条会闪一下。
    return (
      <Box width="100%" minHeight={1} justifyContent="flex-end">
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          marginTop={-2}
          marginLeft={-2}
          marginRight={-2}
          marginBottom={-2}
          backgroundColor={PAGE_COLOR}
        />
        <Box minWidth={0} marginTop={-1} marginBottom={-1} marginRight={-0.9}>
          {(await read($, plainAtom)) ? (
            <Svg source={svg} alt={alt} width={SPRITE_PX} height={SPRITE_PX} isInteractive />
          ) : (
            <Client key="clawd" module="./surface.tsx" props={props} />
          )}
        </Box>
      </Box>
    )
  })
}
