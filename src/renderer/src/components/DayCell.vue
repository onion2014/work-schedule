<template>
  <div
    class="day-cell"
    :class="{ today: day.isToday, selected: selected, other: !day.isCurrentMonth }"
    @click="$emit('select', day.date)"
  >
    <div class="day-number">{{ day.day }}</div>
    <div v-if="day.lunar" class="lunar-line">
      <span class="lunar-day">{{ day.lunar.dayName }}</span>
      <span v-if="day.lunar.solarTerm" class="jieqi-label">{{ day.lunar.solarTerm }}</span>
    </div>
    <div v-if="day.lunar?.isLeapMonth" class="leap-indicator">闰</div>
    <!-- Event indicators (up to 2 visible + "+N" overflow) -->
    <div class="occ-indicators">
      <div
        v-for="(occ, i) in visibleOccs"
        :key="i"
        class="occ-bar"
        :style="{ background: occ.color }"
      >
        <span class="occ-text">{{ occ.title }}</span>
        <span class="occ-progress">{{ occ.progress }}%</span>
        <div class="progress-stripe" :style="{ width: (occ.progress || 0) + '%' }"></div>
      </div>
      <div v-if="overflowCount > 0" class="occ-overflow">+{{ overflowCount }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  day: any
  occurrences: any[]
  selected: boolean
}>()

defineEmits(['select', 'add'])

const MAX_VISIBLE = 2
const visibleOccs = computed(() => props.occurrences.slice(0, MAX_VISIBLE))
const overflowCount = computed(() => props.occurrences.length - MAX_VISIBLE)
</script>

<style scoped>
.day-cell {
  width: 120px;
  min-height: 76px;
  padding: 4px 6px;
  border-radius: var(--radius);
  cursor: pointer;
  position: relative;
  background: transparent;
  transition: background var(--transition);
  margin: 2px;
}

.day-cell:hover { background: rgba(0, 0, 0, 0.03); }
.day-cell.today { background: rgba(91, 127, 255, 0.08); }
.day-cell.selected { background: rgba(91, 127, 255, 0.15); outline: 1px solid var(--color-primary); }
.day-cell.other { opacity: 0.4; }

.day-number {
  font-size: 14px;
  font-weight: 500;
  text-align: center;
}

.today .day-number { color: var(--color-primary); }

.lunar-line {
  font-size: 11px;
  color: var(--color-text-secondary);
  margin-top: 1px;
  text-align: center;
}

.jieqi-label {
  color: var(--color-success);
  font-weight: 600;
}

.leap-indicator {
  font-size: 9px;
  color: var(--color-danger);
  font-weight: 600;
}

.occ-indicators {
  margin-top: 2px;
}

.occ-bar {
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 4px;
  margin-bottom: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
}

.occ-text {
  color: #fff;
  font-size: 10px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.occ-progress {
  color: rgba(255, 255, 255, 0.8);
  font-size: 9px;
  flex-shrink: 0;
}

.progress-stripe {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2px;
  background: rgba(255, 255, 255, 0.5);
  transition: width 0.3s ease;
}

.occ-overflow {
  font-size: 10px;
  color: var(--color-text-secondary);
}
</style>
