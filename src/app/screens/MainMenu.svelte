<script lang="ts">
  import { app } from '../state.svelte';
  import { facade } from '../GameFacade';

  let name = $state(app.settings?.playerName ?? '');

  $effect(() => {
    if (app.settings && !name) name = app.settings.playerName;
  });

  function saveName(): void {
    void facade.updateSettings({ playerName: name.trim() });
  }

  function go(screen: 'host' | 'join'): void {
    facade.audio.unlock();
    saveName();
    app.screen = screen;
  }
</script>

<main class="menu">
  <img src="/icon.svg" alt="" width="88" height="88" />
  <h1>HideOut</h1>
  <p class="tagline">Offline LAN prop-hunt — same Wi-Fi, no internet.</p>

  <label class="name">
    <span>Your name</span>
    <input bind:value={name} onblur={saveName} maxlength="16" placeholder="Player" />
  </label>

  <div class="actions">
    <button class="primary big" onclick={() => go('host')}>Host Game</button>
    <button class="primary big alt" onclick={() => go('join')}>Join Game</button>
  </div>

  {#if app.settings}
    <details class="settings">
      <summary>Settings</summary>
      <label>
        <span>Look sensitivity: {app.settings.sensitivity.toFixed(1)}</span>
        <input
          type="range"
          min="0.3"
          max="2.5"
          step="0.1"
          value={app.settings.sensitivity}
          oninput={(e) =>
            facade.updateSettings({ sensitivity: Number((e.target as HTMLInputElement).value) })}
        />
      </label>
      <label>
        <span>Volume: {Math.round(app.settings.volume * 100)}%</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={app.settings.volume}
          oninput={(e) =>
            facade.updateSettings({ volume: Number((e.target as HTMLInputElement).value) })}
        />
      </label>
      <label>
        <span>Graphics</span>
        <select
          value={app.settings.quality}
          onchange={(e) =>
            facade.updateSettings({
              quality: (e.target as HTMLSelectElement).value as 'auto' | 'high' | 'medium' | 'low',
            })}
        >
          <option value="auto">Auto (adaptive)</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low / battery saver</option>
        </select>
      </label>
    </details>
  {/if}
</main>

<style>
  .menu {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 1rem;
    text-align: center;
  }
  h1 {
    margin: 0;
    font-size: clamp(2.2rem, 9vw, 3.6rem);
  }
  .tagline {
    margin: 0 0 1rem;
    color: #9aa7b2;
  }
  .name {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.85rem;
    color: #9aa7b2;
  }
  .name input {
    text-align: center;
    font-size: 1.1rem;
  }
  .actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 1rem;
    flex-wrap: wrap;
    justify-content: center;
  }
  .settings {
    margin-top: 1.5rem;
    width: min(20rem, 90vw);
    text-align: left;
    color: #9aa7b2;
    font-size: 0.9rem;
  }
  .settings label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    margin-top: 0.7rem;
  }
</style>
