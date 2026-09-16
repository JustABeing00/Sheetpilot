import { AiProviderError } from './errors.js';

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AiProviderError('AI request aborted', { kind: 'timeout', retryable: false }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs a provider call with a hard deadline. The provider receives an `AbortSignal` so a
 * well-behaved adapter cancels its in-flight request; the race still rejects if it does not.
 */
export async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new AiProviderError(`AI request exceeded ${options.timeoutMs} ms`, {
          kind: 'timeout',
          retryable: true,
        }),
      );
    }, options.timeoutMs);
  });

  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    options.signal?.removeEventListener('abort', onParentAbort);
  }
}
