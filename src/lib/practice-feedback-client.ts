import { interviewFeedbackSchema, type InterviewFeedback } from './interview-feedback-schema'
import {
  MAX_PRACTICE_AUDIO_BYTES,
  practiceFeedbackContextSchema,
  practiceFeedbackErrorMessages,
  type PracticeFeedbackContext,
  type PracticeFeedbackErrorCategory,
} from './practice-feedback-contract'

export class PracticeFeedbackClientError extends Error {
  constructor(category: PracticeFeedbackErrorCategory) {
    super(practiceFeedbackErrorMessages[category])
  }
}

export async function requestPracticeFeedback(
  audio: Blob | null,
  context: PracticeFeedbackContext,
  signal: AbortSignal,
): Promise<InterviewFeedback> {
  if (!audio?.size) throw new PracticeFeedbackClientError('missing_audio')
  if (audio.size > MAX_PRACTICE_AUDIO_BYTES) throw new PracticeFeedbackClientError('recording_too_large')
  if (!audio.type.toLowerCase().startsWith('audio/')) throw new PracticeFeedbackClientError('invalid_audio')
  const parsed = practiceFeedbackContextSchema.safeParse(context)
  if (!parsed.success) throw new PracticeFeedbackClientError('invalid_request')
  const form = new FormData()
  const extension = audio.type.includes('mp4') ? 'mp4' : audio.type.includes('ogg') ? 'ogg'
    : audio.type.includes('wav') ? 'wav' : 'webm'
  form.append('audio', audio, 'practice-answer.' + extension)
  form.append('question', parsed.data.question)
  form.append('questionType', parsed.data.questionType)
  form.append('responsibility', parsed.data.responsibility)
  form.append('skills', JSON.stringify(parsed.data.skills))
  if (parsed.data.roleTitle) form.append('roleTitle', parsed.data.roleTitle)
  // Let the browser supply the multipart boundary. The only file is the audio Blob.
  const response = await fetch('/api/practice-feedback', { method: 'POST', body: form, signal })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const category = body && typeof body === 'object' && 'category' in body ? body.category : null
    if (typeof category === 'string' && Object.hasOwn(practiceFeedbackErrorMessages, category)) {
      throw new PracticeFeedbackClientError(category as PracticeFeedbackErrorCategory)
    }
    throw new PracticeFeedbackClientError(response.status === 413 ? 'recording_too_large'
      : response.status === 429 ? 'rate_limit' : 'temporary_service_issue')
  }
  const feedback = interviewFeedbackSchema.safeParse(body)
  if (!feedback.success || feedback.data.questionType !== context.questionType) {
    throw new PracticeFeedbackClientError('temporary_service_issue')
  }
  return feedback.data
}
