/**
 * Client debug logger that outputs conditionally in non-production environments.
 * Prevents console spam and passes linter checks without raw console statements.
 */
export const debugLog = {
  log: (...args: unknown[]): void => {
    if (import.meta.env.DEV) {
      /* eslint-disable-next-line no-console */
      console.log(...args);
    }
  },
  info: (...args: unknown[]): void => {
    if (import.meta.env.DEV) {
      /* eslint-disable-next-line no-console */
      console.info(...args);
    }
  },
  warn: (...args: unknown[]): void => {
    if (!import.meta.env.PROD || import.meta.env.DEV) {
      /* eslint-disable-next-line no-console */
      console.warn(...args);
    }
  },
  error: (...args: unknown[]): void => {
    /* eslint-disable-next-line no-console */
    console.error(...args);
  },
};

export default debugLog;
