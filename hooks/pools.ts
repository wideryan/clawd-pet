// 状态和动图的对应（数字是 clawd-400 的编号）。每个状态两三个动图：进入状态时选一个，
// 一直循环到状态变化，中途不换。

export const STATES = {
  idle: [7, 20, 35], // 戴耳机点头、书桌喝咖啡、抿一口茶
  sleeping: [23, 147], // 看书打瞌睡、盖被子睡觉
  thinking: [190, 19], // 思考中、书桌前思考
  research: [22, 24, 305], // 戴眼镜看书、书堆旁阅读、侦探追脚印
  coding: [18, 173, 186], // 书桌打字、笔记本打字、咖啡变代码
  debug: [177, 176, 223], // 放大镜找 bug、踩扁 bug、单步调试
  creating: [191, 46], // 扳手拧齿轮、工地拧螺丝
  writing: [346, 192], // 老师写黑板、翻长文档
  running: [175, 208], // 盯着日志、黑客帝国
  simulating: [312, 198, 189], // 科学家调药水、CPU 过热、沙漏等待
  waiting: [87, 101], // 可怜巴巴、一脸问号
} as const satisfies Record<string, readonly number[]>

export type State = keyof typeof STATES

// 只有你点它时才放，放完回到原来那个动图
export const REACTIONS = {
  poke: [65, 64, 63], // 捂嘴偷笑、怕痒、眨眼放电
  annoyed: [82, 108], // 哼!不理你、翻白眼
  rage: [79], // 气到跺脚
} as const satisfies Record<string, readonly number[]>

export type ReactionName = keyof typeof REACTIONS

// 小模型判断用户这条消息主要要做什么。chat 表示没有明确的活，按实际用的工具走。
export const INTENTS: Readonly<Record<string, State | null>> = {
  coding: 'coding',
  debug: 'debug',
  creating: 'creating',
  writing: 'writing',
  research: 'research',
  simulating: 'simulating',
  running: 'running',
  chat: null,
}

export const INTENT_SYSTEM =
  '判断用户这条消息要 Claude 做的主要事情，只回复下面一个英文词，不要其他内容：\n' +
  'coding 写或改代码\n' +
  'debug 排查、修复错误或 bug\n' +
  'creating 从零新建项目、工具、功能\n' +
  'writing 写文档、论文、报告，润色或翻译\n' +
  'research 查资料、读代码、解释、分析\n' +
  'simulating 跑仿真、做数值计算、处理数据\n' +
  'running 运行已有脚本或命令、安装、部署\n' +
  'chat 闲聊或简单问答'

const DOC_FILE = /\.(md|mdx|tex|bib|txt|rst|docx?|pptx?)$/i
const TEST_CMD = /\b(pytest|jest|vitest|mocha|ctest|unittest|tox|go test|cargo test|(npm|pnpm|yarn)( run)? test)\b/
const SIM_CMD = /\b(mumax3?|oommf|comsol|matlab|octave|lammps|fdtd)\b/i

function strField(e: Record<string, unknown>, key: string): string {
  const v = e[key]
  return typeof v === 'string' ? v : ''
}

export function isTestCommand(tool: string, e: Record<string, unknown>): boolean {
  return (tool === 'Bash' || tool === 'PowerShell') && TEST_CMD.test(strField(e, 'command'))
}

/** 工具调用对应的状态；不说明在干什么的工具（列计划、收尾上报等）返回 null。 */
export function stateOfTool(tool: string, e: Record<string, unknown>): State | null {
  switch (tool) {
    case 'Read':
    case 'Grep':
    case 'Glob':
    case 'WebSearch':
    case 'WebFetch':
      return 'research'
    case 'Edit':
    case 'NotebookEdit':
      return DOC_FILE.test(strField(e, 'file_path')) ? 'writing' : 'coding'
    case 'Write':
      return DOC_FILE.test(strField(e, 'file_path')) ? 'writing' : 'creating'
    case 'Bash':
    case 'PowerShell': {
      const cmd = strField(e, 'command')
      if (SIM_CMD.test(cmd)) return 'simulating'
      return TEST_CMD.test(cmd) ? 'debug' : 'running'
    }
  }
  return tool.startsWith('mcp__Claude_Browser__') || tool.startsWith('mcp__claude-in-chrome__') ? 'research' : null
}
