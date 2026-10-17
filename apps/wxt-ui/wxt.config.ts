import {defineConfig} from 'wxt';
import react from '@vitejs/plugin-react';

// UI architecture prototype only. It does not replace the functional
// native extension or ship to users until the entrypoints are migrated.
export default defineConfig({
  manifest:{
    name:'多模态翻译 — 前端预览',
    short_name:'多模态翻译',
    description:'UI preview only; translation engine not connected',
    permissions:['storage']
  },
  vite:()=>({plugins:[react()]})
});
