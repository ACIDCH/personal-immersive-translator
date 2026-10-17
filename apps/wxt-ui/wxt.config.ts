import {defineConfig} from 'wxt';
import react from '@vitejs/plugin-react';

// Native PIT web translation runs inside this separate integration build.
// Media/ASR/OCR remain on the original experimental track and are not claimed.
export default defineConfig({
  manifest:{
    name:'多模态翻译 — 网页集成测试',
    short_name:'多模态翻译',
    description:'PIT native webpage translation through the WXT React control panel. Video/PDF not enabled in this build.',
    minimum_chrome_version:'125',
    permissions:['activeTab','scripting','storage'],
    host_permissions:[
      'https://api.cognitive.microsofttranslator.com/*',
      'https://translation.googleapis.com/*',
      'https://api-free.deepl.com/*',
      'https://api.deepl.com/*',
      'https://generativelanguage.googleapis.com/*',
      'https://api.deepseek.com/*'
    ],
    optional_host_permissions:['https://*/*'],
    options_page:'pit-options.html'
  },
  vite:()=>({plugins:[react()]})
});
