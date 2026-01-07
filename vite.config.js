import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Thêm dòng này để sửa lỗi "global is not defined" của thư viện SockJS
    global: 'window',
  },
})