<script lang="ts">
  import { app } from '../state.svelte';
  import { facade } from '../GameFacade';
  import { mapList } from '../../game/maps';

  let roomName = $state('');
  let mapId = $state(mapList[0]!.id);
</script>

<main class="host">
  <h2>Host a room</h2>
  <p class="hint">
    Your device becomes the game server. Friends join over the same Wi-Fi or your hotspot — no
    internet needed.
  </p>

  <label>
    <span>Room name</span>
    <input bind:value={roomName} maxlength="24" placeholder="{facade.playerName()}'s room" />
  </label>

  <div class="maps" role="radiogroup" aria-label="Map">
    <span class="maps-title">Map</span>
    {#each mapList as map (map.id)}
      <button
        class="map-card"
        class:selected={mapId === map.id}
        role="radio"
        aria-checked={mapId === map.id}
        onclick={() => (mapId = map.id)}
      >
        <strong>{map.name}</strong>
        {#if map.description}<small>{map.description}</small>{/if}
      </button>
    {/each}
  </div>

  <div class="actions">
    <button class="primary big" onclick={() => facade.hostGame(roomName, mapId)}>Create Room</button
    >
    <button class="secondary" onclick={() => (app.screen = 'menu')}>Back</button>
  </div>
</main>

<style>
  .host {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 1rem;
    text-align: center;
  }
  .hint {
    color: #9aa7b2;
    max-width: 26rem;
    margin: 0;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    color: #9aa7b2;
    font-size: 0.85rem;
  }
  label input {
    text-align: center;
    font-size: 1.05rem;
  }
  .maps {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: min(22rem, 90vw);
  }
  .maps-title {
    color: #9aa7b2;
    font-size: 0.85rem;
  }
  .map-card {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.65rem 0.9rem;
    border: 1px solid #2d3a46;
    border-radius: 8px;
    background: #141b22;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }
  .map-card small {
    color: #9aa7b2;
  }
  .map-card.selected {
    border-color: #3aa0ff;
    background: #182534;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    align-items: center;
  }
</style>
