import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 年度审阅的业务规则都收在这里：审核口径、缺口重算、审核人回填、年度封存。
// 口径与封存记录和清单数据一样存在本机 localStorage，刷新不丢。
const CRITERIA_KEY = 'hydrology-monitor-station:review-criteria'
const SEAL_KEY = 'hydrology-monitor-station:compilation-seals'

export type ReviewCriteria = {
  version: string
  gapTolerancePercent: number
}

export type YearSeal = {
  year: string
  sealedAt: string
  operator: string
  criteriaVersion: string
  planCode: string
  inspectionCount: number
}

export type YearBucket = {
  year: string
  rows: EntryRow[]
  pendingCount: number
  reviewingCount: number
  publishedCount: number
  rejectedCount: number
  gapTotal: number
  staleCount: number
  missingReviewer: EntryRow[]
  seal: YearSeal | null
}

const DEFAULT_CRITERIA: ReviewCriteria = { version: 'V20260101', gapTolerancePercent: 5 }
const PUBLISHED = '已刊印'
// 「审核中」口径：整编中与待审核都还在审核流程里，年度审阅归为一档。
const REVIEWING = ['整编中', '待审核']

// 没有 localStorage 的环境（如脚本冒烟测试）退化为内存态，行为与 local-store 的缓存一致。
const memoryFallback = new Map<string, string>()

function readJson<T>(key: string, fallback: T): T {
  const raw =
    typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem(key)
      : (memoryFallback.get(key) ?? null)
  if (!raw) {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  const text = JSON.stringify(value)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, text)
  } else {
    memoryFallback.set(key, text)
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function nextCode(rows: EntryRow[], field: string, prefix: string): string {
  const max = rows.reduce((acc, row) => {
    const match = String(row[field] ?? '').match(/(\d+)$/)
    return match ? Math.max(acc, Number(match[1])) : acc
  }, 0)
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

export function loadCriteria(): ReviewCriteria {
  return readJson<ReviewCriteria>(CRITERIA_KEY, DEFAULT_CRITERIA)
}

export function gapOf(row: EntryRow): number {
  const expected = Number(row['应有记录数']) || 0
  const actual = Number(row['原始记录数']) || 0
  return Math.max(0, expected - actual)
}

export function gapRateOf(row: EntryRow): number {
  const expected = Number(row['应有记录数']) || 0
  if (expected <= 0) {
    return 0
  }
  return Math.round((gapOf(row) / expected) * 1000) / 10
}

export function conclusionOf(row: EntryRow, criteria: ReviewCriteria = loadCriteria()): string {
  return gapRateOf(row) <= criteria.gapTolerancePercent ? '合格' : '需补录原始记录'
}

// 刊印时把口径、缺口、结论定格成快照，之后口径怎么变都不影响这条成果。
export function buildSnapshot(row: EntryRow, criteria: ReviewCriteria = loadCriteria()): string {
  return `口径${criteria.version} · 缺口${gapOf(row)}条(${gapRateOf(row)}%) · 结论${conclusionOf(row, criteria)} · ${today()}刊印`
}

// 审核口径变化：只标记未刊印成果待重算，已刊印成果保持原审核快照不动。
export function changeCriteria(gapTolerancePercent: number): { criteria: ReviewCriteria; marked: number } {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)
  const criteria: ReviewCriteria = { version: `V${stamp}`, gapTolerancePercent }
  writeJson(CRITERIA_KEY, criteria)
  const rows = listRows('compilation')
  let marked = 0
  const next = rows.map((row) => {
    if (row.status === PUBLISHED) {
      return row
    }
    marked += 1
    return { ...row, 需重算: true }
  })
  saveRows('compilation', next)
  return { criteria, marked }
}

function recomputeRow(row: EntryRow, criteria: ReviewCriteria): EntryRow {
  return {
    ...row,
    口径版本: criteria.version,
    审核结论: conclusionOf(row, criteria),
    需重算: false,
  }
}

export function recomputeEntry(id: number): ActionResult {
  const rows = listRows('compilation')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的整编成果` }
  }
  if (rows[index].status === PUBLISHED) {
    return { ok: false, message: '已刊印成果保持原审核快照，不参与重算' }
  }
  const criteria = loadCriteria()
  const next = [...rows]
  next[index] = recomputeRow(rows[index], criteria)
  saveRows('compilation', next)
  return { ok: true, message: `成果 ${rows[index]['成果编号']} 已按口径 ${criteria.version} 重算` }
}

// 未完成年度按新规则补齐：本年度所有未刊印成果一次性重算。
export function recomputeYear(year: string): ActionResult {
  const criteria = loadCriteria()
  const rows = listRows('compilation')
  let count = 0
  const next = rows.map((row) => {
    if (String(row['整编年份']) !== year || row.status === PUBLISHED) {
      return row
    }
    count += 1
    return recomputeRow(row, criteria)
  })
  if (count === 0) {
    return { ok: false, message: `${year} 年度没有需要重算的未刊印成果` }
  }
  saveRows('compilation', next)
  return { ok: true, message: `${year} 年度已按口径 ${criteria.version} 重算 ${count} 项成果` }
}

export function backfillReviewer(id: number, reviewer: string): ActionResult {
  const name = reviewer.trim()
  if (!name) {
    return { ok: false, message: '回填归属前请先填写审核人' }
  }
  const rows = listRows('compilation')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的整编成果` }
  }
  const next = [...rows]
  next[index] = { ...rows[index], 审核人: name }
  saveRows('compilation', next)
  return { ok: true, message: `成果 ${rows[index]['成果编号']} 已回填审核人「${name}」` }
}

export function allSeals(): YearSeal[] {
  return readJson<YearSeal[]>(SEAL_KEY, [])
}

export function yearBuckets(): YearBucket[] {
  const seals = allSeals()
  const groups = new Map<string, EntryRow[]>()
  for (const row of listRows('compilation')) {
    const year = String(row['整编年份'] ?? '未标注')
    const list = groups.get(year) ?? []
    list.push(row)
    groups.set(year, list)
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, rows]) => ({
      year,
      rows: [...rows].sort((a, b) => String(a['站点编号']).localeCompare(String(b['站点编号']))),
      pendingCount: rows.filter((row) => row.status === '待整编').length,
      reviewingCount: rows.filter((row) => REVIEWING.includes(String(row.status))).length,
      publishedCount: rows.filter((row) => row.status === PUBLISHED).length,
      rejectedCount: rows.filter((row) => row.status === '已驳回').length,
      gapTotal: rows.reduce((sum, row) => sum + gapOf(row), 0),
      staleCount: rows.filter((row) => row['需重算'] === true).length,
      missingReviewer: rows.filter((row) => !String(row['审核人'] ?? '').trim()),
      seal: seals.find((seal) => seal.year === year) ?? null,
    }))
}

// 年度封存：先生成测报方案复核事项，再给巡检模块生成年度核对待办。
// 封存记录、复核事项、巡检待办都按年份去重，重复封存不产生副本。
export function sealYear(year: string, operator: string): ActionResult {
  if (allSeals().some((seal) => seal.year === year)) {
    return { ok: false, message: `${year} 年度已封存，复核事项与巡检待办不重复生成` }
  }
  const rows = listRows('compilation').filter((row) => String(row['整编年份']) === year)
  if (rows.length === 0) {
    return { ok: false, message: `${year} 年度没有整编成果，无需封存` }
  }
  const missing = rows.filter((row) => !String(row['审核人'] ?? '').trim())
  if (missing.length > 0) {
    return {
      ok: false,
      message: `封存前须先回填审核人归属：${missing.map((row) => row['成果编号']).join('、')}`,
    }
  }
  const criteria = loadCriteria()

  const plans = listRows('plan')
  const planName = `${year}年度整编成果复核事项`
  let planCode = String(plans.find((plan) => plan['方案名称'] === planName)?.['方案编号'] ?? '')
  if (!planCode) {
    planCode = nextCode(plans, '方案编号', 'PLAN')
    plans.push({
      id: nextId(plans),
      status: '编制中',
      pending: true,
      abnormal: false,
      方案编号: planCode,
      方案名称: planName,
      适用范围: `${year}年度整编成果`,
      监测项目: '整编成果复核',
      测次安排: '年度一次',
      编制人: operator,
      批准人: '',
      方案状态: '编制中',
    })
    saveRows('plan', plans)
  }

  const inspections = listRows('inspection')
  const topic = `${year}年度整编成果核对`
  const stations = [...new Set(rows.map((row) => String(row['站点编号'])))]
  let created = 0
  for (const station of stations) {
    const exists = inspections.some(
      (item) => item['检查项目'] === topic && String(item['站点编号']) === station,
    )
    if (exists) {
      continue
    }
    inspections.push({
      id: nextId(inspections),
      status: '待巡检',
      pending: true,
      abnormal: false,
      记录编号: nextCode(inspections, '记录编号', 'INSP'),
      站点编号: station,
      巡检日期: today(),
      巡检人员: '',
      检查项目: topic,
      发现问题: '',
      处理措施: '',
      巡检状态: '待巡检',
    })
    created += 1
  }
  if (created > 0) {
    saveRows('inspection', inspections)
  }

  const seal: YearSeal = {
    year,
    sealedAt: today(),
    operator,
    criteriaVersion: criteria.version,
    planCode,
    inspectionCount: created,
  }
  writeJson(SEAL_KEY, [...allSeals(), seal])
  return {
    ok: true,
    message: `${year} 年度已封存：生成测报方案复核事项 ${planCode}、巡检年度核对待办 ${created} 项`,
  }
}
