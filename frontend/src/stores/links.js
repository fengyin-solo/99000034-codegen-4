import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { linksApi, categoriesApi, tagsApi } from '../api'

export const useLinksStore = defineStore('links', () => {
  const links = ref([])
  const categories = ref([])
  const tags = ref([])
  const total = ref(0)
  const currentPage = ref(1)
  const totalPages = ref(1)
  const loading = ref(false)

  // 分类容量口径：count/limit 始终以后端返回为准
  const categoryCount = ref(0)
  const categoryLimit = ref(20)
  const categoryLimitReached = computed(() => categoryCount.value >= categoryLimit.value)

  // Filters
  const selectedCategory = ref(null)
  const selectedTag = ref(null)
  const searchQuery = ref('')

  async function fetchLinks(page = 1) {
    loading.value = true
    try {
      const params = {
        page,
        limit: 12,
      }
      if (selectedCategory.value) params.category = selectedCategory.value
      if (selectedTag.value) params.tag = selectedTag.value
      if (searchQuery.value) params.search = searchQuery.value

      const response = await linksApi.getLinks(params)
      links.value = response.data.links
      total.value = response.data.total
      currentPage.value = response.data.page
      totalPages.value = response.data.totalPages
    } catch (error) {
      console.error('Failed to fetch links:', error)
      throw error
    } finally {
      loading.value = false
    }
  }

  async function fetchCategories() {
    try {
      const response = await categoriesApi.getCategories()
      categories.value = response.data.categories
      categoryCount.value = response.data.count
      categoryLimit.value = response.data.limit
    } catch (error) {
      console.error('Failed to fetch categories:', error)
    }
  }

  async function fetchTags() {
    try {
      const response = await tagsApi.getTags()
      tags.value = response.data
    } catch (error) {
      console.error('Failed to fetch tags:', error)
    }
  }

  async function createLink(data) {
    const response = await linksApi.createLink(data)
    await fetchLinks(currentPage.value)
    await fetchCategories()
    await fetchTags()
    return response.data
  }

  async function updateLink(id, data) {
    const response = await linksApi.updateLink(id, data)
    await fetchLinks(currentPage.value)
    await fetchCategories()
    await fetchTags()
    return response.data
  }

  async function deleteLink(id) {
    await linksApi.deleteLink(id)
    await fetchLinks(currentPage.value)
    await fetchCategories()
    await fetchTags()
  }

  async function createCategory(data) {
    try {
      const response = await categoriesApi.createCategory(data)
      await fetchCategories()
      return response.data
    } catch (error) {
      // 上限等服务端裁决结果同样同步到本地计数，保证绕过页面被拦下后口径一致
      if (error.response?.data?.count !== undefined) {
        categoryCount.value = error.response.data.count
        categoryLimit.value = error.response.data.limit ?? categoryLimit.value
      }
      throw error
    }
  }

  async function updateCategory(id, data) {
    const response = await categoriesApi.updateCategory(id, data)
    // 改名撞到已有分类时，服务端会把当前分类并入目标分类并删除自身
    if (response.data.merged && selectedCategory.value === response.data.removed_category_id) {
      selectedCategory.value = null
    }
    await fetchCategories()
    await fetchLinks(currentPage.value)
    return response.data
  }

  async function deleteCategory(id) {
    const response = await categoriesApi.deleteCategory(id)
    // 删除后该分类下的链接回到未分类，停留在该分类筛选下会变成空列表
    if (selectedCategory.value === id) {
      selectedCategory.value = null
    }
    categoryCount.value = response.data.count
    categoryLimit.value = response.data.limit
    await fetchCategories()
    await fetchLinks(currentPage.value)
  }

  function setCategory(categoryId) {
    selectedCategory.value = categoryId
    selectedTag.value = null
    fetchLinks(1)
  }

  function setTag(tag) {
    selectedTag.value = tag
    selectedCategory.value = null
    fetchLinks(1)
  }

  function setSearch(query) {
    searchQuery.value = query
    fetchLinks(1)
  }

  function clearFilters() {
    selectedCategory.value = null
    selectedTag.value = null
    searchQuery.value = ''
    fetchLinks(1)
  }

  return {
    links,
    categories,
    tags,
    total,
    currentPage,
    totalPages,
    loading,
    selectedCategory,
    selectedTag,
    searchQuery,
    categoryCount,
    categoryLimit,
    categoryLimitReached,
    fetchLinks,
    fetchCategories,
    fetchTags,
    createLink,
    updateLink,
    deleteLink,
    createCategory,
    updateCategory,
    deleteCategory,
    setCategory,
    setTag,
    setSearch,
    clearFilters,
  }
})
