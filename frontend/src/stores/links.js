import { defineStore } from 'pinia'
import { ref } from 'vue'
import { linksApi, categoriesApi, tagsApi } from '../api'

export const useLinksStore = defineStore('links', () => {
  const links = ref([])
  const categories = ref([])
  const tags = ref([])
  const total = ref(0)
  const currentPage = ref(1)
  const totalPages = ref(1)
  const loading = ref(false)

  // 分类容量口径：count 已有数量，limit 上限，remaining 剩余名额，over_limit 是否为超限老账号
  const categoryQuota = ref({ count: 0, limit: 0, remaining: 0, over_limit: false })

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
      categories.value = response.data
    } catch (error) {
      console.error('Failed to fetch categories:', error)
    }
  }

  async function fetchCategoryQuota() {
    try {
      const response = await categoriesApi.getQuota()
      categoryQuota.value = response.data
    } catch (error) {
      console.error('Failed to fetch category quota:', error)
    }
  }

  function setCategoryQuotaFromError(error) {
    const data = error?.response?.data
    if (data && typeof data.count === 'number' && typeof data.limit === 'number') {
      categoryQuota.value = {
        count: data.count,
        limit: data.limit,
        remaining: Math.max(0, data.limit - data.count),
        over_limit: data.count > data.limit,
      }
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
      await fetchCategoryQuota()
      return response.data
    } catch (error) {
      setCategoryQuotaFromError(error)
      throw error
    }
  }

  async function updateCategory(id, data) {
    try {
      const response = await categoriesApi.updateCategory(id, data)
      await fetchCategories()
      await fetchCategoryQuota()
      // 若发生合并，当前选中的分类可能已不存在
      if (response.data?.merged && response.data.id !== id && selectedCategory.value === id) {
        selectedCategory.value = response.data.id
      }
      return response.data
    } catch (error) {
      setCategoryQuotaFromError(error)
      throw error
    }
  }

  async function deleteCategory(id) {
    await categoriesApi.deleteCategory(id)
    if (selectedCategory.value === id) {
      selectedCategory.value = null
    }
    await fetchCategories()
    await fetchCategoryQuota()
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
    categoryQuota,
    selectedCategory,
    selectedTag,
    searchQuery,
    fetchLinks,
    fetchCategories,
    fetchCategoryQuota,
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
