import { createApp } from 'vue'
import App from './App.vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'

const app = createApp(App)

app.use(ElementPlus)

// 添加 ResizeObserver 警告过滤
const originalConsoleError = console.error;
console.error = function(msg, ...args) {
    // 过滤掉 ResizeObserver 相关的警告
    if (msg && msg.toString().includes('ResizeObserver')) {
        return;
    }
    originalConsoleError.call(console, msg, ...args);
};

app.mount('#app')
