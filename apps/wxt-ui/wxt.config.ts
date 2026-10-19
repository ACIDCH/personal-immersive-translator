import {defineConfig} from 'wxt';
import react from '@vitejs/plugin-react';

// Native PIT web translation, file labs, subtitle adapters and optional
// local ASR run inside this separately tested WXT integration build.
// External PDF layout services and user-key vendor quality need independent QA.
export default defineConfig({
  // Existing PIT JavaScript uses a parameter named storage; disabling
  // WXT auto-imports prevents an erroneous wxt/utils/storage import.
  imports:false,
  manifest:{
    name:'多模态翻译 — 核心集成测试版',
    short_name:'多模态翻译',
    description:'Bilingual web translation, visible captions, local OCR, Office translation and optional local PDF/ASR services.',
    minimum_chrome_version:'125',
    // MV3 permits packaged WASM evaluation, not remote executable code.
    content_security_policy:{
      extension_pages:"script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
    },
    permissions:['activeTab','scripting','storage','tabs','webNavigation','offscreen','tabCapture','contextMenus','identity','alarms'],
    // A translator must work on arbitrary normal sites, not just API
    // provider domains. One install-time permission avoids per-site prompts.
    // Browser internal pages remain restricted.
    host_permissions:['https://*/*','http://*/*']
  },
  hooks:{
    'build:manifestGenerated': (_wxt,manifest)=>{
      manifest.options_page='pit-options.html';
      // Passive content bootstrap is necessary for deliberate hover gestures
      // and site auto-translate without requiring the popup to remain open.
      // It only reads the safe, non-credential preference subset.
      manifest.content_scripts=[{
        matches:['https://*/*','http://*/*'],
        js:['pit-native.js','pit-caption-core.js','pit-platform-captions.js','pit-subtitles.js'],css:['pit-native.css'],run_at:'document_idle'
      }];
      manifest.commands={
        'pit-toggle-translation':{
          suggested_key:{default:'Alt+A'},
          description:'Translate current page or show original'
        },
        'pit-translate-whole-page':{
          suggested_key:{default:'Alt+W'},
          description:'Translate all readable page text'
        }
      };
      // A first-party module service worker is copied without Vite rewriting
      // cache/storage logic. React UI remains built and managed by WXT.
      manifest.background={service_worker:'pit-background.js',type:'module'};
    }
  },
  vite:()=>({plugins:[react()]})
});
