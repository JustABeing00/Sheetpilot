import { createElement, useEffect, useRef, type ReactNode } from 'react';

export type RevealTag =
  'div' | 'section' | 'article' | 'li' | 'header' | 'footer' | 'span' | 'p' | 'h1' | 'h2' | 'h3';

interface RevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: RevealTag;
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Fades and lifts its children into view the first time they intersect the viewport.
 * Falls back to a static, fully-visible render when the user prefers reduced motion.
 */
export function Reveal({ children, className, delay = 0, as = 'div' }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      node.classList.add('reveal-visible');
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('reveal-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.14 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return createElement(
    as,
    {
      ref,
      className: className ? `reveal ${className}` : 'reveal',
      style: delay ? { transitionDelay: `${delay}ms` } : undefined,
    },
    children,
  );
}
