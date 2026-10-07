import { GoogleGenAI } from '@google/genai'
import { z } from 'zod'
import { interviewPrepSchema, type AnalysisErrorCategory, type InterviewPrepAnalysis } from '../src/lib/interview-prep-schema.js'
import { interviewPrepPrompt } from './prompt.js'

export type GeminiRetryListener = (retryNumber: number, responseStatus: number) => void

export class AnalysisError extends Error {
  constructor(public status: number, public category: AnalysisErrorCategory, message: string) { super(message) }
}

const retryableGeminiStatuses = new Set([408, 429, 500, 502, 503, 504])

export function geminiHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const candidate = error as { status?: unknown; response?: { status?: unknown } }
  if (typeof candidate.status === 'number') return candidate.status
  return typeof candidate.response?.status === 'number' ? candidate.response.status : undefined
}

export async function retryGeminiRequest<T>(
  request: () => Promise<T>,
  onRetry: GeminiRetryListener = () => {},
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<T> {
  for (let retries = 0; ; retries += 1) {
    try {
      return await request()
    } catch (error) {
      const status = geminiHttpStatus(error)
      if (status === undefined || !retryableGeminiStatuses.has(status) || retries >= 2) throw error
      const retryNumber = retries + 1
      onRetry(retryNumber, status)
      await wait(retryNumber * 1000 + Math.floor(Math.random() * 251))
    }
  }
}

function safeGeminiError(error: unknown): AnalysisError {
  const status = geminiHttpStatus(error)
  if (status === 429) {
    return new AnalysisError(429, 'rate_limit', 'The analysis service is busy. Please wait a moment and try again.')
  }
  if (status === 401 || status === 402 || status === 403) {
    return new AnalysisError(503, 'configuration_error', 'The analysis service is not configured correctly. Please contact the site owner.')
  }
  if (status === 408 || status === 504) {
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
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new AnalysisError(503, 'configuration_error', 'Interview prep is not configured. Please contact the site owner.')
  }

  const client = new GoogleGenAI({ apiKey })
  let interaction: Awaited<ReturnType<typeof client.interactions.create>>
  try {
    interaction = await retryGeminiRequest(
      () => client.interactions.create({
        model: 'gemini-3.5-flash-lite',
        system_instruction: interviewPrepPrompt,
        input: jobDescription,
        store: false,
        response_format: [{
          type: 'text', mime_type: 'application/json',
          schema: z.toJSONSchema(interviewPrepSchema),
        }],
        generation_config: { max_output_tokens: 7000 },
      }, { timeout: 20000, maxRetries: 0 }),
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
  return result.data
}
