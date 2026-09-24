/**
 * @fileoverview Low-end device detection: when the frame rate during the
 * first seconds is poor, glass panels switch to solid backgrounds
 * (`<html data-solid="true">`) to avoid expensive backdrop blur.
 */

/** Samples rAF for `ms` and enables solid panels below `minFps`. */
export function detectLowFrameRate(ms = 2000, minFps = 30): void {
  if (
    typeof requestAnimationFrame === 'undefined' ||
    typeof document === 'undefined'
  )
    return;
  let frames = 0;
  const start = performance.now();
  const tick = (now: number) => {
    frames += 1;
    if (now - start < ms) {
      requestAnimationFrame(tick);
      return;
    }
    const fps = (frames * 1000) / (now - start);
    if (fps < minFps && document.visibilityState === 'visible') {
      document.documentElement.dataset.solid = 'true';
    }
  };
  requestAnimationFrame(tick);
}
