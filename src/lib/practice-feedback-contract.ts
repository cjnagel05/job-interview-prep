import { z } from 'zod'
import { feedbackQuestionTypeSchema } from './interview-feedback-schema.js'

export const MAX_PRACTICE_AUDIO_BYTES = 3_000_000
// Bound the complete multipart body as well as the individual audio file.
export const MAX_PRACTICE_REQUEST_BYTES = MAX_PRACTICE_AUDIO_BYTES + 32_768

export const practiceFeedbackContextSchema = z.object({
  question: z.string().trim().min(1).max(6000),
  questionType: feedbackQuestionTypeSchema,
  responsibility: z.string().trim().min(1).max(6000),
  skills: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  roleTitle: z.string().trim().min(1).max(300).optional(),
})

export type PracticeFeedbackContext = z.infer<typeof practiceFeedbackContextSchema>
export const practiceFeedbackErrorMessages = {
  recording_too_large: 'This recording is larger than 3 MB. Please record a shorter answer and try again.',
  invalid_audio: 'We could not read this audio recording. Please record a new answer and try again.',
  missing_audio: 'No microphone response was found. Check your microphone and record your answer again.',
  invalid_request: 'The practice request is incomplete or invalid. Please reopen the question and try again.',
  rate_limit: 'The feedback service is busy. Please wait a moment and try again.',
  temporary_service_issue: 'Feedback is temporarily unavailable. Please try again shortly.',
  configuration_error: 'Feedback is not configured correctly. Please contact the site owner.',
} as const

export type PracticeFeedbackErrorCategory = keyof typeof practiceFeedbackErrorMessages
