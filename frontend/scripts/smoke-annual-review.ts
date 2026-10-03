import {
  backfillReviewer,
  changeCriteria,
  loadCriteria,
  recomputeEntry,
  recomputeYear,
  sealYear,
  yearBuckets,
} from '@/api/annual-review'
import { listRows } from '@/data/local-store'

let failures = 0
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`ok  - ${label}`)
  } else {
    failures += 1
    console.log(`FAIL- ${label}`, extra ?? '')
  }
}

// 1. 年度分桶：2024 三项已刊印，2025 待整编1/审核中2/已驳回1
const buckets = yearBuckets()
const b2024 = buckets.find((b) => b.year === '2024')!
const b2025 = buckets.find((b) => b.year === '2025')!
check('2024 已刊印 3 项', b2024.publishedCount === 3, b2024)
check('2025 待整编1/审核中2/已驳回1', b2025.pendingCount === 1 && b2025.reviewingCount === 2 && b2025.rejectedCount === 1)
check('2024 缺口合计 14 条', b2024.gapTotal === 14, b2024.gapTotal)
check('缺审核人成果被识别', b2024.missingReviewer.length === 1 && b2025.missingReviewer.length === 1)

// 2. 缺审核人时封存被拦截
const blocked = sealYear('2024', '值班管理员')
check('缺审核人封存被拦截', !blocked.ok && blocked.message.includes('COMP-2024-02'), blocked.message)

// 3. 回填归属后封存成功，生成复核事项与巡检待办
check('回填审核人', backfillReviewer(2, '刘工').ok)
const sealed = sealYear('2024', '值班管理员')
check('回填后封存成功', sealed.ok, sealed.message)
const plans = listRows('plan')
const inspections = listRows('inspection')
check('生成 1 条测报方案复核事项', plans.filter((p) => p['方案名称'] === '2024年度整编成果复核事项').length === 1)
check('生成 3 条巡检年度核对待办', inspections.filter((i) => i['检查项目'] === '2024年度整编成果核对').length === 3,
  inspections.map((i) => [i['站点编号'], i['检查项目']]))

// 4. 重复封存不产生副本
const again = sealYear('2024', '值班管理员')
check('重复封存被拒绝', !again.ok)
check('复核事项无副本', listRows('plan').filter((p) => p['方案名称'] === '2024年度整编成果复核事项').length === 1)
check('巡检待办无副本', listRows('inspection').filter((i) => i['检查项目'] === '2024年度整编成果核对').length === 3)

// 5. 口径变更：未刊印 4 项标记待重算，已刊印保持快照
const before = listRows('compilation').find((r) => r.id === 1)!
const { criteria, marked } = changeCriteria(0)
check('口径版本已更新', loadCriteria().version === criteria.version)
check('4 项未刊印成果待重算', marked === 4, marked)
const after = listRows('compilation')
check('已刊印成果保持原快照', after.find((r) => r.id === 1)!['审核快照'] === before['审核快照'])
check('未刊印成果已标记', after.filter((r) => r['需重算'] === true).length === 4)

// 6. 已刊印不可重算；未完成年度按新规则补齐
check('已刊印重算被拒', !recomputeEntry(1).ok)
const rec = recomputeYear('2025')
check('2025 年度重算 4 项', rec.ok && rec.message.includes('4'), rec.message)
const st101 = listRows('compilation').find((r) => r.id === 4)!
check('新口径 0 容忍下缺口 25 条需补录', st101['审核结论'] === '需补录原始记录' && st101['需重算'] === false)
check('重算后口径版本更新', st101['口径版本'] === criteria.version)

if (failures > 0) {
  console.log(`\n${failures} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
