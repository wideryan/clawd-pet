import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'clawd-pet',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

type Tree = { type?: string; props?: Record<string, unknown>; children?: Tree[] }

function parts(tree: unknown) {
  const root = tree as Tree
  const sprite = root.children?.[0]
  return {
    width: sprite?.props?.width,
    height: sprite?.props?.height,
    count: root.children?.length,
    alt: String(sprite?.props?.alt ?? ''),
  }
}

function stubWorld(on: On) {
  mock.store(on)
  on('command.register', () => ({ value: { command: 'clawd' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.read', () => ({ value: '<svg xmlns="http://www.w3.org/2000/svg"/>' }))
  on('session.messages', () => ({ value: [] }))
}

test('在桌面端画 Client 和盖住灰底的底色，别的界面不画', async ($, on) => {
  mock.clock(on)
  stubWorld(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(parts(await desk.drawn({ in: 'clawd' })).alt).toMatch(/^Clawd：/)
  const root = (await desk.drawn()) as Tree
  const [cover, holder] = root.children ?? []
  // Client 加载完之前靠它撑住内容区，否则灰条会闪一下
  expect(root.props?.minHeight).toBe(1)
  expect(cover?.props?.backgroundColor).toBe('composerSidebarBackground')
  expect(Number(cover?.props?.marginBottom)).toBeLessThan(-1)
  // Clawd 上下各 -1 正好吃掉内边距。再往外压，内容区就比灰底的最小高度矮，底下露灰条、脚被裁
  expect(holder?.props?.marginTop).toBe(-1)
  expect(holder?.props?.marginBottom).toBe(-1)
  // 右边到 -1 就会被切掉最右一列
  expect(Number(holder?.props?.marginRight)).toBeGreaterThan(-1)
  await desk.unmount()

  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await term.unmount()
})

test('点一下放被戳的反应，放完回到原来那个动图', async ($, on) => {
  const clock = mock.clock(on)
  stubWorld(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.resize({ columns: 10, rows: 4 })
  await clock.advance(2_000)
  const before = parts(await ui.drawn({ in: 'clawd' })).alt

  await ui.pointer({ type: 'down', x: 5, y: 2, button: 'left' })
  await ui.pointer({ type: 'up', x: 5, y: 2, button: 'left' })
  const poked = parts(await ui.drawn({ in: 'clawd' }))
  expect(poked.alt).not.toBe(before)
  expect(poked.width).toBe(80)
  expect(poked.height).toBe(80)

  await clock.advance(10_000)
  expect(parts(await ui.drawn({ in: 'clawd' })).alt).toBe(before)
  await ui.unmount()
})

test('不能拖：按住拖出去再松手，不算点击，区域也不长大', async ($, on) => {
  const clock = mock.clock(on)
  stubWorld(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.resize({ columns: 10, rows: 4 })
  await clock.advance(2_000)
  const before = parts(await ui.drawn({ in: 'clawd' }))

  await ui.pointer({ type: 'down', x: 5, y: 2, button: 'left' })
  await ui.pointer({ type: 'move', x: -30, y: -6, button: 'left' })
  await ui.pointer({ type: 'up', x: -30, y: -6, button: 'left' })
  await clock.advance(2_000)
  const after = parts(await ui.drawn({ in: 'clawd' }))
  expect(after.alt).toBe(before.alt)
  expect(after.width).toBe(80)
  expect(after.height).toBe(80)
  expect(after.count).toBe(2) // 只有 Clawd 和接事件的那层 Box，没有撑子
  await ui.unmount()
})

test('跑仿真时放科研类动图', async ($, on) => {
  const clock = mock.clock(on)
  stubWorld(on)
  let release: () => void = () => undefined
  on('tool.call', () => new Promise(res => (release = () => res({ result: {} }))))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  await clock.advance(10_000)
  const running = $.tool.call({ tool: 'Bash', command: 'mumax3 film.mx3' })
  await clock.advance(9_000)

  const alt = parts(await ui.drawn({ in: 'clawd' })).alt
  expect(['科学家调药水', 'CPU过热', '沙漏等待'].some(zh => alt.includes(zh))).toBe(true)
  release()
  await running
  await ui.unmount()
})

test('干活途中工具换来换去，动图不跟着跳', async ($, on) => {
  const clock = mock.clock(on)
  stubWorld(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  await clock.advance(7_000)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(7_000)
  const first = parts(await ui.drawn({ in: 'clawd' })).alt
  expect(['盯着日志', '黑客帝国'].some(zh => first.includes(zh))).toBe(true)

  for (let i = 0; i < 7; i++) {
    if (i % 2 === 0) await $.tool.call({ tool: 'Read', file_path: 'a.py' })
    else await $.tool.call({ tool: 'Bash', command: 'ls' })
    await clock.advance(5_000)
    expect(parts(await ui.drawn({ in: 'clawd' })).alt).toBe(first)
  }

  // 过了最短间隔，确实换了活才换图
  await $.tool.call({ tool: 'Read', file_path: 'a.py' })
  await clock.advance(20_000)
  const later = parts(await ui.drawn({ in: 'clawd' })).alt
  expect(['戴眼镜看书', '书堆旁阅读', '侦探追脚印'].some(zh => later.includes(zh))).toBe(true)
  await ui.unmount()
})

test('同一个状态里动图长时间不变，也不用轮换', async ($, on) => {
  const clock = mock.clock(on)
  stubWorld(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  // 空闲十分钟不换
  await clock.advance(2_000)
  const idle = parts(await ui.drawn({ in: 'clawd' })).alt
  for (let i = 0; i < 10; i++) {
    await clock.advance(60_000)
    expect(parts(await ui.drawn({ in: 'clawd' })).alt).toBe(idle)
  }

  // 连续工具调用：同类工具一直调，动图也不换
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(7_000)
  const busy = parts(await ui.drawn({ in: 'clawd' })).alt
  expect(['盯着日志', '黑客帝国'].some(zh => busy.includes(zh))).toBe(true)
  for (let i = 0; i < 20; i++) {
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await clock.advance(5_000)
    expect(parts(await ui.drawn({ in: 'clawd' })).alt).toBe(busy)
  }
  await ui.unmount()
})
