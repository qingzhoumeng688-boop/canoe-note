<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{
  /** B 站视频 BV 号，例如 BV1Z841187pJ */
  bvid: string
  /** 显示在占位卡片上的标题 */
  title?: string
}>()

const active = ref(false)
/** 每个实例一个唯一 id，用于全局互斥：同一时刻只允许一个视频存在 */
const uid = 'bv-' + Math.random().toString(36).slice(2, 10)
let root: HTMLElement | null = null

/**
 * 全局互斥：页面上的所有 BiliVideo 约定同一时刻只有一个处于播放状态。
 * 新视频被点击时，先让其他视频卸载，避免多个播放器同时发声。
 */
function onOtherActivated(e: Event) {
  const cur = (e as CustomEvent).detail
  if (cur !== uid && active.value) active.value = false
}

onMounted(() => {
  window.addEventListener('bili:activate', onOtherActivated)
})

onBeforeUnmount(() => {
  window.removeEventListener('bili:activate', onOtherActivated)
})

function play() {
  window.dispatchEvent(new CustomEvent('bili:activate', { detail: uid }))
  active.value = true
}
</script>

<template>
  <div class="bili-video" ref="root">
    <!-- 未点击时只渲染一个占位卡片，不加载任何播放器 -->
    <button v-if="!active" class="bili-cover" type="button" @click="play">
      <span class="bili-play" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M8 5v14l11-7z" /></svg>
      </span>
      <span class="bili-meta">
        <span class="bili-title">{{ title || '教学视频' }}</span>
        <span class="bili-hint">点击播放（哔哩哔哩）</span>
      </span>
    </button>

    <!-- 点击后才插入 iframe -->
    <iframe
      v-else
      class="bili-frame"
      :src="`https://player.bilibili.com/player.html?bvid=${bvid}&page=1&high_quality=1&danmaku=0&autoplay=1`"
      scrolling="no"
      frameborder="0"
      allowfullscreen="true"
      title="bilibili player"
    ></iframe>
  </div>
</template>

<style scoped>
.bili-video {
  margin: 16px 0;
}

.bili-cover {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  max-width: 720px;
  padding: 18px 20px;
  border: 1px solid var(--vp-c-border, #dcdfe6);
  border-radius: 10px;
  background: linear-gradient(135deg, #f6f8fb 0%, #eef2f7 100%);
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-align: left;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.bili-cover:hover {
  border-color: var(--vp-c-brand-1, #fb7299);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}

.bili-play {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: var(--vp-c-brand-1, #fb7299);
  color: #fff;
}

.bili-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.bili-title {
  font-weight: 600;
  font-size: 15px;
  line-height: 1.4;
}

.bili-hint {
  font-size: 12px;
  opacity: 0.65;
}

.bili-frame {
  width: 100%;
  max-width: 720px;
  height: 420px;
  border: 0;
  border-radius: 8px;
  display: block;
}

@media (max-width: 640px) {
  .bili-frame {
    height: 240px;
  }
}
</style>
