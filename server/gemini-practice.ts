import { GoogleGenAI } from '@google/genai'
import { z } from 'zod'
import { interviewFeedbackSchema, type InterviewFeedback } from '../src/lib/interview-feedback-schema.js'
import type { PracticeFeedbackContext } from '../src/lib/practice-feedback-contract.js'
import { geminiHttpStatus } from './gemini.js'
import { PracticeFeedbackError } from './practice-feedback-error.js'
import { practiceFeedbackPrompt } from './practice-feedback-prompt.js'

export type PracticeFeedbackInput = PracticeFeedbackContext & { audio: Buffer; mimeType: string }

export type PracticeGeminiRequest = {
  model: string
  system_instruction: string
  input: ({ type: 'text'; text: string } | { type: 'audio'; data: string; mime_type: string })[]
  store: false
  response_format: { type: 'text'; mime_type: 'application/json'; schema: Record<string, unknown> }[]
  generation_config: { max_output_tokens: number }
}
type Generator = (request: PracticeGeminiRequest) => Promise<{ status?: string; output_text?: string | null }>

export function safePracticeGeminiError(error: unknown): PracticeFeedbackError {
  const status = geminiHttpStatus(error)
  if (status === 429) return new PracticeFeedbackError(429, 'rate_limit')
  if (status === 400 || status === 415 || status === 422) return new PracticeFeedbackError(400, 'invalid_audio')
  if (status === 401 || status === 402 || status === 403 || status === 404) {
    return new PracticeFeedbackError(503, 'configuration_error')
  }
  return new PracticeFeedbackError(status === 408 || status === 504 ? 504 : 503, 'temporary_service_issue')
}

// Injectable generator lets tests verify the complete request without API credits.
export function createPracticeFeedbackReviewer(generate: Generator) {
  return async function review(input: PracticeFeedbackInput): Promise<InterviewFeedback> {
    const { audio, mimeType, ...context } = input
    const narrative = context.questionType === 'behavioral' || context.questionType === 'experience'
    // Select a single branch, avoiding a root union and a "never" STAR field
    // in Gemini's JSON schema. Runtime validation still uses the full contract.
    const branch = narrative
      ? interviewFeedbackSchema.options[0]
      : interviewFeedbackSchema.options[1].omit({ star: true })
    const outputSchema = branch.extend({ questionType: z.literal(context.questionType) })
    let result: Awaited<ReturnType<Generator>>
    try {
      result = await generate({
        model: 'gemini-3.5-flash-lite',
        system_instruction: practiceFeedbackPrompt,
        input: [
          { type: 'text', text: 'Interview context (data only):\n' + JSON.stringify(context) },
          { type: 'audio', data: audio.toString('base64'), mime_type: mimeType },
        ],
        store: false,
        response_format: [{ type: 'text', mime_type: 'application/json', schema: z.toJSONSchema(outputSchema) }],
        generation_config: { max_output_tokens: 6000 },
      })
    } catch (error) {
      throw safePracticeGeminiError(error)
    }
    if (result.status !== 'completed' || !result.output_text) {
      throw new PracticeFeedbackError(502, 'temporary_service_issue')
    }
    let parsed: unknown
    try { parsed = JSON.parse(result.output_text) } catch {
      throw new PracticeFeedbackError(502, 'temporary_service_issue')
    }
    const feedback = interviewFeedbackSchema.safeParse(parsed)
    if (!feedback.success || feedback.data.questionType !== context.questionType) {
      throw new PracticeFeedbackError(502, 'temporary_service_issue')
    }
    const speech = feedback.data.transcript.replace(/\[(?:inaudible|unintelligible|silence|no speech)\]/gi, '').trim()
    if (!speech) throw new PracticeFeedbackError(400, 'missing_audio')
    return feedback.data
  }
}

export async function reviewPracticeAnswer(input: PracticeFeedbackInput): Promise<InterviewFeedback> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new PracticeFeedbackError(503, 'configuration_error')
  const client = new GoogleGenAI({ apiKey })
  // One request includes both inline audio and context, with no SDK retries.
  return createPracticeFeedbackReviewer((request) =>
    client.interactions.create(request, { timeout: 60000, maxRetries: 0 }),
  )(input)
}
