<template>
  <Transition name="toast-fade">
    <div v-if="msg" class="toast" :class="toastType">
      <span class="toast-icon">{{ toastType === 'success' ? '✓' : toastType === 'error' ? '✗' : 'ℹ' }}</span>
      <span class="toast-msg">{{ msg }}</span>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const msg = ref('')
const toastType = ref<'success' | 'error' | 'info'>('success')
let timer: any = null

function show(message: string, type: 'success' | 'error' | 'info' = 'success', duration = 2000) {
  msg.value = message
  toastType.value = type
  clearTimeout(timer)
  timer = setTimeout(() => { msg.value = '' }, duration)
}

defineExpose({ show })
</script>

<style scoped>
.toast {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--radius);
  font-size: 14px;
  z-index: 2000;
  pointer-events: none;
}

.toast.success {
  background: rgba(52, 199, 89, 0.12);
  color: var(--color-success);
}

.toast.error {
  background: rgba(239, 68, 68, 0.12);
  color: var(--color-danger);
}

.toast.info {
  background: rgba(91, 127, 255, 0.12);
  color: var(--color-primary);
}

.toast-icon {
  font-weight: 700;
  font-size: 16px;
}

.toast-msg {
  font-weight: 500;
}

.toast-fade-enter-active {
  transition: all 0.3s ease-out;
}

.toast-fade-leave-active {
  transition: all 0.2s ease-in;
}

.toast-fade-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}

.toast-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}
</style>
