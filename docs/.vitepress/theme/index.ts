import DefaultTheme from 'vitepress/theme'
import BiliVideo from './BiliVideo.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    // 全局注册，markdown 里可直接写 <BiliVideo bvid="..." title="..." />
    app.component('BiliVideo', BiliVideo)
  }
}
