<template>
  <div class="editor-overlay" @click.self="$emit('close')">
    <div class="editor-card">
      <h3>{{ isEditing ? '编辑事件' : '新建事件' }}</h3>

      <div class="field">
        <label>标题</label>
        <input v-model="form.title" placeholder="事件名称" />
      </div>

      <div class="field">
        <label>日期</label>
        <input v-model="form.startDate" type="date" />
      </div>

      <div class="field">
        <label>时间</label>
        <input v-model="form.startTime" type="time" />
        <span class="hint">留空 = 全天事件</span>
      </div>

      <div class="field">
        <label>颜色</label>
        <div class="color-picks">
          <span
            v-for="c in colors"
            :key="c"
            class="color-dot"
            :class="{ active: form.color === c }"
            :style="{ background: c }"
            @click="form.color = c"
          />
        </div>
      </div>

      <!-- Recurrence -->
      <div class="field">
        <label>重复</label>
        <select v-model="form.recurrenceType">
          <option value="none">不重复</option>
          <option value="daily">每天</option>
          <option value="weekly">每周</option>
          <option value="monthly">每月</option>
          <option value="yearly">每年(公历)</option>
          <option value="lunar-yearly">每年(农历)</option>
        </select>
      </div>

      <!-- Lunar details (if lunar-yearly) -->
      <div v-if="form.recurrenceType === 'lunar-yearly'" class="lunar-fields">
        <div class="field">
          <label>农历月</label>
          <select v-model="form.lunarMonth">
            <option v-for="m in lunarMonthOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
          </select>
        </div>
        <div class="field">
          <label>农历日</label>
          <select v-model="form.lunarDay">
            <option v-for="d in 30" :key="d" :value="d">{{ lunarDayName(d) }}</option>
          </select>
        </div>
      </div>

      <!-- Reminders -->
      <div class="field">
        <label>提醒</label>
        <div class="reminder-list">
          <div v-for="(r, i) in form.reminders" :key="i" class="reminder-row">
            <select v-model="r.offsetMinutes">
              <option :value="0">事件开始时</option>
              <option :value="5">5分钟前</option>
              <option :value="15">15分钟前</option>
              <option :value="30">30分钟前</option>
              <option :value="60">1小时前</option>
              <option :value="120">2小时前</option>
              <option :value="1440">1天前</option>
              <option :value="2880">2天前</option>
              <option :value="4320">3天前</option>
            </select>
            <button class="remove-btn" @click="form.reminders.splice(i, 1)">✕</button>
          </div>
          <button class="add-reminder" @click="form.reminders.push({ offsetMinutes: 30, enabled: true })">+ 添加提醒</button>
        </div>
      </div>

      <div class="actions">
        <button v-if="isEditing" class="delete-btn" @click="confirmDelete">删除</button>
        <button class="cancel-btn" @click="$emit('close')">取消</button>
        <button class="save-btn" @click="save">保存</button>
      </div>

      <!-- Delete confirmation -->
      <div v-if="showDeleteConfirm" class="delete-confirm-overlay" @click.self="showDeleteConfirm = false">
        <div class="delete-confirm-card">
          <p>确定要删除「{{ form.title }}」吗？</p>
          <div class="confirm-actions">
            <button class="cancel-btn" @click="showDeleteConfirm = false">取消</button>
            <button class="confirm-delete-btn" @click="doDelete">确认删除</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, toRaw } from 'vue'

const props = defineProps<{ initialDate: string; editOccurrence?: any }>()
const emit = defineEmits(['close', 'save', 'update', 'delete'])

const isEditing = computed(() => !!props.editOccurrence?.eventId)
const showDeleteConfirm = ref(false)

const colors = ['#5B7FFF', '#7B68EE', '#EF4444', '#34C759', '#F59E0B', '#1ABC9C', '#8E44AD']

const lunarMonthOptions = [
  { value: 1, label: '正月' }, { value: 2, label: '二月' }, { value: 3, label: '三月' },
  { value: 4, label: '四月' }, { value: -4, label: '闰四月' }, { value: 5, label: '五月' },
  { value: 6, label: '六月' }, { value: -6, label: '闰六月' }, { value: 7, label: '七月' },
  { value: 8, label: '八月' }, { value: 9, label: '九月' }, { value: 10, label: '十月' },
  { value: 11, label: '冬月' }, { value: 12, label: '腊月' }
]

function lunarDayName(d: number): string {
  const names = ['初一','初二','初三','初四','初五','初六','初七','初八','初九','初十',
    '十一','十二','十三','十四','十五','十六','十七','十八','十九','二十',
    '廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十']
  return names[d - 1] || `${d}`
}

// Determine recurrence type from an existing occurrence
function recurrenceTypeFromRule(rule: any): string {
  if (!rule) return 'none'
  const map: Record<string, string> = {
    daily: 'daily', weekly: 'weekly', monthly: 'monthly',
    yearly: 'yearly', 'lunar-yearly': 'lunar-yearly'
  }
  return map[rule.type] || 'none'
}

const occ = props.editOccurrence

const form = reactive({
  title: occ?.title || '',
  startDate: occ?.date || props.initialDate,
  startTime: occ?.time || '',
  color: occ?.color || '#5B7FFF',
  recurrenceType: occ?.recurrence ? recurrenceTypeFromRule(occ.recurrence) : 'none',
  lunarMonth: occ?.recurrence?.lunarMonth || 1,
  lunarDay: occ?.recurrence?.lunarDay || 1,
  reminders: occ?.reminders?.length
    ? occ.reminders.map((r: any) => ({ offsetMinutes: r.offsetMinutes, enabled: r.enabled }))
    : [{ offsetMinutes: 30, enabled: true }]
})

function save() {
  const data: any = {
    title: form.title,
    startDate: form.startDate,
    startTime: form.startTime || undefined,
    color: form.color,
    reminders: form.reminders
  }

  // Build recurrence rule
  if (form.recurrenceType !== 'none') {
    const typeMap: Record<string, string> = {
      daily: 'daily', weekly: 'weekly', monthly: 'monthly',
      yearly: 'yearly', 'lunar-yearly': 'lunar-yearly'
    }
    data.recurrence = {
      type: typeMap[form.recurrenceType],
      interval: 1,
      endCondition: 'never'
    }

    if (form.recurrenceType === 'lunar-yearly') {
      data.recurrence.lunarMonth = form.lunarMonth
      data.recurrence.lunarDay = form.lunarDay
      data.lunarAnchor = {
        year: parseInt(form.startDate.substring(0, 4)),
        month: form.lunarMonth,
        day: form.lunarDay,
        isLeapMonth: form.lunarMonth < 0
      }
    }
  }

  const payload = JSON.parse(JSON.stringify(data))

  if (isEditing.value) {
    emit('update', occ?.eventId, payload)
  } else {
    emit('save', payload)
  }
}

function confirmDelete() {
  showDeleteConfirm.value = true
}

function doDelete() {
  emit('delete', occ?.eventId)
  showDeleteConfirm.value = false
}
</script>

<style scoped>
.editor-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.editor-card {
  background: #fff;
  border-radius: var(--radius);
  border: 1px solid var(--color-border);
  padding: 20px;
  width: 420px;
  max-height: 90vh;
  overflow-y: auto;
}

.editor-card h3 { margin-bottom: 16px; font-weight: 500; }

.field {
  margin-bottom: 12px;
}

.field label {
  display: block;
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: 4px;
}

.field input, .field select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  font-size: 14px;
  background: #fff;
  transition: border-color var(--transition);
}

.field input:focus, .field select:focus {
  border-color: var(--color-primary);
  outline: none;
}

.hint { font-size: 11px; color: var(--color-text-secondary); margin-left: 4px; }

.color-picks {
  display: flex;
  gap: 8px;
}

.color-dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  cursor: pointer;
  border: 1px solid transparent;
  transition: border-color var(--transition);
}

.color-dot.active { border-color: var(--color-text); }

.lunar-fields {
  background: var(--color-bg);
  padding: 8px;
  border-radius: var(--radius);
  margin-bottom: 12px;
}

.reminder-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.reminder-row {
  display: flex;
  gap: 4px;
  align-items: center;
}

.reminder-row select { flex: 1; }
.remove-btn { border: none; background: none; color: var(--color-danger); cursor: pointer; font-size: 14px; }

.add-reminder {
  color: var(--color-primary);
  background: rgba(91, 127, 255, 0.06);
  border: none;
  padding: 6px;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 12px;
  margin-top: 4px;
  transition: background var(--transition);
}

.add-reminder:hover {
  background: rgba(91, 127, 255, 0.12);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.cancel-btn {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  border-radius: var(--radius);
  cursor: pointer;
  transition: background var(--transition);
}

.cancel-btn:hover {
  background: rgba(0, 0, 0, 0.04);
}

.save-btn {
  padding: 8px 16px;
  border: none;
  background: var(--color-primary);
  color: #fff;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background var(--transition);
}

.save-btn:hover {
  background: var(--color-primary-hover);
}

.delete-btn {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--color-danger);
  border-radius: var(--radius);
  cursor: pointer;
  transition: background var(--transition);
}

.delete-btn:hover {
  background: rgba(239, 68, 68, 0.08);
}

.delete-confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
}

.delete-confirm-card {
  background: #fff;
  border-radius: var(--radius);
  border: 1px solid var(--color-border);
  padding: 24px;
  width: 320px;
  text-align: center;
}

.delete-confirm-card p {
  font-size: 16px;
  margin-bottom: 16px;
}

.confirm-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.confirm-delete-btn {
  padding: 8px 16px;
  border: none;
  background: var(--color-danger);
  color: #fff;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background var(--transition);
}

.confirm-delete-btn:hover {
  background: #DC2626;
}
</style>
