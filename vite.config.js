import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ command, mode }) => {
    const env = loadEnv(mode, process.cwd(), '')

    return {
        base: process.env.VITE_BASE_PATH || '/',
        resolve: {
            alias: {
                'vue': 'vue/dist/vue.esm-bundler.js'
            }
        },
        define: {
            __VUE_OPTIONS_API__: true,
            __VUE_PROD_DEVTOOLS__: false,
            __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false
        }
    }
})
