// Extend Vitest's `expect` with @testing-library/jest-dom matchers
// (e.g. toBeInTheDocument, toHaveAttribute).
// This runs for every test environment (node + jsdom) — the matchers are
// registered once and do no harm in the node suite.
import '@testing-library/jest-dom/vitest'

// jsdom does not implement scrollIntoView — stub it so components that call
// element.scrollIntoView() (e.g. the bottom-ref scroll in ChatPane) don't throw.
if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.scrollIntoView = function () {}
}
