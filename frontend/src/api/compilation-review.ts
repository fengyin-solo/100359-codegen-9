import { MODULES } from '@/data/modules'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 年度审阅专用逻辑：审核口径、缺口重算、年度封存都放在这里，通用列表服务保持不变。
// 口径变更时的重算口径（由实现方拍板）：未刊印的成果（待整编/整编中/待审核/已驳回）一律按新口径
// 重算应有记录数并补齐缺口；已刊印成果不动，刊印时留存的审核快照就是它的历史凭证。

const COMPILATION_KEY = 'compilation'
const SEAL_KEY = 'compilationSeal'
const CRITERIA_KEY = 'compilationCriteria'

const PUBLISHED = '已刊印'
// 年度审阅里的「审核中」桶：已进入整编流转但还没刊印的成果。
const IN_REVIEW_STATUSES = ['整编中', '待审核', '已驳回']

// 每版审核口径给出各整编类型一年应有的原始记录条数，缺口 = 应有 - 实有。
const CRITERIA_RULES: Record<string, { expectedByType: Record<string, number>; fallback: number }> = {
  '2024版': { expectedByType: { 水位年刊: 12, 流量年刊: 12, 雨量年刊: 12 }, fallback: 12 },
  '2026版': { expectedByType: { 水位年刊: 365, 流量年刊: 365, 雨量年刊: 365 }, fallback: 365 },
}

export type AnnualReviewRow = {
  year: string
  station: string
  pendingCompile: number
  inReview: number
  published: number
  recordGap: number
  reviewers: string
  missingReviewer: number
}

export type YearSummary = {
  year: string
  total: number
  recordGap: number
  missingReviewer: number
  sealed: boolean
  sealedAt: string
}

export type CriteriaInfo = {
  version: string
  changedAt: string
  note: string
}

function compilationRows(): EntryRow[] {
  return listRows(COMPILATION_KEY)
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function expectedOf(version: string, type: string): number {
  const rule = CRITERIA_RULES[version]
  if (!rule) {
    return 0
  }
  return rule.expectedByType[type] ?? rule.fallback
}

function gapOf(row: EntryRow): number {
  const expected = Number(row['应有记录数'] ?? 0)
  const actual = Number(row['原始记录数'] ?? 0)
  return Math.max(0, expected - actual)
}

function reviewerOf(row: EntryRow): string {
  return String(row['审核人'] ?? '').trim()
}

export function listCriteriaVersions(): string[] {
  return Object.keys(CRITERIA_RULES)
}

export function currentCriteria(): CriteriaInfo {
  const rows = listRows(CRITERIA_KEY)
  if (rows.length) {
    return {
      version: String(rows[0]['当前口径']),
      changedAt: String(rows[0]['变更时间'] ?? ''),
      note: String(rows[0]['变更说明'] ?? ''),
    }
  }
  // 首次使用还没有口径记录，沿用在库成果的口径版本。
  const existing = compilationRows()
    .map((row) => String(row['口径版本'] ?? ''))
    .find((version) => version !== '')
  return { version: existing ?? listCriteriaVersions()[0], changedAt: '', note: '沿用在库成果口径' }
}

export function listAnnualReview(filters: { year?: string; station?: string } = {}): AnnualReviewRow[] {
  type Group = AnnualReviewRow & { reviewerSet: Set<string> }
  const groups = new Map<string, Group>()
  for (const row of compilationRows()) {
    const year = String(row['整编年份'] ?? '')
    const station = String(row['站点编号'] ?? '')
    if (filters.year && year !== filters.year) {
      continue
    }
    if (filters.station && !station.includes(filters.station.trim())) {
      continue
    }
    const key = `${year}::${station}`
    let group = groups.get(key)
    if (!group) {
      group = {
        year,
        station,
        pendingCompile: 0,
        inReview: 0,
        published: 0,
        recordGap: 0,
        reviewers: '',
        missingReviewer: 0,
        reviewerSet: new Set<string>(),
      }
      groups.set(key, group)
    }
    const status = String(row.status)
    if (status === '待整编') {
      group.pendingCompile += 1
    } else if (status === PUBLISHED) {
      group.published += 1
    } else if (IN_REVIEW_STATUSES.includes(status)) {
      group.inReview += 1
    }
    group.recordGap += gapOf(row)
    const reviewer = reviewerOf(row)
    if (reviewer) {
      group.reviewerSet.add(reviewer)
    } else {
      group.missingReviewer += 1
    }
  }
  return [...groups.values()]
    .map(({ reviewerSet, ...rest }) => ({ ...rest, reviewers: [...reviewerSet].join('、') || '—' }))
    .sort((a, b) => (a.year === b.year ? a.station.localeCompare(b.station) : b.year.localeCompare(a.year)))
}

export function listYearSummaries(): YearSummary[] {
  const seals = new Map(listRows(SEAL_KEY).map((row) => [String(row['年份']), String(row['封存时间'] ?? '')]))
  const summaries = new Map<string, YearSummary>()
  for (const row of compilationRows()) {
    const year = String(row['整编年份'] ?? '')
    let summary = summaries.get(year)
    if (!summary) {
      summary = { year, total: 0, recordGap: 0, missingReviewer: 0, sealed: false, sealedAt: '' }
      summaries.set(year, summary)
    }
    summary.total += 1
    summary.recordGap += gapOf(row)
    if (!reviewerOf(row)) {
      summary.missingReviewer += 1
    }
  }
  for (const summary of summaries.values()) {
    const sealedAt = seals.get(summary.year)
    if (sealedAt !== undefined) {
      summary.sealed = true
      summary.sealedAt = sealedAt
    }
  }
  return [...summaries.values()].sort((a, b) => b.year.localeCompare(a.year))
}

export function listMissingReviewer(): EntryRow[] {
  return compilationRows().filter((row) => !reviewerOf(row))
}

export function changeCriteria(
  version: string,
  note: string,
): ActionResult & { recalculated: number; keptSnapshot: number } {
  if (!CRITERIA_RULES[version]) {
    return { ok: false, message: `没有登记「${version}」这套审核口径`, recalculated: 0, keptSnapshot: 0 }
  }
  if (currentCriteria().version === version) {
    return { ok: false, message: `审核口径已经是「${version}」，不用重复变更`, recalculated: 0, keptSnapshot: 0 }
  }
  let recalculated = 0
  let keptSnapshot = 0
  const next = compilationRows().map((row) => {
    // 已刊印成果保持原审核快照，不参与重算。
    if (String(row.status) === PUBLISHED) {
      keptSnapshot += 1
      return row
    }
    recalculated += 1
    return {
      ...row,
      应有记录数: expectedOf(version, String(row['整编类型'] ?? '')),
      口径版本: version,
    }
  })
  saveRows(COMPILATION_KEY, next)
  saveRows(CRITERIA_KEY, [
    {
      id: 1,
      status: '已生效',
      pending: false,
      abnormal: false,
      当前口径: version,
      变更时间: today(),
      变更说明: note.trim() || '年度审阅口径调整',
    },
  ])
  return {
    ok: true,
    message: `审核口径已切换为「${version}」：重算 ${recalculated} 条未刊印成果，${keptSnapshot} 条已刊印成果保持原审核快照`,
    recalculated,
    keptSnapshot,
  }
}

export function backfillReviewer(id: number, reviewer: string): ActionResult {
  const name = reviewer.trim()
  if (!name) {
    return { ok: false, message: '回填归属时审核人不能为空' }
  }
  const rows = compilationRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的整编成果` }
  }
  if (reviewerOf(rows[index])) {
    return { ok: false, message: `成果 ${rows[index]['成果编号']} 已有审核人，不用重复回填` }
  }
  const next = [...rows]
  next[index] = { ...rows[index], 审核人: name }
  saveRows(COMPILATION_KEY, next)
  return { ok: true, message: `成果 ${rows[index]['成果编号']} 已回填审核人「${name}」` }
}

// 确认刊印走这里而不是通用动作：刊印瞬间把口径、审核人、缺口固化为审核快照。
export function publishResult(id: number): ActionResult {
  const rows = compilationRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的整编成果` }
  }
  const row = rows[index]
  if (String(row.status) === PUBLISHED) {
    return { ok: false, message: `成果 ${row['成果编号']} 已刊印，不用重复操作` }
  }
  const reviewer = reviewerOf(row)
  if (!reviewer) {
    return { ok: false, message: `成果 ${row['成果编号']} 缺审核人，刊印前请先回填归属` }
  }
  const snapshot = JSON.stringify({
    口径版本: String(row['口径版本'] ?? ''),
    审核人: reviewer,
    应有记录数: Number(row['应有记录数'] ?? 0),
    原始记录数: Number(row['原始记录数'] ?? 0),
    刊印时间: today(),
  })
  const next = [...rows]
  next[index] = { ...row, status: PUBLISHED, 整编状态: PUBLISHED, pending: false, abnormal: false, 审核快照: snapshot }
  saveRows(COMPILATION_KEY, next)
  return { ok: true, message: `成果 ${row['成果编号']} 已刊印，审核快照已留存` }
}

// 年度封存：一个年份只封一次，重复封存不产生副本。
// 封存时联动生成测报方案复核事项、巡检待办，以及其他有待处理记录模块的年度核对事项。
export function sealYear(year: string): ActionResult {
  const rows = compilationRows().filter((row) => String(row['整编年份']) === year)
  if (!rows.length) {
    return { ok: false, message: `${year} 年度没有整编成果，无需封存` }
  }
  const seals = listRows(SEAL_KEY)
  if (seals.some((row) => String(row['年份']) === year)) {
    return { ok: true, message: `${year} 年度已封存，重复封存不产生副本` }
  }
  const missing = rows.filter((row) => !reviewerOf(row))
  if (missing.length) {
    const codes = missing.map((row) => String(row['成果编号'])).join('、')
    return { ok: false, message: `${year} 年度还有 ${missing.length} 条旧成果缺审核人（${codes}），必须先回填归属再封存` }
  }
  const date = today()
  const stations = [...new Set(rows.map((row) => String(row['站点编号'] ?? '')).filter(Boolean))].join('、')
  const types = [...new Set(rows.map((row) => String(row['整编类型'] ?? '')).filter(Boolean))].join('、')

  // 1) 测报方案复核事项：按年度一条，方案编号幂等。
  const plans = listRows('plan')
  const planCode = `PLAN-REV-${year}`
  let planCreated = 0
  if (!plans.some((row) => String(row['方案编号']) === planCode)) {
    plans.push({
      id: nextId(plans),
      status: '编制中',
      pending: true,
      abnormal: false,
      方案编号: planCode,
      方案名称: `${year}年度测报方案复核`,
      适用范围: stations || '全部站点',
      监测项目: types || '整编成果',
      测次安排: '年度封存复核',
      编制人: '整编组',
      批准人: '待批准',
      方案状态: '编制中',
    })
    planCreated = 1
    saveRows('plan', plans)
  }

  // 2) 巡检待办 + 3) 其他模块的年度核对事项：都进巡检模块，记录编号幂等。
  const inspections = listRows('inspection')
  let sealTodos = 0
  let checkItems = 0
  const pushInspection = (code: string, item: string, found: string, kind: 'seal' | 'check') => {
    if (inspections.some((row) => String(row['记录编号']) === code)) {
      return
    }
    inspections.push({
      id: nextId(inspections),
      status: '待巡检',
      pending: true,
      abnormal: false,
      记录编号: code,
      站点编号: stations || '全部站点',
      巡检日期: date,
      巡检人员: '待指派',
      检查项目: item,
      发现问题: found,
      处理措施: '年度封存后核对',
      巡检状态: '待巡检',
    })
    if (kind === 'seal') {
      sealTodos += 1
    } else {
      checkItems += 1
    }
  }
  pushInspection(`INSP-SEAL-${year}`, `${year}年度整编成果封存巡检`, `封存成果${rows.length}条`, 'seal')
  for (const meta of MODULES) {
    if (meta.key === COMPILATION_KEY || meta.key === 'plan' || meta.key === 'inspection') {
      continue
    }
    const pendingCount = listRows(meta.key).filter((row) => row.pending).length
    if (!pendingCount) {
      continue
    }
    pushInspection(`INSP-CHK-${year}-${meta.key}`, `${year}年度${meta.name}数据核对`, `待处理记录${pendingCount}条`, 'check')
  }
  saveRows('inspection', inspections)

  seals.push({
    id: nextId(seals),
    status: '已封存',
    pending: false,
    abnormal: false,
    年份: year,
    封存时间: date,
    成果数: rows.length,
    方案复核事项: planCreated,
    巡检待办: sealTodos,
    年度核对事项: checkItems,
  })
  saveRows(SEAL_KEY, seals)
  return {
    ok: true,
    message: `${year} 年度已封存：生成测报方案复核事项 ${planCreated} 项、巡检待办 ${sealTodos} 项、其他模块年度核对事项 ${checkItems} 项`,
  }
}
