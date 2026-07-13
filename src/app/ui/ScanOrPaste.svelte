<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import QrScanner from 'qr-scanner';

  const {
    label,
    onresult,
  }: {
    label: string;
    onresult: (text: string) => void;
  } = $props();

  let text = $state('');
  let scanning = $state(false);
  let scanError = $state('');
  let videoEl = $state<HTMLVideoElement | null>(null);
  let scanner: QrScanner | null = null;

  // Camera availability is probed, not assumed (iOS installed-PWA caveat).
  const canScan = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  async function startScan(): Promise<void> {
    scanError = '';
    scanning = true;
    await tick(); // wait for the <video> to exist
    if (!videoEl) return;
    try {
      scanner = new QrScanner(
        videoEl,
        (result) => {
          stopScan();
          onresult(result.data);
        },
        { returnDetailedScanResult: true, highlightScanRegion: true },
      );
      await scanner.start();
    } catch {
      stopScan();
      scanError = 'Camera unavailable — paste the code instead.';
    }
  }

  function stopScan(): void {
    scanner?.stop();
    scanner?.destroy();
    scanner = null;
    scanning = false;
  }

  async function pasteFromClipboard(): Promise<void> {
    try {
      text = await navigator.clipboard.readText();
    } catch {
      /* clipboard permission denied — manual paste still works */
    }
  }

  function submit(): void {
    if (text.trim()) onresult(text.trim());
  }

  onDestroy(stopScan);
</script>

<div class="scan-or-paste">
  {#if scanning}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={videoEl} class="preview"></video>
    <button class="secondary" onclick={stopScan}>Stop scanning</button>
  {:else}
    <label>
      <span>{label}</span>
      <textarea
        bind:value={text}
        rows="3"
        placeholder="Paste code here…"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
      ></textarea>
    </label>
    <div class="row">
      <button class="secondary" onclick={pasteFromClipboard}>Paste</button>
      {#if canScan}
        <button class="secondary" onclick={startScan}>Scan QR</button>
      {/if}
      <button class="primary" onclick={submit} disabled={!text.trim()}>Connect</button>
    </div>
    {#if scanError}<p class="err">{scanError}</p>{/if}
  {/if}
</div>

<style>
  .scan-or-paste {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .preview {
    width: 100%;
    max-height: 50vh;
    border-radius: 8px;
    background: #000;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.85rem;
    color: #9aa7b2;
  }
  textarea {
    resize: vertical;
    background: #161b22;
    color: #e6edf3;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 0.5rem;
    font-family: monospace;
    font-size: 0.75rem;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .err {
    color: #f85149;
    font-size: 0.8rem;
    margin: 0;
  }
</style>
