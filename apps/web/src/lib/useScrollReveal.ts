import { useEffect } from 'react';

const SELECTOR = '[data-reveal], .page > *:not(.page-header)';

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Adds a subtle scroll-reveal animation to the top-level blocks of the active page.
 * Re-scans as route content streams in so lazily-loaded pages are covered too.
 */
export function useScrollReveal(dependency: unknown) {
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const root = document.querySelector('#main') ?? document.body;
    const reduce = prefersReducedMotion();
    const seen = new WeakSet<Element>();

    const observer =
      !reduce && typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (entry.isIntersecting) {
                  entry.target.classList.add('reveal-visible');
                  observer?.unobserve(entry.target);
                }
              }
            },
            { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
          )
        : null;

    const register = (element: Element, index: number) => {
      if (seen.has(element)) {
        return;
      }
      seen.add(element);

      const node = element as HTMLElement;
      if (node.classList.contains('reveal') || node.classList.contains('reveal-visible')) {
        return;
      }

      if (!observer) {
        node.classList.add('reveal-visible');
        return;
      }

      node.classList.add('reveal');
      if (index < 8) {
        node.style.transitionDelay = `${index * 40}ms`;
      }
      observer.observe(node);
    };

    const scan = () => {
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(SELECTOR));
      nodes.forEach((node, index) => register(node, index));
    };

    scan();

    if (typeof MutationObserver === 'undefined') {
      return () => observer?.disconnect();
    }

    const mutation = new MutationObserver(() => scan());
    mutation.observe(root, { childList: true, subtree: true });

    return () => {
      observer?.disconnect();
      mutation.disconnect();
    };
  }, [dependency]);
}
