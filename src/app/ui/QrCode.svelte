<script lang="ts">
  import QRCode from 'qrcode';

  const { data, size = 240 }: { data: string; size?: number } = $props();
  let url = $state('');

  $effect(() => {
    let cancelled = false;
    QRCode.toDataURL(data, { margin: 1, width: size, errorCorrectionLevel: 'L' })
      .then((u) => {
        if (!cancelled) url = u;
      })
      .catch(() => {
        if (!cancelled) url = '';
      });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if url}
  <img src={url} alt="QR code" width={size} height={size} class="qr" />
{:else}
  <div class="qr placeholder" style:width="{size}px" style:height="{size}px">…</div>
{/if}

<style>
  .qr {
    border-radius: 8px;
    background: #fff;
    padding: 6px;
  }
  .placeholder {
    display: grid;
    place-items: center;
    color: #666;
  }
</style>
