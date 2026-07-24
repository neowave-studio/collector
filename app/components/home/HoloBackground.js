"use client";

/**
 * Ambient iridescent atmosphere for the home page — a few very-low-opacity
 * holo blobs drifting behind the glass content. Fixed so it stays as you scroll.
 */
export default function HoloBackground() {
  return (
    <div aria-hidden="true" className="holo-bg">
      <div className="holo-blob holo-blob-1" />
      <div className="holo-blob holo-blob-2" />
      <div className="holo-blob holo-blob-3" />
    </div>
  );
}
