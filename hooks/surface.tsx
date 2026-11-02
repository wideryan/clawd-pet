import type { ClientModule } from 'claude-code'

// 跑在桌面端沙箱 frame 里的 Clawd：画动图、听点击。这里没有 $，靠 post 告诉 hooks 模块。
//
// surface.elements 不列 Svg，但 h() 和桌面页面都接受它。不能拖，所以区域就是 Clawd 本身这么大：
// 没有撑子，没有抬高的区域，也不会铺满整行。

export type ClawdProps = { svg: string; alt: string; px: number }

const GRID = 40

// 让每个网格占整数个物理像素，否则屏幕缩放不是整数倍时像素画粗细不均
function crispPx(basePx: number): number {
  const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1
  const cell = Math.max(2, Math.round((basePx / GRID) * dpr))
  return (GRID * cell) / dpr
}

const Clawd: ClientModule<ClawdProps, boolean> = (props, surface) => {
  if (surface.state === undefined) {
    let isPressed = false
    surface.onPointer(ev => {
      if (ev.type === 'down') {
        isPressed = ev.button === 'left'
        return
      }
      if (ev.type !== 'up' || !isPressed) return
      isPressed = false
      // 按下后指针被区域抓住，在外面松手也会收到 up；只算在 Clawd 身上松手的
      const isInside = ev.x >= 0 && ev.x < surface.columns && ev.y >= 0 && ev.y < surface.rows
      if (isInside) surface.post({ t: 'click' })
    })
    surface.setState(true)
  }
  const { Box } = surface.elements
  const px = crispPx(props.px)
  const sprite = h('Svg', { source: props.svg, alt: props.alt, width: px, height: px, isInteractive: true })
  // iframe 会吃掉指针事件，所以盖一层透明的 Box 接事件
  return (
    <Box>
      {sprite}
      <Box position="absolute" top={0} left={0} right={0} bottom={0} />
    </Box>
  )
}

export default Clawd
