<script lang="ts">
  import { app } from '../state.svelte';
  import { facade } from '../GameFacade';

  let roomName = $state('');
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

  <div class="actions">
    <button class="primary big" onclick={() => facade.hostGame(roomName)}>Create Room</button>
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
  .actions {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    align-items: center;
  }
</style>
