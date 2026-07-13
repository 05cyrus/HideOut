import { describe, it, expect } from 'vitest';
import { encodeSignalBlob, decodeSignalBlob } from './blob';

// A realistic (shortened) SDP with host + mDNS candidates.
const sampleSdp = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:F7gI',
  'a=ice-pwd:x9cml/YzichV2+XlhiMu8g',
  'a=fingerprint:sha-256 49:66:12:17:0D:1C:91:AE:57:4C:C6:36:DD:D5:97:D2:7D:62:C9:9A:7F:B9:A3:F4:70:03:E7:43:91:73:23:5E',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=candidate:2999745851 1 udp 2122260223 192.168.1.34 51840 typ host generation 0',
  'a=candidate:3160592515 1 udp 2122194687 a1b2c3d4-e5f6-a1b2-c3d4-e5f6a1b2c3d4.local 51841 typ host generation 0',
].join('\r\n');

describe('signal blob codec', () => {
  it('round-trips an offer', () => {
    const blob = encodeSignalBlob({ type: 'offer', sdp: sampleSdp });
    const decoded = decodeSignalBlob(blob);
    expect(decoded.type).toBe('offer');
    expect(decoded.sdp).toBe(sampleSdp);
  });

  it('produces QR-friendly output (base64url, compressed)', () => {
    const blob = encodeSignalBlob({ type: 'offer', sdp: sampleSdp });
    expect(blob).toMatch(/^H1[A-Za-z0-9_-]+$/); // no +, /, = — safe for QR/URL
    expect(blob.length).toBeLessThan(sampleSdp.length); // deflate wins on SDP text
  });

  it('tolerates surrounding whitespace (paste sloppiness)', () => {
    const blob = encodeSignalBlob({ type: 'answer', sdp: sampleSdp });
    expect(decodeSignalBlob(`  ${blob}\n`).type).toBe('answer');
  });

  it('rejects garbage and wrong versions with a clear error', () => {
    expect(() => decodeSignalBlob('not-a-code')).toThrow(/invite code/);
    expect(() => decodeSignalBlob('H9AAAA')).toThrow(/invite code/);
  });
});
