<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../state.svelte';
  import { facade } from '../GameFacade';
  import { Buttons, GamePhase } from '../../game/types';

  let canvas: HTMLCanvasElement;
  let container: HTMLElement;

  const phaseLabel = $derived(
    (
      {
        [GamePhase.Waiting]: 'Warm-up',
        [GamePhase.Preparation]: 'Get ready…',
        [GamePhase.Hiding]: app.hud.role === 'hunter' ? 'Hiders are hiding' : 'HIDE!',
        [GamePhase.Hunting]: app.hud.role === 'hunter' ? 'HUNT!' : 'Stay hidden!',
        [GamePhase.RoundEnd]: 'Round over',
      } as Record<GamePhase, string>
    )[app.phase],
  );

  const countdown = $derived(
    app.secondsLeft < 0
      ? ''
      : `${Math.floor(app.secondsLeft / 60)}:${String(Math.ceil(app.secondsLeft) % 60).padStart(2, '0')}`,
  );

  function press(button: Buttons) {
    return (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
      facade.audio.unlock();
      facade.input.pressButton(button);
    };
  }

  // View toggle is a local, non-networked action — call the facade directly
  // (not through the Buttons/input path). stopPropagation keeps the tap from
  // reaching the canvas joystick/look handler underneath.
  function toggleView(ev: Event) {
    ev.stopPropagation();
    ev.preventDefault();
    facade.audio.unlock();
    facade.toggleCameraView();
  }

  onMount(() => {
    void facade.startMatch(canvas, container);
    return () => facade.stopMatch();
  });
</script>

<main class="game" bind:this={container}>
  <canvas bind:this={canvas}></canvas>

  <!-- ── HUD ─────────────────────────────────────────── -->
  <div class="hud top">
    <div class="badge role" class:hunter={app.hud.role === 'hunter'}>
      {app.hud.role === 'hunter' ? '🔦 Hunter' : '📦 Hider'}
    </div>
    <div class="phase">
      <strong>{phaseLabel}</strong>
      {#if countdown}<span class="clock">{countdown}</span>{/if}
    </div>
    <div class="badge net">{app.hud.rttMs} ms · {app.hud.fps} fps</div>
  </div>

  {#if app.hud.role === 'hunter' && app.hud.health <= 200}
    <div class="hp"><div class="hp-fill" style:width="{app.hud.health}%"></div></div>
  {/if}

  <div class="crosshair" aria-hidden="true">+</div>

  {#if app.killFeed.length}
    <ul class="killfeed">
      {#each app.killFeed as line, i (i)}<li>{line}</li>{/each}
    </ul>
  {/if}

  <!-- Hunter blindfold while hiders hide -->
  {#if app.hud.role === 'hunter' && app.phase === GamePhase.Hiding}
    <div class="overlay blindfold">
      <h2>Close your eyes…</h2>
      <p>The hiders are choosing disguises. {countdown}</p>
    </div>
  {/if}

  {#if app.phase === GamePhase.Preparation}
    <div class="overlay prep">
      <h2>{app.hud.role === 'hunter' ? 'You are the HUNTER' : 'You are a HIDER'}</h2>
      <p>
        {app.hud.role === 'hunter'
          ? 'Find the fake props. Wrong guesses cost health!'
          : 'Blend in as a prop. Survive the hunt!'}
      </p>
    </div>
  {/if}

  {#if !app.hud.alive && (app.phase === GamePhase.Hunting || app.phase === GamePhase.Hiding)}
    <div class="overlay eliminated">
      <h2>You were found!</h2>
      <p>Watch the rest of the round.</p>
    </div>
  {/if}

  {#if app.lastResult && app.phase === GamePhase.RoundEnd}
    <div class="overlay results" class:won={app.lastResult.localWon}>
      <h2>{app.lastResult.winner === 'hunter' ? '🔦 Hunter wins!' : '📦 Hiders win!'}</h2>
      {#if app.lastResult.survivorNames.length}
        <p>Survivors: {app.lastResult.survivorNames.join(', ')}</p>
      {/if}
      <p class="small">Back to the lobby shortly…</p>
    </div>
  {/if}

  <!-- ── Action buttons (touch) ───────────────────────── -->
  <div class="actions">
    {#if app.hud.role === 'hunter'}
      <button class="action attack" onpointerdown={press(Buttons.Attack)}>ATTACK</button>
    {:else if app.hud.alive}
      <button class="action" onpointerdown={press(Buttons.Possess)}>
        POSSESS{#if app.hud.swapsLeft >= 0}<small>{app.hud.swapsLeft} left</small>{/if}
      </button>
      <button
        class="action"
        class:active={app.hud.locked}
        disabled={!app.hud.disguised}
        onpointerdown={press(Buttons.Lock)}
      >
        {app.hud.locked ? 'UNLOCK' : 'LOCK'}
      </button>
      <button class="action" onpointerdown={press(Buttons.Taunt)}>
        BAIT<small>taunt early</small>
      </button>
    {/if}
  </div>

  <button class="view-toggle" onpointerdown={toggleView} title="Switch camera (V)">
    👁 {app.cameraView === 'first' ? '1st' : '3rd'}
  </button>

  <button class="quit" onclick={() => facade.leaveGame()}>✕</button>
</main>

<style>
  .game {
    position: fixed;
    inset: 0;
    overflow: hidden;
    touch-action: none;
    background: #05070a;
    user-select: none;
    -webkit-user-select: none;
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
    outline: none;
  }

  .view-toggle {
    position: absolute;
    top: calc(max(0.5rem, env(safe-area-inset-top)) + 2.7rem);
    left: 0.75rem;
    background: rgba(13, 17, 23, 0.75);
    border: 1px solid #30363d;
    border-radius: 999px;
    padding: 0.35rem 0.7rem;
    color: #c9d1d9;
    font-size: 0.8rem;
  }

  .hud.top {
    position: absolute;
    top: max(0.5rem, env(safe-area-inset-top));
    left: 0.75rem;
    right: 0.75rem;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.5rem;
    pointer-events: none;
  }
  .badge {
    background: rgba(13, 17, 23, 0.75);
    border: 1px solid #30363d;
    border-radius: 999px;
    padding: 0.3rem 0.7rem;
    font-size: 0.8rem;
  }
  .badge.role.hunter {
    border-color: #f85149;
  }
  .phase {
    text-align: center;
    background: rgba(13, 17, 23, 0.75);
    border: 1px solid #30363d;
    border-radius: 10px;
    padding: 0.3rem 1rem;
  }
  .clock {
    margin-left: 0.6rem;
    color: #e3b341;
    font-variant-numeric: tabular-nums;
  }

  .hp {
    position: absolute;
    top: 3.4rem;
    left: 50%;
    transform: translateX(-50%);
    width: min(18rem, 60vw);
    height: 10px;
    border-radius: 6px;
    background: rgba(13, 17, 23, 0.8);
    border: 1px solid #30363d;
    overflow: hidden;
  }
  .hp-fill {
    height: 100%;
    background: linear-gradient(90deg, #f85149, #e3b341);
    transition: width 0.25s ease;
  }

  .crosshair {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: rgba(230, 237, 243, 0.8);
    font-size: 1.4rem;
    pointer-events: none;
  }

  .killfeed {
    position: absolute;
    bottom: 6.5rem;
    left: 0.75rem;
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 0.8rem;
    color: #e6edf3;
    pointer-events: none;
  }
  .killfeed li {
    background: rgba(13, 17, 23, 0.7);
    border-radius: 6px;
    padding: 0.2rem 0.5rem;
    margin-top: 0.25rem;
  }

  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    pointer-events: none;
    padding: 1rem;
  }
  .overlay h2 {
    margin: 0 0 0.4rem;
    font-size: clamp(1.5rem, 6vw, 2.4rem);
    text-shadow: 0 2px 12px #000;
  }
  .overlay p {
    margin: 0;
    color: #c9d1d9;
    text-shadow: 0 1px 8px #000;
  }
  .blindfold {
    background: rgba(2, 4, 7, 0.93);
  }
  .prep {
    background: rgba(2, 4, 7, 0.55);
  }
  .eliminated {
    background: rgba(60, 8, 8, 0.35);
  }
  .results {
    background: rgba(2, 4, 7, 0.75);
  }
  .results .small {
    color: #9aa7b2;
    margin-top: 0.6rem;
  }

  .actions {
    position: absolute;
    right: max(0.75rem, env(safe-area-inset-right));
    bottom: max(1rem, env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .action {
    min-width: 6.2rem;
    padding: 0.9rem 1rem;
    border-radius: 14px;
    border: 1px solid #30363d;
    background: rgba(22, 27, 34, 0.85);
    color: #e6edf3;
    font-weight: 700;
    letter-spacing: 0.04em;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
  }
  .action small {
    font-weight: 400;
    color: #9aa7b2;
    font-size: 0.7rem;
  }
  .action.attack {
    border-color: #f85149;
    background: rgba(120, 20, 20, 0.85);
    min-height: 5.4rem;
    justify-content: center;
  }
  .action.active {
    border-color: #4cc38a;
  }
  .action:disabled {
    opacity: 0.4;
  }

  .quit {
    position: absolute;
    bottom: max(1rem, env(safe-area-inset-bottom));
    left: max(0.75rem, env(safe-area-inset-left));
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 50%;
    border: 1px solid #30363d;
    background: rgba(13, 17, 23, 0.75);
    color: #9aa7b2;
  }
  .hud.top .badge.net {
    font-variant-numeric: tabular-nums;
  }
</style>
