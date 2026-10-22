/**
 * Structural stylesheet for public storefront pages. A code constant: it only
 * reads the `--sf-*` custom properties emitted from validated theme tokens and
 * never contains merchant input. Kept free of `<`, `>` and `&` so it is safe as
 * plain text inside a `<style>` element.
 */
export const STOREFRONT_STRUCTURAL_CSS = [
  '.sf-root{background:var(--sf-color-background);color:var(--sf-color-text);font-family:var(--sf-font-body);line-height:1.6;min-height:100vh;display:flex;flex-direction:column}',
  '.sf-root a{color:var(--sf-color-primary);text-underline-offset:0.2em}',
  '.sf-root h1,.sf-root h2,.sf-root h3{font-family:var(--sf-font-heading);line-height:1.2;margin:0}',
  '.sf-container{width:100%;max-width:72rem;margin:0 auto;padding:0 calc(var(--sf-space) * 1.25)}',
  '.sf-header{border-bottom:1px solid var(--sf-color-border);background:var(--sf-color-surface)}',
  '.sf-header-inner{display:flex;align-items:center;justify-content:space-between;gap:var(--sf-space);padding-top:calc(var(--sf-space) * 0.75);padding-bottom:calc(var(--sf-space) * 0.75)}',
  '.sf-brand{display:flex;align-items:center;gap:calc(var(--sf-space) * 0.75);color:var(--sf-color-text);text-decoration:none;font-family:var(--sf-font-heading);font-weight:700;font-size:1.25rem}',
  '.sf-logo{display:block;height:2.5rem;width:auto;max-width:10rem;object-fit:contain}',
  '.sf-header-link{font-weight:600}',
  '.sf-main{flex:1}',
  '.sf-section{padding-top:calc(var(--sf-space) * 3);padding-bottom:calc(var(--sf-space) * 3)}',
  '.sf-section+.sf-section{border-top:1px solid var(--sf-color-border)}',
  '.sf-hero{background:var(--sf-color-surface)}',
  '.sf-hero-inner{display:flex;flex-direction:column;gap:var(--sf-space);align-items:flex-start}',
  '.sf-hero-inner[data-align="center"]{align-items:center;text-align:center}',
  '.sf-hero h1{font-size:clamp(2rem,5vw,3.25rem)}',
  '.sf-hero p{font-size:1.125rem;color:var(--sf-color-muted-text);max-width:40rem;margin:0}',
  '.sf-button{display:inline-block;background:var(--sf-color-primary);color:var(--sf-color-on-primary) !important;border-radius:var(--sf-radius);padding:calc(var(--sf-space) * 0.6) calc(var(--sf-space) * 1.4);font-weight:600;text-decoration:none}',
  '.sf-button:focus-visible,.sf-root a:focus-visible{outline:3px solid var(--sf-color-accent);outline-offset:3px}',
  '.sf-section-title{font-size:1.75rem;margin-bottom:calc(var(--sf-space) * 1.5) !important}',
  '.sf-features{display:grid;gap:var(--sf-space);grid-template-columns:repeat(auto-fit,minmax(14rem,1fr))}',
  '.sf-feature{background:var(--sf-color-surface);border:1px solid var(--sf-color-border);border-radius:var(--sf-radius);padding:calc(var(--sf-space) * 1.25)}',
  '.sf-feature h3{font-size:1.125rem;margin-bottom:calc(var(--sf-space) * 0.5)}',
  '.sf-feature p{margin:0;color:var(--sf-color-muted-text)}',
  '.sf-prose{max-width:44rem}',
  '.sf-prose p,.sf-prose ul,.sf-prose ol{margin:0 0 var(--sf-space) 0}',
  '.sf-footer{background:var(--sf-color-surface);color:var(--sf-color-muted-text);font-size:0.9375rem}',
  '.sf-footer-inner{display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--sf-space)}',
  '.sf-footer ul{list-style:none;display:flex;flex-wrap:wrap;gap:var(--sf-space);margin:0;padding:0}',
  '.sf-unavailable{display:flex;min-height:60vh;align-items:center;justify-content:center;text-align:center;padding:2rem}',
  '@media (prefers-reduced-motion: reduce){.sf-root *{transition:none !important;animation:none !important}}',
].join('')
