<script lang="ts">
  import { onMount } from 'svelte';
  import type { Capabilities } from '../platform/capabilities';
  import { app } from './state.svelte';
  import { facade } from './GameFacade';
  import MainMenu from './screens/MainMenu.svelte';
  import HostScreen from './screens/HostScreen.svelte';
  import JoinScreen from './screens/JoinScreen.svelte';
  import LobbyScreen from './screens/LobbyScreen.svelte';
  import GameScreen from './screens/GameScreen.svelte';

  const { capabilities }: { capabilities: Capabilities } = $props();

  onMount(() => {
    app.capabilities = capabilities;
    void facade.init();
    // Unlock audio on the first gesture anywhere (autoplay policy).
    const unlock = () => facade.audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  });
</script>

{#if app.screen === 'menu'}
  <MainMenu />
{:else if app.screen === 'host'}
  <HostScreen />
{:else if app.screen === 'join'}
  <JoinScreen />
{:else if app.screen === 'lobby'}
  <LobbyScreen />
{:else if app.screen === 'game'}
  <GameScreen />
{/if}

{#if app.errorMessage}
  <div class="toast" role="alert">
    {app.errorMessage}
    <button onclick={() => (app.errorMessage = '')}>✕</button>
  </div>
{/if}

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
    background: #0e1116;
    color: #e6edf3;
    font-family:
      system-ui,
      -apple-system,
      'Segoe UI',
      Roboto,
      sans-serif;
    overscroll-behavior: none;
  }
  :global(#app) {
    min-height: 100vh;
  }
  :global(button) {
    cursor: pointer;
    font: inherit;
  }
  :global(button.primary) {
    background: #238636;
    color: #fff;
    border: 1px solid #2ea043;
    border-radius: 10px;
    padding: 0.55rem 1.3rem;
  }
  :global(button.primary.alt) {
    background: #1f6feb;
    border-color: #388bfd;
  }
  :global(button.primary.big) {
    font-size: 1.15rem;
    padding: 0.8rem 2rem;
  }
  :global(button.primary:disabled) {
    opacity: 0.5;
    cursor: default;
  }
  :global(button.secondary) {
    background: #21262d;
    color: #c9d1d9;
    border: 1px solid #30363d;
    border-radius: 10px;
    padding: 0.5rem 1.1rem;
  }
  :global(input, select) {
    background: #161b22;
    color: #e6edf3;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 0.5rem 0.7rem;
  }

  .toast {
    position: fixed;
    bottom: max(1rem, env(safe-area-inset-bottom));
    left: 50%;
    transform: translateX(-50%);
    background: #3d1418;
    border: 1px solid #f85149;
    border-radius: 10px;
    padding: 0.6rem 1rem;
    display: flex;
    gap: 0.8rem;
    align-items: center;
    z-index: 50;
  }
  .toast button {
    background: none;
    border: none;
    color: #f85149;
  }
</style>
