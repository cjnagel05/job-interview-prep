import { useRef, useState, type FormEvent } from 'react'
import { ArrowRight, FileText, LoaderCircle, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { InterviewPrepResults } from '@/components/interview-prep-results'
import { interviewPrepSchema, type AnalysisErrorCategory, type InterviewPrepAnalysis } from '@/lib/interview-prep-schema'

const maxDescriptionLength = 20000
const errorMessages: Record<AnalysisErrorCategory, string> = {
  temporary_service_issue: 'Interview prep is temporarily unavailable. Please try again shortly.',
  rate_limit: 'The analysis service is busy. Please wait a moment and try again.',
  invalid_input: 'Please check that you pasted a complete job description and try again.',
  configuration_error: 'Interview prep is not configured correctly. Please contact the site owner.',
}

export function AnalysisTool() {
  const [description, setDescription] = useState('')
  const [analysis, setAnalysis] = useState<InterviewPrepAnalysis | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const requestInFlight = useRef(false)
  const resultsHeading = useRef<HTMLHeadingElement>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (requestInFlight.current || !description.trim()) return
    requestInFlight.current = true
    setIsLoading(true)
    setError('')
    setAnalysis(null)
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobDescription: description }),
        signal: AbortSignal.timeout(70000),
      })
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { category?: unknown } | null
        const category = failure?.category
        setError(typeof category === 'string' && Object.hasOwn(errorMessages, category)
          ? errorMessages[category as AnalysisErrorCategory]
          : errorMessages.temporary_service_issue)
        return
      }
      const result = interviewPrepSchema.safeParse(await response.json())
      if (!result.success) {
        setError('We could not read the analysis results. Please try again.')
        return
      }
      setAnalysis(result.data)
      requestAnimationFrame(() => {
        resultsHeading.current?.focus({ preventScroll: true })
        resultsHeading.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      })
    } catch {
      setError('We could not reach the analysis service. Check your connection and try again.')
    } finally {
      requestInFlight.current = false
      setIsLoading(false)
    }
  }

  return (
    <>
      <section id="prepare" className="mx-auto max-w-4xl scroll-mt-8" aria-labelledby="prepare-title">
        <Card className="gap-0 rounded-2xl bg-white py-0 shadow-[0_8px_40px_-16px_rgba(24,55,49,0.18)] ring-border">
          <CardHeader className="gap-0 px-6 pt-7 sm:px-9 sm:pt-9">
            <div className="mb-5 flex items-center justify-between gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/7 text-primary"><FileText className="size-5" aria-hidden="true" /></span>
              <span className="rounded-md border bg-muted/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Start with the job description</span>
            </div>
            <h2 id="prepare-title" className="text-2xl font-semibold tracking-tight">Build your interview prep</h2>
            <p id="demo-note" className="mt-2 text-sm leading-6 text-muted-foreground">
              Add the full description so your preparation can focus on what this role actually asks you to do.
            </p>
          </CardHeader>
          <CardContent className="px-6 pb-7 pt-6 sm:px-9 sm:pb-9">
            <form onSubmit={handleSubmit} aria-busy={isLoading}>
              <div className="mb-2.5 flex items-center justify-between gap-4">
                <label htmlFor="job-description" className="text-sm font-medium">Job description</label>
                <span className="text-xs text-muted-foreground">Required</span>
              </div>
              <Textarea
                id="job-description"
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value)
                  setAnalysis(null)
                  setError('')
                }}
                placeholder="Paste the full job description here..."
                aria-describedby="demo-note character-count analysis-error"
                aria-invalid={Boolean(error)}
                disabled={isLoading}
                maxLength={maxDescriptionLength}
                required
                className="min-h-60 resize-y rounded-xl bg-[#fcfdfc] p-4 text-sm leading-7 shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-primary/15 sm:min-h-64"
              />
              <div id="character-count" className="mt-2 text-right text-xs tabular-nums text-muted-foreground">{description.length.toLocaleString()} / {maxDescriptionLength.toLocaleString()} characters</div>
              <div id="analysis-error" role="alert">{error && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}</div>
              <div className="mt-6 flex flex-col-reverse justify-between gap-5 sm:flex-row sm:items-center">
                <p className="max-w-md text-xs leading-5 text-muted-foreground">
                  Your job description is sent to Google Gemini for analysis and is not saved by this app.
                </p>
                <Button type="submit" disabled={isLoading || !description.trim()} className="h-11 rounded-lg px-5 text-sm shadow-sm">
                  {isLoading ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
                  {isLoading ? 'Building your prep...' : 'Build My Interview Prep'}<ArrowRight className="ml-2 size-4" aria-hidden="true" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </section>
      <p className="sr-only" role="status">{isLoading ? 'Building your interview prep.' : analysis ? 'Interview prep ready.' : ''}</p>
      {analysis && <InterviewPrepResults results={analysis} headingRef={resultsHeading} />}
    </>
  )
}
