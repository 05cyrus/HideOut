/**
 * Runtime capability probe.
 *
 * Feeds three subsystems:
 *  - discovery tier selection (does the camera work for QR? is this a native host?)
 *  - renderer quality defaults (WebGPU vs WebGL2, memory/CPU hints)
 *  - install/offline UX (standalone display mode, service-worker support)
 *
 * Everything is feature-detected and guarded so a missing API degrades to `false`
 * rather than throwing.
 */
export interface Capabilities {
  readonly webgl2: boolean;
  readonly webgpu: boolean;
  readonly webrtc: boolean;
  readonly camera: boolean;
  readonly standalone: boolean;
  readonly touch: boolean;
  readonly serviceWorker: boolean;
  readonly storage: boolean;
  readonly deviceMemory: number | null;
  readonly hardwareConcurrency: number;
}

/** Non-standard / vendor-prefixed navigator fields we probe defensively. */
interface NavigatorExt extends Navigator {
  deviceMemory?: number;
  standalone?: boolean;
}

function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

function isStandalone(nav: NavigatorExt): boolean {
  const displayStandalone =
    typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
  return displayStandalone || nav.standalone === true;
}

export function detectCapabilities(): Capabilities {
  const nav = navigator as NavigatorExt;

  return {
    webgl2: hasWebGL2(),
    webgpu: 'gpu' in navigator,
    webrtc: typeof RTCPeerConnection !== 'undefined',
    camera: Boolean(nav.mediaDevices?.getUserMedia),
    standalone: isStandalone(nav),
    touch: 'ontouchstart' in window || nav.maxTouchPoints > 0,
    serviceWorker: 'serviceWorker' in navigator,
    storage: 'indexedDB' in window,
    deviceMemory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    hardwareConcurrency: nav.hardwareConcurrency || 1,
  };
}
