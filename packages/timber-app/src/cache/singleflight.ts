/**
 * Singleflight coalesces concurrent calls with the same key into a single
 * execution. All callers receive the same result (or error).
 *
 * Per-process, in-memory. Each process coalesces independently.
 */
export interface Singleflight {
  do<T>(key: string, fn: () => Promise<T>): Promise<T>
}

export function createSingleflight(): Singleflight {
  const inflight = new Map<string, Promise<unknown>>()

  return {
    do<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const existing = inflight.get(key)
      if (existing) return existing as Promise<T>

      const promise = fn().finally(() => {
        inflight.delete(key)
      })
      inflight.set(key, promise)
      return promise
    },
  }
}
