import {defineBackground} from 'wxt/sandbox';

// Original PIT module remains the authority for provider routing and cache.
// WXT's entrypoint loader does not execute this runtime import during build.
export default defineBackground({
  type:'module',
  main(){
    void import('../../../src/background.js');
  }
});
