import { GoogleGenAI } from '@google/genai'
import { z } from 'zod'
import { interviewPrepSchema, type AnalysisErrorCategory, type InterviewPrepAnalysis } from '../src/lib/interview-prep-schema.js'
import { interviewPrepPrompt } from './prompt.js'

export type GeminiRetryListener = (retryNumber: number, responseStatus: number) => void

export class AnalysisError extends Error {
  constructor(public status: number, public category: AnalysisErrorCategory, message: string) { super(message) }
}

export const GEMINI_REQUEST_TIMEOUT_MS = 45_000
export const GEMINI_TOTAL_REQUEST_BUDGET_MS = 65_000
export const GEMINI_MAX_ATTEMPTS = 2

const retryableGeminiStatuses = new Set([408, 429, 500, 502, 503, 504])

export function geminiHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const candidate = error as { status?: unknown; response?: { status?: unknown } }
  if (typeof candidate.status === 'number') return candidate.status
  return typeof candidate.response?.status === 'number' ? candidate.response.status : undefined
}

export function isGeminiTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: unknown }).name
  // The current Interactions SDK wraps client deadlines in this named error.
  return name === 'APIConnectionTimeoutError' || name === 'RequestTimeoutError' || name === 'TimeoutError'
}

export async function retryGeminiRequest<T>(
  request: (timeoutMs: number) => Promise<T>,
  onRetry: GeminiRetryListener = () => {},
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now: () => number = () => performance.now(),
): Promise<T> {
  const startedAt = now()
  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt += 1) {
    const remainingMs = GEMINI_TOTAL_REQUEST_BUDGET_MS - (now() - startedAt)
    if (remainingMs <= 0) {
      const error = Object.assign(new Error('Gemini request budget exhausted.'), { name: 'TimeoutError' })
      console.info(JSON.stringify({
        event: 'gemini_timeout', attemptNumber: attempt, responseStatus: 408,
        responseDurationMs: Math.round(now() - startedAt), timeoutScope: 'total_budget',
      }))
      throw error
    }
    const timeoutMs = Math.min(GEMINI_REQUEST_TIMEOUT_MS, Math.floor(remainingMs))
    const attemptStartedAt = now()
    try {
      return await request(timeoutMs)
    } catch (error) {
      const status = geminiHttpStatus(error)
      const timedOut = isGeminiTimeout(error) || status === 408 || status === 504
      console.info(JSON.stringify({
        event: timedOut ? 'gemini_timeout' : status === undefined ? 'gemini_connection_error' : 'gemini_http_error',
        attemptNumber: attempt,
        responseStatus: status ?? null,
        timeoutScope: timedOut ? (isGeminiTimeout(error) ? 'client' : 'upstream') : undefined,
        responseDurationMs: Math.round(now() - attemptStartedAt),
        requestTimeoutMs: timeoutMs,
      }))
      const retryStatus = status ?? (timedOut ? 408 : undefined)
      if (retryStatus === undefined || !retryableGeminiStatuses.has(retryStatus) || attempt >= GEMINI_MAX_ATTEMPTS) throw error
      const delayMs = attempt * 1000 + Math.floor(Math.random() * 251)
      if (now() - startedAt + delayMs >= GEMINI_TOTAL_REQUEST_BUDGET_MS) throw error
      console.info(JSON.stringify({
        event: 'gemini_retry', responseStatus: retryStatus, retryNumber: attempt,
        nextAttemptNumber: attempt + 1, retryDelayMs: delayMs,
        reason: timedOut ? 'timeout' : 'http_error',
        responseDurationMs: Math.round(now() - startedAt),
      }))
      onRetry(attempt, retryStatus)
      await wait(delayMs)
    }
  }
  throw new Error('Gemini attempts exhausted.')
}

function safeGeminiError(error: unknown): AnalysisError {
  const status = geminiHttpStatus(error)
  if (status === 429) {
    return new AnalysisError(429, 'rate_limit', 'The analysis service is busy. Please wait a moment and try again.')
  }
  if (status === 401 || status === 402 || status === 403) {
    return new AnalysisError(503, 'configuration_error', 'The analysis service is not configured correctly. Please contact the site owner.')
  }
  if (isGeminiTimeout(error) || status === 408 || status === 504) {
    return new AnalysisError(504, 'temporary_service_issue', 'The analysis took too long. Please try again.')
  }
  if (status === 503) {
    return new AnalysisError(503, 'temporary_service_issue', 'The analysis service is temporarily unavailable. Please try again shortly.')
  }
  return new AnalysisError(502, 'temporary_service_issue', 'The analysis service is temporarily unavailable. Please try again shortly.')
}

export async function analyzeJobDescription(
  jobDescription: string,
  onRetry?: GeminiRetryListener,
): Promise<InterviewPrepAnalysis> {
  const startedAt = performance.now()
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new AnalysisError(503, 'configuration_error', 'Interview prep is not configured. Please contact the site owner.')
  }

  const client = new GoogleGenAI({ apiKey })
  let interaction: Awaited<ReturnType<typeof client.interactions.create>>
  try {
    interaction = await retryGeminiRequest(
      (timeoutMs) => client.interactions.create({
        model: 'gemini-3.5-flash-lite',
        system_instruction: interviewPrepPrompt,
        input: jobDescription,
        store: false,
        response_format: [{
          type: 'text', mime_type: 'application/json',
          schema: z.toJSONSchema(interviewPrepSchema),
        }],
        generation_config: { max_output_tokens: 7000 },
      }, { timeout: timeoutMs, maxRetries: 0 }),
      onRetry,
    )
  } catch (error) {
    throw safeGeminiError(error)
  }

  if (interaction.status !== 'completed' || !interaction.output_text) {
    throw new AnalysisError(502, 'temporary_service_issue', 'The analysis was incomplete. Please try again.')
  }
  let output: unknown
  try {
    output = JSON.parse(interaction.output_text)
  } catch {
    throw new AnalysisError(502, 'temporary_service_issue', 'The analysis response could not be read. Please try again.')
  }
  const result = interviewPrepSchema.safeParse(output)
  if (!result.success) {
    throw new AnalysisError(502, 'temporary_service_issue', 'The analysis response could not be validated. Please try again.')
  }
  console.info(JSON.stringify({
    event: 'gemini_success', responseStatus: 200,
    responseDurationMs: Math.round(performance.now() - startedAt),
  }))
  return result.data
}
