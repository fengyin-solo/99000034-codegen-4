<template>
  <div class="category-sidebar">
    <el-card>
      <template #header>
        <div class="sidebar-header">
          <h3>
            分类
            <span class="category-usage" :class="{ full: linksStore.categoryLimitReached }">
              {{ linksStore.categoryCount }}/{{ linksStore.categoryLimit }}
            </span>
          </h3>
          <el-tooltip
            :content="limitTooltip"
            :disabled="!linksStore.categoryLimitReached"
            placement="top"
          >
            <span>
              <el-button
                text
                size="small"
                :disabled="linksStore.categoryLimitReached"
                @click="showAddCategory"
              >
                <el-icon><Plus /></el-icon>
              </el-button>
            </span>
          </el-tooltip>
        </div>
        <div v-if="linksStore.categoryLimitReached" class="limit-hint">
          分类数量已达上限（{{ linksStore.categoryCount }}/{{ linksStore.categoryLimit }}）。删除或合并一个不用的分类后才能新增；分类下的链接会自动回到“未分类”，不会丢失。
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
      <template #footer>
        <el-button @click="categoryDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveCategory">保存</el-button>
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

const limitTooltip = computed(() =>
  linksStore.categoryLimitReached
    ? `已达上限 ${linksStore.categoryCount}/${linksStore.categoryLimit}，请先删除或合并一个分类`
    : ''
)

function showAddCategory() {
  if (linksStore.categoryLimitReached) {
    ElMessage.warning(
      `分类数量已达上限（${linksStore.categoryCount}/${linksStore.categoryLimit}）。请先删除或合并一个不用的分类腾位置，其下链接会回到“未分类”，不会丢失。`
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

async function saveCategory() {
  const name = categoryForm.name.replace(/\s+/g, ' ').trim()
  if (!name) {
    ElMessage.warning('请输入分类名称')
    return
  }

  saving.value = true
  try {
    if (editingCategory.value) {
      const result = await linksStore.updateCategory(editingCategory.value.id, {
        name,
        color: categoryForm.color,
      })
      if (result.merged) {
        ElMessage.success(`与已有分类重名，已合并到“${result.name}”，链接也一并归过去了`)
      } else {
        ElMessage.success('更新成功')
      }
    } else {
      const result = await linksStore.createCategory({ name, color: categoryForm.color })
      if (result.merged) {
        ElMessage.success(`已存在同名分类“${result.name}”，已直接合并，无需重复创建`)
      } else {
        ElMessage.success(
          `创建成功（${linksStore.categoryCount}/${linksStore.categoryLimit}）`
        )
      }
    }
    categoryDialogVisible.value = false
  } catch (err) {
    const data = err.response?.data
    if (data?.code === 'CATEGORY_LIMIT_REACHED') {
      ElMessage.error(
        `分类数量已达上限（${data.count}/${data.limit}）。请先删除或合并一个不用的分类腾位置，其下链接会回到“未分类”。`
      )
    } else if (data?.code === 'CATEGORY_NAME_REQUIRED') {
      ElMessage.error('请输入分类名称')
    } else if (data?.code === 'CATEGORY_NAME_TOO_LONG') {
      ElMessage.error(`分类名称不能超过 ${data.max_length} 个字符`)
    } else {
      ElMessage.error(data?.error || '操作失败')
    }
  } finally {
    saving.value = false
  }
}

async function handleDeleteCategory(category) {
  const linkCount = category.link_count ?? 0
  const tip = linkCount > 0
    ? `确定要删除分类 “${category.name}” 吗？该分类下的 ${linkCount} 个链接不会被删除，会回到“未分类”。`
    : `确定要删除分类 “${category.name}” 吗？`
  try {
    await ElMessageBox.confirm(tip, '确认删除', {
      type: 'warning',
    })
    await linksStore.deleteCategory(category.id)
    ElMessage.success('删除成功，其下链接已回到“未分类”')
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error(err.response?.data?.error || '删除失败')
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
  display: flex;
  align-items: center;
  gap: 8px;
}

.category-usage {
  font-size: 12px;
  font-weight: normal;
  color: #909399;
  background: #f0f2f5;
  padding: 1px 8px;
  border-radius: 10px;
}

.category-usage.full {
  color: #f56c6c;
  background: #fef0f0;
}

.limit-hint {
  margin-top: 8px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: #e6a23c;
  background: #fdf6ec;
  border-radius: 4px;
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
