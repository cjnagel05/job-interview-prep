import { createHash } from 'node:crypto'
import type { InterviewPrepAnalysis } from '../src/lib/interview-prep-schema.js'

export type AnalysisRunner = (jobDescription: string) => Promise<InterviewPrepAnalysis>

export function createInterviewAnalysisCache(maxEntries = 100) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError('The analysis cache size must be a positive integer.')
  }

  const cache = new Map<string, InterviewPrepAnalysis>()
  const inFlight = new Map<string, Promise<InterviewPrepAnalysis>>()

  return async function getOrAnalyze(
    jobDescription: string,
    analyze: AnalysisRunner,
  ): Promise<{ analysis: InterviewPrepAnalysis; cacheHit: boolean }> {
    const normalized = jobDescription.trim().replace(/\s+/g, ' ')
    const key = createHash('sha256').update(normalized).digest('hex')
    const cached = cache.get(key)
    if (cached) {
      cache.delete(key)
      cache.set(key, cached)
      return { analysis: cached, cacheHit: true }
    }

    const pending = inFlight.get(key)
    if (pending) return { analysis: await pending, cacheHit: true }

    const analysisPromise = Promise.resolve()
      .then(() => analyze(jobDescription))
      .then((analysis) => {
        cache.set(key, analysis)
        if (cache.size > maxEntries) {
          const oldestKey = cache.keys().next().value
          if (oldestKey !== undefined) cache.delete(oldestKey)
        }
        return analysis
      })
      .finally(() => inFlight.delete(key))

    inFlight.set(key, analysisPromise)
    return { analysis: await analysisPromise, cacheHit: false }
  }
}