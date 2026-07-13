<script lang="ts">
  import { app } from '../state.svelte';
  import { facade } from '../GameFacade';
  import { createHostPeer, type PendingHostPeer } from '../../net/transport/WebRTCTransport';
  import QrCode from '../ui/QrCode.svelte';
  import ScanOrPaste from '../ui/ScanOrPaste.svelte';

  let ready = $state(false);
  let invite = $state<{ blob: string; pending: PendingHostPeer } | null>(null);
  let inviteBusy = $state(false);
  let inviteError = $state('');
  let copied = $state(false);

  const allReady = $derived(app.roster.length >= 2 && app.roster.every((r) => r.ready));

  function toggleReady(): void {
    facade.audio.unlock();
    ready = !ready;
    facade.setReady(ready);
  }

  async function newInvite(): Promise<void> {
    facade.audio.unlock();
    inviteError = '';
    inviteBusy = true;
    try {
      const pending = await createHostPeer();
      invite = { blob: pending.offerBlob, pending };
    } catch {
      inviteError = 'Could not create an invite (WebRTC unavailable?).';
    } finally {
      inviteBusy = false;
    }
  }

  async function onAnswer(text: string): Promise<void> {
    const current = invite;
    if (!current) return;
    inviteError = '';
    try {
      const link = await current.pending.acceptAnswer(text);
      facade.attachPeer(link);
    } catch {
      inviteError = 'That reply code did not work — create a fresh invite and retry.';
      current.pending.cancel();
    } finally {
      invite = null; // either way, the next player needs a fresh invite
    }
  }

  function cancelInvite(): void {
    invite?.pending.cancel();
    invite = null;
  }

  async function copyInvite(): Promise<void> {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.blob);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      /* ignore */
    }
  }

  function startRound(): void {
    facade.audio.unlock();
    facade.startRound();
  }

  function leave(): void {
    cancelInvite();
    facade.leaveGame();
  }
</script>

<main class="lobby">
  <header>
    <h2>{app.roomName || 'Lobby'}</h2>
    <span class="sub">{app.isHost ? 'You are hosting' : 'Connected to host'} · Warehouse</span>
  </header>

  {#if app.lastResult}
    <div class="result-banner" class:won={app.lastResult.localWon}>
      {app.lastResult.winner === 'hunter' ? '🔦 Hunter wins!' : '📦 Hiders win!'}
      {#if app.lastResult.survivorNames.length}
        <small>Survivors: {app.lastResult.survivorNames.join(', ')}</small>
      {/if}
    </div>
  {/if}

  <ul class="roster">
    {#each app.roster as entry (entry.netId)}
      <li>
        <span class="dot" class:ready={entry.ready}></span>
        <span class="pname">
          {entry.name}
          {#if entry.netId === 0}<span class="crown" title="Host">♛</span>{/if}
          {#if entry.netId === app.localNetId}<em>(you)</em>{/if}
        </span>
        <span class="state">{entry.ready ? 'Ready' : 'Not ready'}</span>
      </li>
    {/each}
  </ul>

  <div class="actions">
    {#if !app.isHost}
      <button class="primary big" onclick={toggleReady}>
        {ready ? 'Not ready' : 'Ready!'}
      </button>
    {:else}
      <button class="primary big" onclick={startRound} disabled={!allReady}>
        {allReady ? 'Start Round' : `Waiting for players (${app.roster.length})…`}
      </button>
    {/if}
    <button class="secondary" onclick={leave}>Leave</button>
  </div>

  {#if app.isHost}
    <section class="invite">
      <h3>Invite players</h3>
      {#if !invite}
        <button class="secondary" onclick={newInvite} disabled={inviteBusy}>
          {inviteBusy ? 'Preparing invite…' : '+ Invite a player'}
        </button>
      {:else}
        <p class="hint">1 · The joiner scans/pastes this invite code:</p>
        <QrCode data={invite.blob} size={220} />
        <textarea
          class="blob-out"
          readonly
          rows="2"
          value={invite.blob}
          onfocus={(e) => (e.target as HTMLTextAreaElement).select()}
        ></textarea>
        <button class="secondary" onclick={copyInvite}
          >{copied ? 'Copied!' : 'Copy invite code'}</button
        >
        <p class="hint">2 · Then scan or paste their reply code:</p>
        <ScanOrPaste label="Joiner's reply code" onresult={(t) => void onAnswer(t)} />
        <button class="secondary" onclick={cancelInvite}>Cancel invite</button>
      {/if}
      {#if inviteError}<p class="err">{inviteError}</p>{/if}
    </section>
  {/if}
</main>

<style>
  .lobby {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 2rem 1rem;
  }
  header {
    text-align: center;
  }
  h2 {
    margin: 0;
  }
  .sub {
    color: #9aa7b2;
    font-size: 0.85rem;
  }
  .result-banner {
    background: #21262d;
    border: 1px solid #f85149;
    border-radius: 10px;
    padding: 0.6rem 1.2rem;
    text-align: center;
    display: flex;
    flex-direction: column;
  }
  .result-banner.won {
    border-color: #4cc38a;
  }
  .roster {
    list-style: none;
    margin: 0;
    padding: 0;
    width: min(24rem, 92vw);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .roster li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 10px;
    padding: 0.55rem 0.8rem;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #6e7681;
  }
  .dot.ready {
    background: #4cc38a;
  }
  .pname {
    flex: 1;
    text-align: left;
  }
  .pname em {
    color: #9aa7b2;
    font-style: normal;
    font-size: 0.8rem;
  }
  .crown {
    color: #e3b341;
  }
  .state {
    font-size: 0.8rem;
    color: #9aa7b2;
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
  }
  .invite {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    border-top: 1px solid #30363d;
    padding-top: 1rem;
    width: min(24rem, 92vw);
  }
  .invite h3 {
    margin: 0;
  }
  .hint {
    color: #9aa7b2;
    font-size: 0.85rem;
    margin: 0;
  }
  .err {
    color: #f85149;
    font-size: 0.85rem;
  }
  .blob-out {
    width: 100%;
    resize: none;
    background: #161b22;
    color: #9aa7b2;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 0.4rem;
    font-family: monospace;
    font-size: 0.65rem;
  }
  :global(.invite .scan-or-paste) {
    width: 100%;
  }
</style>
