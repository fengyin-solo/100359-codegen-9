<template>
  <section class="page" data-module="compilation">
    <header class="page-head">
      <div>
        <h2>数据整编管理</h2>
        <p class="page-desc">维护整编成果，按整编年份与站点做年度审阅，跟踪原始记录缺口、审核口径与年度封存。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记整编成果</button>
        <button class="btn" type="button" @click="exportRows">导出数据整编清单</button>
      </div>
    </header>

    <p class="view-tabs">
      <button class="btn" :class="{ primary: viewMode === 'annual' }" type="button" @click="switchView('annual')">
        年度审阅
      </button>
      <button class="btn" :class="{ primary: viewMode === 'list' }" type="button" @click="switchView('list')">
        成果列表
      </button>
    </p>

    <template v-if="viewMode === 'annual'">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">当前审核口径</span>
          <strong class="stat-value">{{ criteria.version }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">口径变更时间</span>
          <strong class="stat-value">{{ criteria.changedAt || '—' }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">待回填审核人</span>
          <strong class="stat-value">{{ missingReviewerRows.length }}</strong>
        </article>
      </div>

      <form class="filter-bar" @submit.prevent="reloadAnnual">
        <label class="filter-item">
          <span>整编年份</span>
          <select v-model="annualFilters.year">
            <option value="">全部年份</option>
            <option v-for="year in yearOptions" :key="year" :value="year">{{ year }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>站点编号</span>
          <input v-model="annualFilters.station" placeholder="按站点编号检索" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetAnnualFilters">重置条件</button>
      </form>

      <form class="filter-bar" @submit.prevent="submitCriteria">
        <label class="filter-item">
          <span>新审核口径</span>
          <select v-model="criteriaForm.version">
            <option v-for="version in criteriaVersions" :key="version" :value="version">{{ version }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>变更说明</span>
          <input v-model="criteriaForm.note" placeholder="口径调整原因" />
        </label>
        <button class="btn" type="submit">变更审核口径</button>
        <span class="filter-hint">变更后未刊印成果按新口径重算缺口，已刊印成果保持原审核快照</span>
      </form>

      <h3 class="section-title">年度封存</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>整编年份</th>
            <th>成果数</th>
            <th>原始记录缺口</th>
            <th>缺审核人</th>
            <th>封存状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="summary in yearSummaries" :key="summary.year">
            <td>{{ summary.year }}</td>
            <td>{{ summary.total }}</td>
            <td>{{ summary.recordGap }}</td>
            <td>
              <span v-if="summary.missingReviewer" class="error-text">{{ summary.missingReviewer }} 条待回填</span>
              <span v-else>—</span>
            </td>
            <td>{{ summary.sealed ? `已封存（${summary.sealedAt}）` : '未封存' }}</td>
            <td class="row-actions">
              <button
                class="link"
                type="button"
                :disabled="summary.missingReviewer > 0"
                :title="summary.missingReviewer > 0 ? '缺审核人的旧成果必须先回填归属' : ''"
                @click="seal(summary.year)"
              >
                {{ summary.sealed ? '再次封存' : '封存年度' }}
              </button>
            </td>
          </tr>
          <tr v-if="!yearSummaries.length">
            <td colspan="6" class="empty-state">暂无整编成果，无需封存</td>
          </tr>
        </tbody>
      </table>

      <h3 class="section-title">年度审阅（按整编年份与站点）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>整编年份</th>
            <th>站点编号</th>
            <th>待整编</th>
            <th>审核中</th>
            <th>已刊印</th>
            <th>原始记录缺口</th>
            <th>审核人</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in annualRows" :key="`${row.year}-${row.station}`">
            <td>{{ row.year }}</td>
            <td>{{ row.station }}</td>
            <td>{{ row.pendingCompile }}</td>
            <td>{{ row.inReview }}</td>
            <td>{{ row.published }}</td>
            <td>{{ row.recordGap }}</td>
            <td>
              {{ row.reviewers }}
              <span v-if="row.missingReviewer" class="error-text">（{{ row.missingReviewer }} 条缺审核人）</span>
            </td>
          </tr>
          <tr v-if="!annualRows.length">
            <td colspan="7" class="empty-state">暂无符合条件的整编成果</td>
          </tr>
        </tbody>
      </table>

      <template v-if="missingReviewerRows.length">
        <h3 class="section-title">缺审核人的旧成果（封存前必须回填归属）</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>成果编号</th>
              <th>整编年份</th>
              <th>站点编号</th>
              <th>整编类型</th>
              <th>当前状态</th>
              <th>回填审核人</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in missingReviewerRows" :key="String(row.id)">
              <td>{{ row['成果编号'] }}</td>
              <td>{{ row['整编年份'] }}</td>
              <td>{{ row['站点编号'] }}</td>
              <td>{{ row['整编类型'] }}</td>
              <td>{{ row.status }}</td>
              <td class="row-actions">
                <input v-model="backfillNames[Number(row.id)]" placeholder="审核人姓名" />
                <button class="link" type="button" @click="backfill(row)">回填归属</button>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>

    <template v-else>
      <div class="stat-row">
        <article v-for="item in stats" :key="item.label" class="stat-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value">{{ item.value }}</strong>
        </article>
      </div>

      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>

      <form class="filter-bar" @submit.prevent="reload">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>审核快照</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td>{{ snapshotLabel(row) }}</td>
            <td class="row-actions">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 3" class="empty-state">暂无数据整编数据，可先登记整编成果</td>
          </tr>
        </tbody>
      </table>
    </template>

    <footer class="page-foot">
      <span v-if="viewMode === 'list'">共 {{ total }} 条数据整编记录</span>
      <span v-else>年度审阅共 {{ annualRows.length }} 组（按整编年份与站点）</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  backfillReviewer,
  changeCriteria,
  currentCriteria,
  listAnnualReview,
  listCriteriaVersions,
  listMissingReviewer,
  listYearSummaries,
  publishResult,
  sealYear,
} from '@/api/compilation-review'
import type { AnnualReviewRow, CriteriaInfo, YearSummary } from '@/api/compilation-review'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('compilation')
const columns = ["成果编号", "整编年份", "站点编号", "整编类型", "原始记录数", "应有记录数", "整编人", "审核人", "口径版本", "整编状态"]
const actions = ["开始整编", "提交审核", "确认刊印", "驳回整编"]
const statuses = ["待整编", "整编中", "待审核", "已刊印", "已驳回"]
const stats = [{"label": "待整编年度", "value": 0}, {"label": "整编中年度", "value": 0}, {"label": "已刊印成果", "value": 0}]

const viewMode = ref<'annual' | 'list'>('annual')

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const annualRows = ref<AnnualReviewRow[]>([])
const yearSummaries = ref<YearSummary[]>([])
const missingReviewerRows = ref<EntryRow[]>([])
const criteria = ref<CriteriaInfo>(currentCriteria())
const criteriaVersions = listCriteriaVersions()
const criteriaForm = ref({ version: criteria.value.version, note: '' })
const annualFilters = ref({ year: '', station: '' })
const backfillNames = ref<Record<number, string>>({})
const yearOptions = computed(() => yearSummaries.value.map((summary) => summary.year))

function switchView(mode: 'annual' | 'list') {
  viewMode.value = mode
  errorMessage.value = ''
  noticeMessage.value = ''
}

function resetFilters() {
  filters.value = {}
  reload()
}

function resetAnnualFilters() {
  annualFilters.value = { year: '', station: '' }
  reloadAnnual()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '整编成果登记入口尚未接入审批流'
}

function snapshotLabel(row: EntryRow): string {
  const raw = row['审核快照']
  if (!raw) {
    return '—'
  }
  try {
    const snapshot = JSON.parse(String(raw)) as { 口径版本?: string; 刊印时间?: string }
    return `已留存（${snapshot.口径版本 ?? '?'} · ${snapshot.刊印时间 ?? '?'}）`
  } catch {
    return '已留存'
  }
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  // 确认刊印要走年度审阅服务：刊印时留存审核快照，通用动作只做状态流转。
  const result =
    action === '确认刊印'
      ? publishResult(Number(row.id))
      : applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
  reloadAnnual()
}

function submitCriteria() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = changeCriteria(criteriaForm.value.version, criteriaForm.value.note)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  criteriaForm.value.note = ''
  reloadAnnual()
  reload()
}

function seal(year: string) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = sealYear(year)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reloadAnnual()
}

function backfill(row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = backfillReviewer(Number(row.id), backfillNames.value[Number(row.id)] ?? '')
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reloadAnnual()
  reload()
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '数据整编列表读取失败'
  }
}

function reloadAnnual() {
  try {
    annualRows.value = listAnnualReview({
      year: annualFilters.value.year || undefined,
      station: annualFilters.value.station || undefined,
    })
    yearSummaries.value = listYearSummaries()
    missingReviewerRows.value = listMissingReviewer()
    criteria.value = currentCriteria()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '年度审阅数据读取失败'
  }
}

onMounted(() => {
  reload()
  reloadAnnual()
})
</script>
