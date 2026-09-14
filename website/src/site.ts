// Clips play only while on screen, and not at all for people who prefer reduced motion (they get the poster and controls).
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const videos = [...document.querySelectorAll<HTMLVideoElement>(".capture video")];

if (reduced) {
  for (const v of videos) {
    v.removeAttribute("autoplay");
    v.pause();
    v.controls = true;
  }
} else {
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target as HTMLVideoElement;
      if (e.isIntersecting) {
        v.preload = "auto";
        v.play().catch(() => { v.controls = true; }); // autoplay blocked: let the viewer start it
      } else {
        v.pause();
      }
    }
  }, { threshold: 0.35 });
  for (const v of videos) seen.observe(v);
}
