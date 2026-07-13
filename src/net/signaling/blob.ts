/**
 * Offline signaling blob codec.
 *
 * WebRTC needs an out-of-band exchange of session descriptions. With no server,
 * that exchange travels via QR code or copy/paste, so it must be compact and
 * text-safe: deflate (fflate) + base64url. A version prefix guards against
 * scanning a QR from an incompatible build.
 */
import { deflateSync, inflateSync } from 'fflate';

const VERSION = 'H1';

export interface SignalBlob {
  /** 'offer' | 'answer' */
  type: RTCSdpType | string;
  sdp: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function encodeSignalBlob(blob: SignalBlob): string {
  const json = JSON.stringify([blob.type, blob.sdp]);
  const compressed = deflateSync(new TextEncoder().encode(json), { level: 9 });
  return VERSION + toBase64Url(compressed);
}

export function decodeSignalBlob(text: string): SignalBlob {
  const trimmed = text.trim();
  if (!trimmed.startsWith(VERSION)) {
    throw new Error('Not a HideOut invite code (bad or outdated version)');
  }
  const compressed = fromBase64Url(trimmed.slice(VERSION.length));
  const json = new TextDecoder().decode(inflateSync(compressed));
  const [type, sdp] = JSON.parse(json) as [string, string];
  if (typeof type !== 'string' || typeof sdp !== 'string') {
    throw new Error('Malformed invite code');
  }
  return { type, sdp };
}
