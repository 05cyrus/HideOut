<script lang="ts">
  import { app } from '../state.svelte';
  import { facade } from '../GameFacade';
  import { joinHostPeer } from '../../net/transport/WebRTCTransport';
  import QrCode from '../ui/QrCode.svelte';
  import ScanOrPaste from '../ui/ScanOrPaste.svelte';

  type Step = 'offer' | 'answer' | 'connecting';
  let step = $state<Step>('offer');
  let answerBlob = $state('');
  let error = $state('');
  let copied = $state(false);

  async function onOffer(offerText: string): Promise<void> {
    error = '';
    try {
      facade.audio.unlock();
      const result = await joinHostPeer(offerText);
      answerBlob = result.answerBlob;
      step = 'answer';
      // When the host pastes/scans our answer, the channels open and we join.
      result.link
        .then((link) => {
          step = 'connecting';
          facade.joinGame(link);
        })
        .catch(() => {
          error = 'Connection failed — ask the host for a fresh invite.';
          step = 'offer';
        });
    } catch {
      error = 'That is not a valid invite code.';
    }
  }

  async function copyAnswer(): Promise<void> {
    try {
      await navigator.clipboard.writeText(answerBlob);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      /* manual selection still possible */
    }
  }
</script>

<main class="join">
  <h2>Join a room</h2>

  {#if step === 'offer'}
    <p class="hint">
      Ask the host to show their <b>invite code</b> (Lobby → Invite a player), then scan or paste it here.
    </p>
    <ScanOrPaste label="Host's invite code" onresult={(t) => void onOffer(t)} />
  {:else if step === 'answer'}
    <p class="hint">
      Now show this <b>reply code</b> to the host — they scan or paste it to let you in.
    </p>
    <QrCode data={answerBlob} />
    <textarea
      class="blob-out"
      readonly
      rows="2"
      value={answerBlob}
      onfocus={(e) => (e.target as HTMLTextAreaElement).select()}
    ></textarea>
    <button class="secondary" onclick={copyAnswer}>{copied ? 'Copied!' : 'Copy reply code'}</button>
    <p class="waiting">Waiting for the host to accept…</p>
  {:else}
    <p class="waiting">Connecting…</p>
  {/if}

  {#if error}<p class="err">{error}</p>{/if}
  <button class="secondary back" onclick={() => (app.screen = 'menu')}>Back</button>
</main>

<style>
  .join {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.9rem;
    padding: 1rem;
    text-align: center;
  }
  .hint {
    color: #9aa7b2;
    max-width: 26rem;
    margin: 0;
  }
  .waiting {
    color: #4cc38a;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }
  .err {
    color: #f85149;
  }
  .back {
    margin-top: 0.5rem;
  }
  .blob-out {
    width: min(24rem, 92vw);
    resize: none;
    background: #161b22;
    color: #9aa7b2;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 0.4rem;
    font-family: monospace;
    font-size: 0.65rem;
  }
  :global(.join .scan-or-paste) {
    width: min(24rem, 92vw);
  }
</style>
