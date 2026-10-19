import { useEffect, useRef } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { InterviewFeedback, StarAssessmentStatus } from '@/lib/interview-feedback-schema'

const scoreLabels = {
  relevance: 'Relevance',
  specificity: 'Specificity',
  clarity: 'Clarity',
  jobAlignment: 'Job alignment',
} as const

const starLabels = {
  situation: 'Situation',
  task: 'Task',
  action: 'Action',
  result: 'Result',
} as const

const starStyles: Record<StarAssessmentStatus, string> = {
  strong: 'border-primary/20 bg-primary/5 text-primary',
  partial: 'border-amber-200 bg-amber-50 text-amber-900',
  missing: 'border-amber-200 bg-amber-50 text-amber-900',
}

export function InterviewFeedbackView({ feedback, onPracticeAgain }: {
  feedback: InterviewFeedback
  onPracticeAgain: () => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const improvements = feedback.improvements.filter((item) => item.trim())

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <section aria-labelledby="feedback-title" className="space-y-5">
      <div className="rounded-2xl border border-summary-border bg-summary p-5 sm:p-6">
        <p className="eyebrow">Practice feedback</p>
        <h3 id="feedback-title" ref={headingRef} tabIndex={-1} className="mt-2 text-xl font-semibold focus:outline-none">Your answer, reviewed</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Feedback on the answer you recorded, in relation to this question and its job context.
          This is practice guidance, not a hiring decision or the employer’s actual interview criteria.
        </p>
      </div>

      <section className="rounded-2xl border bg-white p-5" aria-labelledby="transcript-title">
        <h4 id="transcript-title" className="text-sm font-semibold">Transcript</h4>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{feedback.transcript}</p>
      </section>

      <section className="rounded-2xl border border-summary-border bg-summary p-5" aria-labelledby="overall-feedback-title">
        <h4 id="overall-feedback-title" className="text-sm font-semibold text-primary">Overall feedback</h4>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">{feedback.overallFeedback}</p>
      </section>

      <section aria-labelledby="feedback-scores-title">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h4 id="feedback-scores-title" className="text-sm font-semibold">Scores</h4>
          <p className="text-xs text-muted-foreground">1 = needs work · 5 = strong</p>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(scoreLabels).map(([key, label]) => {
            const value = feedback.scores[key as keyof typeof scoreLabels]
            return <div key={key} className="rounded-2xl border bg-white p-4">
              <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
              <dd className={`mt-2 text-2xl font-semibold tabular-nums ${value >= 4 ? 'text-primary' : 'text-amber-900'}`}>{value}<span className="ml-1 text-sm font-normal text-muted-foreground">/ 5</span></dd>
            </div>
          })}
        </dl>
      </section>

      <div className={`grid gap-5 ${improvements.length > 0 ? 'sm:grid-cols-2' : ''}`}>
        <section className="rounded-2xl border bg-white p-5" aria-labelledby="feedback-strengths-title">
          <h4 id="feedback-strengths-title" className="text-sm font-semibold text-primary">Strengths</h4>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
            {feedback.strengths.map((strength, index) => <li key={index}>{strength}</li>)}
          </ul>
        </section>
        {improvements.length > 0 && <section className="rounded-2xl border bg-white p-5" aria-labelledby="feedback-improvements-title">
          <h4 id="feedback-improvements-title" className="text-sm font-semibold text-amber-900">Areas to improve</h4>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
            {improvements.map((improvement, index) => <li key={index}>{improvement}</li>)}
          </ul>
        </section>}
      </div>

      {feedback.star && (feedback.questionType === 'behavioral' || feedback.questionType === 'experience') && (
        <section className="rounded-2xl border bg-white p-5" aria-labelledby="star-title">
          <h4 id="star-title" className="text-sm font-semibold">STAR assessment</h4>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">How fully your answer explains the situation, task, action, and result.</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries(starLabels).map(([key, label]) => {
              const status = feedback.star![key as keyof typeof starLabels]
              return <div key={key} className="rounded-lg border p-3">
                <dt className="text-xs font-medium">{label}</dt>
                <dd className={`mt-2 inline-block rounded-md border px-2 py-1 text-xs font-medium capitalize ${starStyles[status]}`}>{status}</dd>
              </div>
            })}
          </dl>
        </section>
      )}

      <section className="rounded-2xl border bg-white p-5" aria-labelledby="next-focus-title">
        <h4 id="next-focus-title" className="text-sm font-semibold text-primary">{improvements.length > 0 ? 'One goal for your next attempt' : 'Keep in mind'}</h4>
        <p className="mt-2 text-sm leading-7">{feedback.nextAttemptFocus}</p>
        <Button type="button" onClick={onPracticeAgain} className="mt-4 min-h-11 px-4"><RotateCcw aria-hidden="true" />Practice Again</Button>
      </section>
    </section>
  )
}
