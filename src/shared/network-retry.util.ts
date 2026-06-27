const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
]);

export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [500, 1000, 1500];

export const isNetworkError = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && NETWORK_ERROR_CODES.has(code);
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const retryOnNetworkError = async <T>(
  operation: () => Promise<T>,
  delaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): Promise<T> => {
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    try {
      return await operation();
    } catch (err: unknown) {
      if (!isNetworkError(err) || attempt === delaysMs.length) {
        throw err;
      }
      await sleep(delaysMs[attempt]);
    }
  }
  throw new Error('retryOnNetworkError: unreachable');
};
