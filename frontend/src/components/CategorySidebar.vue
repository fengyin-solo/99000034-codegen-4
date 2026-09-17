<template>
  <div class="category-sidebar">
    <el-card>
      <template #header>
        <div class="sidebar-header">
          <h3>分类</h3>
          <el-tooltip
            :disabled="canAddCategory"
            :content="`分类数量已达上限（${quotaText}），请先删除不再使用的分类`"
            placement="top"
          >
            <span>
              <el-button text size="small" :disabled="!canAddCategory" @click="showAddCategory">
                <el-icon><Plus /></el-icon>
              </el-button>
            </span>
          </el-tooltip>
        </div>
        <div class="category-quota" :class="{ over: linksStore.categoryQuota.over_limit }">
          已建 {{ linksStore.categoryQuota.count }} / {{ linksStore.categoryQuota.limit }} 个分类
          <span v-if="canAddCategory" class="quota-hint">还可新建 {{ linksStore.categoryQuota.remaining }} 个</span>
          <span v-else-if="linksStore.categoryQuota.over_limit" class="quota-hint warning">
            数量已超过上限，删除多余分类后才能新增
          </span>
          <span v-else class="quota-hint warning">已达上限，请先删除分类腾出位置</span>
        </div>
      </template>

      <div class="category-list">
        <div
          class="category-item"
          :class="{ active: !linksStore.selectedCategory }"
          @click="linksStore.setCategory(null)"
        >
          <span class="category-name">全部链接</span>
          <span class="category-count">{{ linksStore.total }}</span>
        </div>

        <div
          v-for="cat in linksStore.categories"
          :key="cat.id"
          class="category-item"
          :class="{ active: linksStore.selectedCategory === cat.id }"
          @click="linksStore.setCategory(cat.id)"
        >
          <span class="category-color" :style="{ backgroundColor: cat.color }"></span>
          <span class="category-name">{{ cat.name }}</span>
          <span class="category-count">{{ cat.link_count }}</span>
          <el-dropdown trigger="click" @command="(cmd) => handleCategoryCommand(cmd, cat)" @click.stop>
            <el-button text size="small" class="category-more" @click.stop>
              <el-icon><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="edit">编辑</el-dropdown-item>
                <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </el-card>

    <el-dialog v-model="categoryDialogVisible" :title="editingCategory ? '编辑分类' : '添加分类'" width="360px">
      <el-form :model="categoryForm" label-width="60px" @submit.prevent>
        <el-form-item label="名称">
          <el-input
            v-model="categoryForm.name"
            placeholder="分类名称"
            maxlength="50"
            show-word-limit
            @keyup.enter="saveCategory"
          />
        </el-form-item>
        <el-form-item label="颜色">
          <el-color-picker v-model="categoryForm.color" />
        </el-form-item>
      </el-form>
      <div v-if="!editingCategory && !canAddCategory" class="dialog-limit-hint">
        分类数量已达上限（{{ quotaText }}），无法新增。请先在侧栏删除不再使用的分类。
      </div>
      <template #footer>
        <el-button @click="categoryDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="saving"
          :disabled="!editingCategory && !canAddCategory"
          @click="saveCategory"
        >
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useLinksStore } from '../stores/links'

const linksStore = useLinksStore()

const categoryDialogVisible = ref(false)
const editingCategory = ref(null)
const saving = ref(false)
const categoryForm = reactive({
  name: '',
  color: '#409EFF',
})

const canAddCategory = computed(() => linksStore.categoryQuota.remaining > 0)
const quotaText = computed(
  () => `${linksStore.categoryQuota.count}/${linksStore.categoryQuota.limit}`
)

function showAddCategory() {
  if (!canAddCategory.value) {
    ElMessage.warning(
      `分类数量已达上限（${quotaText.value}）。请先删除不再使用的分类，或把链接改挂到已有分类后再新增。`
    )
    return
  }
  editingCategory.value = null
  categoryForm.name = ''
  categoryForm.color = '#409EFF'
  categoryDialogVisible.value = true
}

function handleCategoryCommand(command, category) {
  if (command === 'edit') {
    editingCategory.value = category
    categoryForm.name = category.name
    categoryForm.color = category.color
    categoryDialogVisible.value = true
  } else if (command === 'delete') {
    handleDeleteCategory(category)
  }
}

function getServerError(err, fallback) {
  return err?.response?.data?.error || fallback
}

async function saveCategory() {
  const trimmed = categoryForm.name.trim()
  if (!trimmed) {
    ElMessage.warning('请输入分类名称')
    return
  }

  saving.value = true
  try {
    if (editingCategory.value) {
      const result = await linksStore.updateCategory(editingCategory.value.id, {
        ...categoryForm,
        name: trimmed,
      })
      if (result?.merged) {
        ElMessage.success(`已与同名分类「${result.name}」合并，其下链接都已归入该分类`)
      } else {
        ElMessage.success('更新成功')
      }
    } else {
      const result = await linksStore.createCategory({ ...categoryForm, name: trimmed })
      if (result?.merged) {
        ElMessage.info(`已存在同名分类「${result.name}」，已直接合并，无需重复创建`)
      } else {
        ElMessage.success('创建成功')
      }
    }
    categoryDialogVisible.value = false
  } catch (err) {
    if (err?.response?.status === 409) {
      ElMessage.error(getServerError(err, '分类数量已达上限，请先删除不再使用的分类'))
    } else {
      ElMessage.error(getServerError(err, '操作失败'))
    }
  } finally {
    saving.value = false
  }
}

async function handleDeleteCategory(category) {
  const linkCount = category.link_count ?? 0
  const detail =
    linkCount > 0
      ? `该分类下的 ${linkCount} 个链接不会被删除，将回到「未分类」。`
      : '该分类下暂无链接。'
  try {
    await ElMessageBox.confirm(
      `确定要删除分类 "${category.name}" 吗？${detail}`,
      '确认删除',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
    await linksStore.deleteCategory(category.id)
    ElMessage.success('删除成功，相关链接已回到未分类')
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error(getServerError(err, '删除失败'))
    }
  }
}
</script>

<style scoped>
.category-sidebar {
  margin-bottom: 16px;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sidebar-header h3 {
  margin: 0;
  font-size: 15px;
}

.category-quota {
  margin-top: 8px;
  font-size: 12px;
  color: #606266;
  line-height: 1.6;
}

.category-quota.over {
  color: #e6a23c;
  font-weight: 500;
}

.quota-hint {
  display: block;
  color: #909399;
}

.quota-hint.warning {
  color: #e6a23c;
}

.dialog-limit-hint {
  margin-top: -8px;
  padding: 8px 12px;
  background: #fdf6ec;
  color: #e6a23c;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.category-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
  gap: 8px;
}

.category-item:hover {
  background-color: #f5f7fa;
}

.category-item.active {
  background-color: #ecf5ff;
  color: #409eff;
}

.category-color {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex-shrink: 0;
}

.category-name {
  flex: 1;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-count {
  font-size: 12px;
  color: #909399;
  background: #f0f2f5;
  padding: 2px 8px;
  border-radius: 10px;
}

.category-more {
  opacity: 0;
  transition: opacity 0.2s;
}

.category-item:hover .category-more {
  opacity: 1;
}
</style>
