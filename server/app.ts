import express, { type ErrorRequestHandler } from 'express'
import path from 'node:path'
import { interviewPrepSchema, jobDescriptionInputSchema, type AnalysisErrorCategory, type InterviewPrepAnalysis } from '../src/lib/interview-prep-schema.js'
import { AnalysisError, analyzeJobDescription, type GeminiRetryListener } from './gemini.js'
import { createInterviewAnalysisCache } from './analysis-cache.js'

// The optional analyzer lets tests exercise the endpoint without spending API credits.
type Analyzer = (jobDescription: string, onRetry?: GeminiRetryListener) => Promise<InterviewPrepAnalysis>
type AppOptions = { serveFrontend?: boolean }

export function createApp(analyze: Analyzer = analyzeJobDescription, options: AppOptions = {}) {
  const app = express()
  const cachedAnalysis = createInterviewAnalysisCache()
  app.disable('x-powered-by')
  app.use('/api', (_request, response, next) => {
    response.set('Cache-Control', 'no-store')
    next()
  })
  app.use(express.json({ limit: '128kb' }))

  app.get('/api/health', (_request, response) => { response.json({ status: 'ok' }) })
  app.post('/api/analyze', async (request, response) => {
    const startedAt = Date.now()
    let retryNumber = 0
    let cacheHit = false
    const logRequest = () => console.info(JSON.stringify({
      event: 'interview_analysis',
      responseStatus: response.statusCode,
      retryNumber,
      cacheHit,
      responseDurationMs: Date.now() - startedAt,
    }))
    const input = jobDescriptionInputSchema.safeParse(request.body)
    if (!input.success) {
      response.status(400).json({
        error: 'Please provide a full job description with role or hiring details (100–20,000 characters).',
        category: 'invalid_input' satisfies AnalysisErrorCategory,
      })
      logRequest()
      return
    }
    try {
      const result = await cachedAnalysis(input.data.jobDescription, async (jobDescription) =>
        interviewPrepSchema.parse(await analyze(jobDescription, (number, status) => {
          retryNumber = number
          console.info(JSON.stringify({ event: 'gemini_retry', responseStatus: status, retryNumber: number }))
        })),
      )
      cacheHit = result.cacheHit
      response.json(result.analysis)
    } catch (error) {
      if (error instanceof AnalysisError) {
        response.status(error.status).json({ error: error.message, category: error.category })
      } else {
        response.status(502).json({ error: 'We could not complete a valid analysis. Please try again.', category: 'temporary_service_issue' })
      }
    } finally {
      logRequest()
    }
  })
  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'API endpoint not found.', category: 'invalid_input' })
  })
  if (options.serveFrontend ?? process.env.NODE_ENV === 'production') {
    // npm starts the service from the project root. Serve only Vite's public build.
    const distDirectory = path.resolve('dist')
    app.use(express.static(distDirectory, { dotfiles: 'deny' }))
    app.get('/{*path}', (request, response, next) => {
      // Missing assets and private files must not receive the React HTML fallback.
      if (request.path.split('/').some((part) => part.startsWith('.')) ||
          path.extname(request.path) || request.path.startsWith('/assets/') ||
          !request.accepts('html')) {
        response.sendStatus(404)
        return
      }
      response.sendFile(path.join(distDirectory, 'index.html'), (error) => {
        if (error) next(error)
      })
    })
  }
  const handleError: ErrorRequestHandler = (error, _request, response, _next) => {
    const tooLarge = error?.type === 'entity.too.large'
    response.status(tooLarge ? 413 : 400).json({
      error: tooLarge ? 'The request is too large. Please shorten the job description.' : 'Please send a valid JSON request.',
      category: 'invalid_input',
    })
  }
  app.use(handleError)
  return app
}
