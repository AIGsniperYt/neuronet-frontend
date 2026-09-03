// Wrapper around the vendored Mozilla pdf.js build (v6.3.289).
// Exposes getDocument + GlobalWorkerOptions so the scraper can extract text
// from exam-board PDF fact sheets. The worker file is same-origin, so the
// module worker spawns without any bundler or CDN setup.
export * from "./pdf.min.mjs";