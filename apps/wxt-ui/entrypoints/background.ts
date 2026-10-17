// Register original PIT translation routing in the WXT service worker.
// Delayed module import occurs only inside the runtime callback; the WXT
// build-time entrypoint loader must not execute Chrome API listeners.
export default defineBackground(async()=>{
  await import('../../../src/background.js');
});
