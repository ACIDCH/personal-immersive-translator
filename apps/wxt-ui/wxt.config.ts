import {defineConfig} from 'wxt';
import react from '@vitejs/plugin-react';

// Native PIT web translation runs inside this separate integration build.
// Media/ASR/OCR remain on the original experimental track and are not claimed.
export default defineConfig({
  // Existing PIT JavaScript uses a parameter named storage; disabling
  // WXT auto-imports prevents an erroneous wxt/utils/storage import.
  imports:false,
  manifest:{
    name:'多模态翻译 — 网页集成测试',
    short_name:'多模态翻译',
    description:'PIT native webpage translation through the WXT React control panel. Video/PDF not enabled in this build.',
    minimum_chrome_version:'125',
    // MV3 permits packaged WASM evaluation, not remote executable code.
    content_security_policy:{
      extension_pages:"script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
    },
    permissions:['activeTab','scripting','storage','tabs','webNavigation'],
    // A translator must work on arbitrary normal sites, not just API
    // provider domains. One install-time permission avoids per-site prompts.
    // Browser internal pages remain restricted.
    host_permissions:['https://*/*','http://*/*']
  },
  hooks:{
    'build:manifestGenerated': (_wxt,manifest)=>{
      manifest.options_page='pit-options.html';
      // A first-party module service worker is copied without Vite rewriting
      // cache/storage logic. React UI remains built and managed by WXT.
      manifest.background={service_worker:'pit-background.js',type:'module'};
    }
  },
  vite:()=>({plugins:[react()]})
});
