import { z } from 'zod'

const nonEmptyText = z.string().trim().min(1)
const jobDescriptionCue = /\b(?:job|role|position|responsibilit(?:y|ies)|qualifications?|requirements?|experience|skills?|you will|you'll|we are looking|we're looking|candidate|team|duties)\b/i

export const analysisErrorCategorySchema = z.enum([
  'temporary_service_issue',
  'rate_limit',
  'invalid_input',
  'configuration_error',
])

export type AnalysisErrorCategory = z.infer<typeof analysisErrorCategorySchema>

export const jobDescriptionInputSchema = z.object({
  jobDescription: z.string().trim().min(100).max(20000),
}).superRefine(({ jobDescription }, context) => {
  const wordCount = jobDescription.match(/\b[\p{L}\p{N}][\p{L}\p{N}'-]*\b/gu)?.length ?? 0
  if (wordCount < 15 || !jobDescriptionCue.test(jobDescription)) {
    context.addIssue({ code: 'custom', path: ['jobDescription'], message: 'Please provide a full job description with role or hiring details.' })
  }
})

export const interviewPrepSchema = z.object({
  roleTitle: nonEmptyText,
  companyName: nonEmptyText.nullable(),
  summary: nonEmptyText,
  responsibilities: z.array(z.object({
    responsibility: nonEmptyText,
    skills: z.array(nonEmptyText).min(1).max(4),
  })).min(3).max(6),
  keySkills: z.array(nonEmptyText).min(5).max(10),
  questions: z.array(z.object({
    type: z.enum(['behavioral', 'experience', 'technical', 'role-specific']),
    question: nonEmptyText,
    basedOn: nonEmptyText,
    skills: z.array(nonEmptyText).min(1),
    whyItMatters: nonEmptyText,
  })).min(6).max(10),
})

export type InterviewPrepAnalysis = z.infer<typeof interviewPrepSchema>
export type InterviewPrep = InterviewPrepAnalysis
export type InterviewPrepQuestion = InterviewPrepAnalysis['questions'][number]
export type InterviewQuestionType = InterviewPrepQuestion['type']