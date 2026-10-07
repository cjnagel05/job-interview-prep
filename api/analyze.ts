import {
  interviewPrepSchema,
  jobDescriptionInputSchema,
  type AnalysisErrorCategory,
  type InterviewPrepAnalysis,
} from '../src/lib/interview-prep-schema.js'
import { createInterviewAnalysisCache } from '../server/analysis-cache.js'
import { AnalysisError, analyzeJobDescription, type GeminiRetryListener } from '../server/gemini.js'

type Analyzer = (jobDescription: string, onRetry?: GeminiRetryListener) => Promise<InterviewPrepAnalysis>

export function createAnalyzeHandler(analyze: Analyzer = analyzeJobDescription) {
  const cachedAnalysis = createInterviewAnalysisCache()

  return async function handleAnalyze(request: Request): Promise<Response> {
    const startedAt = Date.now()
    let retryNumber = 0
    let cacheHit = false
    let status = 200
    const respond = (body: unknown, responseStatus: number) => {
      status = responseStatus
      return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
    }
    const logRequest = () => console.info(JSON.stringify({
      event: 'interview_analysis',
      responseStatus: status,
      retryNumber,
      cacheHit,
      responseDurationMs: Date.now() - startedAt,
    }))

    let body: unknown
    try {
      body = await request.json()
    } catch {
      const response = respond({
        error: 'Please send a valid JSON request.',
        category: 'invalid_input' satisfies AnalysisErrorCategory,
      }, 400)
      logRequest()
      return response
    }

    const input = jobDescriptionInputSchema.safeParse(body)
    if (!input.success) {
      const response = respond({
        error: 'Please provide a full job description with role or hiring details (100–20,000 characters).',
        category: 'invalid_input' satisfies AnalysisErrorCategory,
      }, 400)
      logRequest()
      return response
    }

    try {
      const result = await cachedAnalysis(input.data.jobDescription, async (jobDescription) =>
        interviewPrepSchema.parse(await analyze(jobDescription, (number, responseStatus) => {
          retryNumber = number
          console.info(JSON.stringify({ event: 'gemini_retry', responseStatus, retryNumber: number }))
        })),
      )
      cacheHit = result.cacheHit
      const response = respond(result.analysis, 200)
      logRequest()
      return response
    } catch (error) {
      if (error instanceof AnalysisError) {
        const responseStatus = error.category === 'rate_limit'
          ? 429
          : error.category === 'invalid_input'
            ? 400
            : error.category === 'temporary_service_issue' && error.status === 504
              ? 504
              : 503
        const response = respond({ error: error.message, category: error.category }, responseStatus)
        logRequest()
        return response
      }
      const response = respond({
        error: 'We could not complete a valid analysis. Please try again.',
        category: 'temporary_service_issue' satisfies AnalysisErrorCategory,
      }, 500)
      logRequest()
      return response
    }
  }
}

const handleAnalyze = createAnalyzeHandler()

export async function POST(request: Request): Promise<Response> {
  return handleAnalyze(request)
}