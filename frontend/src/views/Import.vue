<template>
  <div class="import-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <el-button @click="$router.push('/')" text>
            <el-icon><ArrowLeft /></el-icon>
            返回
          </el-button>
          <h2>导入浏览器书签</h2>
        </div>
      </template>

      <div class="import-instructions">
        <h3>如何导出 Chrome 书签：</h3>
        <ol>
          <li>打开 Chrome 浏览器，点击右上角菜单 (三个点)</li>
          <li>选择 "书签和清单" > "书签管理器"</li>
          <li>在书签管理器中，点击右上角菜单 (三个点)</li>
          <li>选择 "导出书签"</li>
          <li>保存 HTML 文件后，上传到此处</li>
        </ol>
      </div>

      <el-upload
        class="upload-area"
        drag
        :auto-upload="false"
        :limit="1"
        accept=".html,.htm"
        :on-change="handleFileChange"
        :on-exceed="handleExceed"
      >
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">
          拖拽文件到此处，或 <em>点击上传</em>
        </div>
        <template #tip>
          <div class="el-upload__tip">仅支持 Chrome 书签导出的 HTML 文件</div>
        </template>
      </el-upload>

      <div class="upload-actions" v-if="selectedFile">
        <p class="file-name">已选择: {{ selectedFile.name }}</p>
        <el-button type="primary" :loading="importing" @click="handleImport" size="large">
          开始导入
        </el-button>
      </div>

      <el-result
        v-if="importResult"
        :icon="importResult.imported > 0 ? 'success' : 'warning'"
        :title="importResult.message"
        :sub-title="`共解析 ${importResult.total} 条书签，导入 ${importResult.imported} 条，跳过 ${importResult.skipped} 条重复项`"
      >
        <template #extra>
          <el-alert
            v-if="importResult.uncategorized_by_limit > 0"
            type="warning"
            :closable="false"
            show-icon
            class="limit-alert"
            :title="`有 ${importResult.uncategorized_by_limit} 条书签因分类数量已达上限未能归入新文件夹，已放入未分类。删除一些分类后可重新整理。`"
          />
          <div class="result-actions">
            <el-button type="primary" @click="$router.push('/')">查看链接</el-button>
            <el-button @click="resetImport">继续导入</el-button>
          </div>
        </template>
      </el-result>
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { importApi } from '../api'

const selectedFile = ref(null)
const importing = ref(false)
const importResult = ref(null)

function handleFileChange(file) {
  selectedFile.value = file.raw
}

function handleExceed() {
  ElMessage.warning('只能上传一个文件，请先移除已选文件')
}

async function handleImport() {
  if (!selectedFile.value) return

  importing.value = true
  try {
    const response = await importApi.importBookmarks(selectedFile.value)
    importResult.value = response.data
    ElMessage.success('导入成功')
  } catch (err) {
    ElMessage.error(err.response?.data?.error || '导入失败')
  } finally {
    importing.value = false
  }
}

function resetImport() {
  selectedFile.value = null
  importResult.value = null
}
</script>

<style scoped>
.import-container {
  max-width: 700px;
  margin: 40px auto;
  padding: 0 20px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.card-header h2 {
  margin: 0;
}

.import-instructions {
  background: #f5f7fa;
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 24px;
}

.import-instructions h3 {
  margin: 0 0 12px 0;
  font-size: 15px;
  color: #303133;
}

.import-instructions ol {
  margin: 0;
  padding-left: 20px;
  color: #606266;
  font-size: 14px;
  line-height: 1.8;
}

.upload-area {
  margin-bottom: 20px;
}

.upload-actions {
  text-align: center;
  padding: 16px 0;
}

.file-name {
  margin-bottom: 12px;
  color: #606266;
}

.limit-alert {
  max-width: 480px;
  margin: 0 auto 12px;
  text-align: left;
}

.result-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}
</style>
