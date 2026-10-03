<template>
  <section class="page" data-module="compilation-review">
    <header class="page-head">
      <div>
        <h2>整编成果年度审阅</h2>
        <p class="page-desc">按整编年份与站点审阅待整编、审核中、已刊印成果，跟踪原始记录缺口与审核人归属。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">返回整编列表</button>
        <button class="btn primary" type="button" @click="openCriteriaChange">变更审核口径</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">当前审核口径</span>
        <strong class="stat-value">{{ criteria.version }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">缺口容忍率</span>
        <strong class="stat-value">{{ criteria.gapTolerancePercent }}%</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待重算成果</span>
        <strong class="stat-value">{{ staleTotal }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已封存年度</span>
        <strong class="stat-value">{{ sealedTotal }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span class="legend-item">口径变更后：未完成年度按新规则重算补齐</span>
      <span class="legend-item">已刊印成果保持原审核快照，不参与重算</span>
      <span class="legend-item">年度封存前须先回填全部审核人归属</span>
    </p>

    <p v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</p>

    <article v-for="bucket in buckets" :key="bucket.year" class="year-block">
      <header class="year-head">
        <h3>{{ bucket.year }} 年度</h3>
        <span class="legend-item">待整编 {{ bucket.pendingCount }}</span>
        <span class="legend-item">审核中 {{ bucket.reviewingCount }}</span>
        <span class="legend-item">已刊印 {{ bucket.publishedCount }}</span>
        <span v-if="bucket.rejectedCount" class="legend-item">已驳回 {{ bucket.rejectedCount }}</span>
        <span class="legend-item">记录缺口合计 {{ bucket.gapTotal }} 条</span>
        <span v-if="bucket.staleCount" class="legend-item stale-chip">待重算 {{ bucket.staleCount }}</span>
        <span v-if="bucket.seal" class="legend-item sealed-chip">
          已封存 · {{ bucket.seal.sealedAt }} · {{ bucket.seal.operator }}
        </span>
        <span class="year-actions">
          <button
            v-if="bucket.staleCount"
            class="btn"
            type="button"
            @click="recomputeWholeYear(bucket.year)"
          >
            按新口径重算本年度（{{ bucket.staleCount }}）
          </button>
          <button
            class="btn primary"
            type="button"
            :disabled="Boolean(bucket.seal)"
            @click="seal(bucket.year)"
          >
            {{ bucket.seal ? '已封存' : '年度封存' }}
          </button>
        </span>
      </header>
      <p v-if="bucket.seal" class="seal-note">
        封存口径 {{ bucket.seal.criteriaVersion }}：已生成测报方案复核事项 {{ bucket.seal.planCode }}、
        巡检年度核对待办 {{ bucket.seal.inspectionCount }} 项，重复封存不产生副本。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>站点编号</th>
            <th>成果编号</th>
            <th>整编类型</th>
            <th>状态</th>
            <th>原始记录数</th>
            <th>应有记录数</th>
            <th>记录缺口</th>
            <th>审核人</th>
            <th>审核口径</th>
            <th>审核结论</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in bucket.rows" :key="Number(row.id)">
            <td>{{ row['站点编号'] }}</td>
            <td>{{ row['成果编号'] }}</td>
            <td>{{ row['整编类型'] }}</td>
            <td>{{ row.status }}</td>
            <td>{{ row['原始记录数'] }}</td>
            <td>{{ row['应有记录数'] }}</td>
            <td>{{ gapText(row) }}</td>
            <td>
              <span v-if="row['审核人']">{{ row['审核人'] }}</span>
              <span v-else class="reviewer-missing">
                <input v-model="reviewerDrafts[Number(row.id)]" placeholder="回填审核人" />
                <button class="link" type="button" @click="backfill(row)">回填归属</button>
              </span>
            </td>
            <td>
              <template v-if="row.status === '已刊印'">快照：{{ row['审核快照'] }}</template>
              <template v-else>
                {{ row['口径版本'] || '—' }}
                <span v-if="row['需重算']" class="stale-text">（待重算）</span>
              </template>
            </td>
            <td>{{ row.status === '已刊印' ? '见快照' : row['审核结论'] || '—' }}</td>
            <td class="row-actions">
              <button v-if="row['需重算']" class="link" type="button" @click="recomputeOne(row)">
                按新口径重算
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </article>

    <footer class="page-foot">
      <span>共 {{ buckets.length }} 个整编年度</span>
      <span>封存会同步生成测报方案复核事项与巡检模块的年度核对待办</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  backfillReviewer,
  changeCriteria,
  gapOf,
  gapRateOf,
  loadCriteria,
  recomputeEntry,
  recomputeYear,
  sealYear,
  yearBuckets,
} from '@/api/annual-review'
import type { ReviewCriteria, YearBucket } from '@/api/annual-review'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const router = useRouter()
const store = useSessionStore()

const criteria = ref<ReviewCriteria>(loadCriteria())
const buckets = ref<YearBucket[]>([])
const reviewerDrafts = ref<Record<number, string>>({})
const message = ref('')
const messageOk = ref(false)

const staleTotal = computed(() => buckets.value.reduce((sum, bucket) => sum + bucket.staleCount, 0))
const sealedTotal = computed(() => buckets.value.filter((bucket) => bucket.seal).length)

function gapText(row: EntryRow): string {
  return `${gapOf(row)} 条（${gapRateOf(row)}%）`
}

function notify(result: { ok: boolean; message: string }) {
  message.value = result.message
  messageOk.value = result.ok
}

function goBack() {
  router.push('/compilation')
}

function openCriteriaChange() {
  const input = window.prompt(
    `当前口径 ${criteria.value.version}：缺口容忍率 ${criteria.value.gapTolerancePercent}%。请输入新的缺口容忍率（%）：`,
    String(criteria.value.gapTolerancePercent),
  )
  if (input === null) {
    return
  }
  const tolerance = Number(input)
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 100) {
    notify({ ok: false, message: '缺口容忍率需为 0-100 的数字' })
    return
  }
  const result = changeCriteria(tolerance)
  criteria.value = result.criteria
  notify({
    ok: true,
    message: `审核口径已变更为 ${result.criteria.version}，${result.marked} 项未刊印成果待按新规则重算；已刊印成果保持原审核快照`,
  })
  reload()
}

function backfill(row: EntryRow) {
  const id = Number(row.id)
  notify(backfillReviewer(id, reviewerDrafts.value[id] ?? ''))
  reviewerDrafts.value[id] = ''
  reload()
}

function recomputeOne(row: EntryRow) {
  notify(recomputeEntry(Number(row.id)))
  reload()
}

function recomputeWholeYear(year: string) {
  notify(recomputeYear(year))
  reload()
}

function seal(year: string) {
  notify(sealYear(year, store.operator))
  reload()
}

function reload() {
  criteria.value = loadCriteria()
  buckets.value = yearBuckets()
}

onMounted(reload)
</script>
