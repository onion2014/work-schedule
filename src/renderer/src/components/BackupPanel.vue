<template>
  <!-- Backup panel overlay -->
  <div v-if="open" class="backup-overlay" @click.self="$emit('close')">
    <div class="backup-card">
      <h3>数据备份与恢复</h3>

      <!-- Status section -->
      <div v-if="status" class="status-section">
        <div class="status-row">
          <span class="status-label">最近备份</span>
          <span class="status-value">{{ status.lastBackupTime ? formatDate(status.lastBackupTime) : '从未备份' }}</span>
        </div>
        <div class="status-row">
          <span class="status-label">备份数量</span>
          <span class="status-value">{{ status.backupCount }} 份</span>
        </div>
        <div class="status-row">
          <span class="status-label">备份总大小</span>
          <span class="status-value">{{ formatSize(status.backupDirSize) }}</span>
        </div>
        <div v-if="status.lastBackupError" class="status-error">
          ⚠ 上次备份失败: {{ status.lastBackupError }}
        </div>
      </div>

      <div class="backup-actions">
        <button class="action-btn primary" :disabled="loading" @click="triggerBackup">
          {{ loading ? '备份中...' : '立即备份' }}
        </button>
      </div>

      <!-- Backup list -->
      <div v-if="backups.length > 0" class="backup-list">
        <h4>备份列表</h4>
        <div class="backup-table">
          <div v-for="b in backups" :key="b.filename" class="backup-row">
            <span class="bk-date">{{ b.date }}</span>
            <span class="bk-tier" :class="b.tier">{{ tierLabel(b.tier) }}</span>
            <span class="bk-size">{{ formatSize(b.size) }}</span>
            <button class="restore-btn" :disabled="restoring || restoreConfirm === b.filename" @click="confirmRestore(b)">
              恢复
            </button>
          </div>
        </div>
      </div>
      <div v-else class="no-backups">暂无备份</div>

      <!-- Restore confirmation -->
      <div v-if="restoreConfirm" class="confirm-overlay" @click.self="restoreConfirm = null">
        <div class="confirm-card">
          <h4>确认恢复</h4>
          <p class="confirm-warning">恢复将替换当前所有数据。恢复前会自动创建安全备份。</p>
          <p>确定要恢复到 <strong>{{ restoreConfirm }}</strong> 的数据吗？</p>
          <div class="confirm-actions">
            <button class="action-btn danger" :disabled="restoring" @click="doRestore">
              {{ restoring ? '恢复中...' : '确认恢复' }}
            </button>
            <button class="action-btn" @click="restoreConfirm = null">取消</button>
          </div>
        </div>
      </div>

      <div class="section-divider"></div>

      <!-- JSON Export/Import -->
      <h4>数据迁移</h4>
      <div class="migration-actions">
        <button class="action-btn outline" @click="doExportJson">导出 JSON</button>
        <button class="action-btn outline" @click="showImportDialog = true">导入 JSON</button>
      </div>

      <!-- Import dialog -->
      <div v-if="showImportDialog" class="confirm-overlay" @click.self="showImportDialog = false">
        <div class="confirm-card">
          <h4>导入 JSON 数据</h4>
          <div class="import-mode-select">
            <label>冲突处理方式：</label>
            <div class="mode-options">
              <button class="mode-btn" :class="{ active: importMode === 'merge-overwrite' }" @click="importMode = 'merge-overwrite'">
                合并覆盖（推荐）
              </button>
              <button class="mode-btn" :class="{ active: importMode === 'merge' }" @click="importMode = 'merge'">
                仅合并
              </button>
              <button class="mode-btn" :class="{ active: importMode === 'replace' }" @click="importMode = 'replace'">
                全部替换
              </button>
            </div>
            <div class="mode-desc">
              <span v-if="importMode === 'merge-overwrite'">保留现有数据，ID冲突时覆盖旧数据</span>
              <span v-if="importMode === 'merge'">保留现有数据，ID冲突时跳过</span>
              <span v-if="importMode === 'replace'">删除所有现有数据后导入（危险）</span>
            </div>
          </div>
          <div class="confirm-actions">
            <button class="action-btn primary" :disabled="importing" @click="doImportJson">
              {{ importing ? '导入中...' : '选择文件并导入' }}
            </button>
            <button class="action-btn" @click="showImportDialog = false">取消</button>
          </div>
          <div v-if="importResult" class="import-result">
            <div v-if="importResult.success" class="result-success">
              ✓ 导入成功: {{ importResult.importedCount }} 条事件, {{ importResult.skippedCount }} 条跳过
            </div>
            <div v-if="!importResult.success" class="result-error">
              ✗ 导入失败: {{ importResult.errors.join('; ') }}
            </div>
          </div>
        </div>
      </div>

      <!-- Export result -->
      <div v-if="exportResult" class="export-result">
        <div v-if="exportResult.success" class="result-success">
          ✓ 已导出到: {{ exportResult.filePath }}
        </div>
        <div v-if="!exportResult.success && exportResult.reason !== 'canceled'" class="result-error">
          ✗ 导出失败
        </div>
      </div>

      <div class="panel-footer">
        <button class="action-btn" @click="$emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import type { BackupInfo, BackupStatus, ImportMode } from '../../../lib/types'

const props = defineProps<{ open: boolean; toast?: any }>()
const emit = defineEmits<{ close: []; restored: []; imported: [] }>()

const api = (window as any).timerApi

const status = ref<BackupStatus | null>(null)
const backups = ref<BackupInfo[]>([])
const loading = ref(false)
const restoring = ref(false)
const importing = ref(false)
const restoreConfirm = ref<string | null>(null)
const showImportDialog = ref(false)
const importMode = ref<ImportMode>('merge-overwrite')
const importResult = ref<any>(null)
const exportResult = ref<any>(null)

async function loadBackupData() {
  try {
    status.value = await api.getBackupStatus()
    backups.value = await api.listBackups()
  } catch (e) {
    console.error('Failed to load backup data:', e)
  }
}

async function triggerBackup() {
  loading.value = true
  try {
    const result = await api.triggerBackup()
    if (result.success) {
      await loadBackupData()
      props.toast?.show('备份成功')
    } else {
      props.toast?.show('备份失败: ' + (result.error || ''), 'error')
    }
  } catch (e) {
    console.error('Backup failed:', e)
    props.toast?.show('备份失败', 'error')
  }
  loading.value = false
}

function confirmRestore(b: BackupInfo) {
  restoreConfirm.value = b.date
}

async function doRestore() {
  if (!restoreConfirm.value) return
  const filename = backups.value.find(b => b.date === restoreConfirm.value)?.filename
  if (!filename) return

  restoring.value = true
  try {
    const result = await api.restoreBackup(filename)
    if (result.success) {
      restoreConfirm.value = null
      await loadBackupData()
      props.toast?.show('数据已恢复')
      emit('restored')
    } else {
      console.error('Restore failed:', result.error)
      props.toast?.show('恢复失败: ' + (result.error || ''), 'error')
    }
  } catch (e) {
    console.error('Restore error:', e)
    props.toast?.show('恢复失败', 'error')
  }
  restoring.value = false
}

async function doExportJson() {
  exportResult.value = null
  try {
    const result = await api.exportJson()
    exportResult.value = result
    if (result.success) {
      props.toast?.show('JSON 已导出')
    } else if (result.reason !== 'canceled') {
      props.toast?.show('导出失败', 'error')
    }
  } catch (e) {
    console.error('Export failed:', e)
    props.toast?.show('导出失败', 'error')
  }
  // Auto-clear result after 5 seconds
  setTimeout(() => { exportResult.value = null }, 5000)
}

async function doImportJson() {
  importResult.value = null
  try {
    // Step 1: pick file
    const pickResult = await api.pickImportFile()
    if (!pickResult.success) return

    // Step 2: import
    importing.value = true
    const result = await api.importJson(pickResult.filePath, importMode.value)
    importResult.value = result
    importing.value = false

    if (result.success) {
      props.toast?.show(`导入成功: ${result.importedCount} 条事件`)
      emit('imported')
    } else {
      props.toast?.show('导入失败', 'error')
    }
  } catch (e) {
    importResult.value = { success: false, errors: [(e as Error).message] }
    importing.value = false
    props.toast?.show('导入失败', 'error')
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function tierLabel(tier: string): string {
  if (tier === 'daily') return '日'
  if (tier === 'weekly') return '周'
  if (tier === 'monthly') return '月'
  return tier
}

// Load data when panel opens
watch(() => props.open, (val) => {
  if (val) {
    loadBackupData()
    importResult.value = null
    exportResult.value = null
    showImportDialog.value = false
    restoreConfirm.value = null
  }
})
</script>

<style scoped>
.backup-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.backup-card {
  background: #fff;
  border-radius: var(--radius);
  border: 1px solid var(--color-border);
  padding: 20px;
  width: 520px;
  max-height: 85vh;
  overflow-y: auto;
}

.backup-card h3 {
  margin-bottom: 16px;
  font-size: 16px;
  font-weight: 500;
}

.backup-card h4 {
  margin: 12px 0 8px;
  font-size: 14px;
  color: var(--color-text-secondary);
  font-weight: 500;
}

/* Status section */
.status-section {
  background: var(--color-bg);
  border-radius: var(--radius);
  padding: 12px;
  margin-bottom: 12px;
}

.status-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 13px;
}

.status-label {
  color: var(--color-text-secondary);
}

.status-value {
  font-weight: 500;
}

.status-error {
  color: var(--color-danger);
  font-size: 13px;
  margin-top: 4px;
}

/* Action buttons */
.backup-actions {
  margin-bottom: 12px;
}

.action-btn {
  padding: 8px 16px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  font-size: 14px;
  transition: background var(--transition);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.action-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.04);
}

.action-btn.primary {
  background: var(--color-primary);
  color: #fff;
}

.action-btn.primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.action-btn.danger {
  background: transparent;
  color: var(--color-danger);
}

.action-btn.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.08);
}

.action-btn.outline {
  color: var(--color-primary);
}

.action-btn.outline:hover:not(:disabled) {
  background: rgba(91, 127, 255, 0.08);
}

/* Backup list */
.backup-list {
  margin-bottom: 12px;
}

.backup-table {
  max-height: 200px;
  overflow-y: auto;
}

.backup-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  margin-bottom: 4px;
  border-radius: var(--radius);
  font-size: 13px;
}

.bk-date {
  min-width: 100px;
  font-weight: 500;
}

.bk-tier {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius);
  font-weight: 500;
}

.bk-tier.daily {
  background: rgba(52, 199, 89, 0.1);
  color: var(--color-success);
}

.bk-tier.weekly {
  background: rgba(91, 127, 255, 0.1);
  color: var(--color-primary);
}

.bk-tier.monthly {
  background: rgba(254, 243, 199, 0.5);
  color: #92400E;
}

.bk-size {
  color: var(--color-text-secondary);
  min-width: 60px;
}

.restore-btn {
  padding: 4px 10px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--color-danger);
  cursor: pointer;
  font-size: 12px;
  margin-left: auto;
  transition: background var(--transition);
}

.restore-btn:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.08);
}

.no-backups {
  color: var(--color-text-secondary);
  font-size: 13px;
  padding: 8px;
  text-align: center;
}

/* Section divider */
.section-divider {
  border-top: 1px solid var(--color-border);
  margin: 16px 0;
}

/* Migration section */
.migration-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

/* Confirmation overlay */
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}

.confirm-card {
  background: #fff;
  border-radius: var(--radius);
  border: 1px solid var(--color-border);
  padding: 20px;
  width: 400px;
}

.confirm-card h4 {
  margin-bottom: 12px;
  font-weight: 500;
}

.confirm-warning {
  color: var(--color-danger);
  font-size: 13px;
  margin-bottom: 8px;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

/* Import mode select */
.import-mode-select {
  margin-bottom: 12px;
}

.import-mode-select label {
  font-size: 13px;
  color: var(--color-text-secondary);
  display: block;
  margin-bottom: 6px;
}

.mode-options {
  display: flex;
  gap: 6px;
}

.mode-btn {
  padding: 6px 12px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: background var(--transition);
}

.mode-btn:hover {
  background: rgba(0, 0, 0, 0.04);
}

.mode-btn.active {
  background: var(--color-primary);
  color: #fff;
}

.mode-desc {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-top: 4px;
}

/* Result messages */
.result-success {
  color: var(--color-success);
  font-size: 13px;
  margin-top: 8px;
}

.result-error {
  color: var(--color-danger);
  font-size: 13px;
  margin-top: 8px;
}

.export-result {
  margin-top: 8px;
}

/* Panel footer */
.panel-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
