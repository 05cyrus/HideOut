import { mount } from 'svelte';
import App from './app/App.svelte';
import { detectCapabilities } from './platform/capabilities';

// Probe platform capabilities once at boot; downstream systems (discovery tier,
// renderer quality, QR viability) read from this snapshot.
const capabilities = detectCapabilities();
if (import.meta.env.DEV) {
  console.info('[HideOut] capabilities', capabilities);
}

const target = document.getElementById('app');
if (!target) {
  throw new Error('Root element #app not found');
}

const app = mount(App, {
  target,
  props: { capabilities },
});

export default app;
