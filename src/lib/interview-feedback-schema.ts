import { z } from 'zod'

const feedbackText = z.string().trim().min(1)
const score = z.number().int().min(1).max(5)

export const feedbackQuestionTypeSchema = z.enum([
  'behavioral', 'experience', 'technical', 'role-specific',
])

export const interviewFeedbackScoresSchema = z.object({
  relevance: score,
  specificity: score,
  clarity: score,
  jobAlignment: score,
})

export const starAssessmentStatusSchema = z.enum(['strong', 'partial', 'missing'])
export const starAssessmentSchema = z.object({
  situation: starAssessmentStatusSchema,
  task: starAssessmentStatusSchema,
  action: starAssessmentStatusSchema,
  result: starAssessmentStatusSchema,
})

const feedbackFields = z.object({
  transcript: z.string(),
  overallFeedback: feedbackText,
  scores: interviewFeedbackScoresSchema,
  strengths: z.array(feedbackText).min(1).max(4),
  improvements: z.array(feedbackText).min(1).max(4),
  nextAttemptFocus: feedbackText,
})

// STAR is optional even for narrative questions: include it only when a
// situation/task/action/result structure is appropriate for that answer.
export const interviewFeedbackSchema = z.discriminatedUnion('questionType', [
  feedbackFields.extend({
    questionType: z.enum(['behavioral', 'experience']),
    star: starAssessmentSchema.optional(),
  }),
  feedbackFields.extend({
    questionType: z.enum(['technical', 'role-specific']),
    star: z.never().optional(),
  }),
])

export type FeedbackQuestionType = z.infer<typeof feedbackQuestionTypeSchema>
export type InterviewFeedback = z.infer<typeof interviewFeedbackSchema>
export type InterviewFeedbackScores = z.infer<typeof interviewFeedbackScoresSchema>
export type StarAssessment = z.infer<typeof starAssessmentSchema>
export type StarAssessmentStatus = z.infer<typeof starAssessmentStatusSchema>

// Public aliases for the interview-practice feedback contract.
export const interviewPracticeFeedbackSchema = interviewFeedbackSchema
export type InterviewPracticeFeedback = InterviewFeedback
