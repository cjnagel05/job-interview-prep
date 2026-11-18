import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { InterviewFeedback, StarAssessment, StarAssessmentStatus } from '@/lib/interview-feedback-schema'

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
  'needs-improvement': 'border-amber-200 bg-amber-50 text-amber-900',
  missing: 'border-amber-200 bg-amber-50 text-amber-900',
}

const starStatusLabels: Record<StarAssessmentStatus, string> = {
  strong: 'Strong',
  'needs-improvement': 'Needs improvement',
  missing: 'Missing',
}

function initialRevisions(star: StarAssessment) {
  return {
    situation: star.situation.response ?? '',
    task: star.task.response ?? '',
    action: star.action.response ?? '',
    result: star.result.response ?? '',
  }
}

function StarWorksheet({ star }: { star: StarAssessment }) {
  // Edits belong to this feedback only and disappear when practice resets.
  const [draft, setDraft] = useState(() => ({ source: star, values: initialRevisions(star) }))
  if (draft.source !== star) {
    setDraft({ source: star, values: initialRevisions(star) })
  }
  const preview = Object.values(draft.values).map((value) => value.trim()).filter(Boolean).join('\n\n')

  return (
    <section className="overflow-hidden rounded-2xl border bg-white" aria-labelledby="star-title">
      <div className="p-5">
        <h4 id="star-title" className="text-sm font-semibold">STAR breakdown</h4>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">Review what you said and revise each part. Your edits stay here for this practice session only.</p>
      </div>
      <div className="hidden grid-cols-[0.7fr_1fr_1fr_1.2fr] border-t bg-summary text-xs font-semibold md:grid" aria-hidden="true">
        {['STAR element', 'What you said', 'Feedback', 'Your revised version'].map((label) => <div key={label} className="p-3">{label}</div>)}
      </div>
      {Object.entries(starLabels).map(([key, label]) => {
        const element = key as keyof StarAssessment
        const component = star[element]
        return (
          <div key={key} role="group" aria-labelledby={`star-${key}`} className="grid min-w-0 border-t md:grid-cols-[0.7fr_1fr_1fr_1.2fr] md:divide-x">
            <div className="min-w-0 bg-summary/50 p-3">
              <h5 id={`star-${key}`} className="text-sm font-semibold">{label}</h5>
              <span className={`mt-2 inline-block rounded-md border px-2 py-1 text-xs font-medium ${starStyles[component.status]}`}>{starStatusLabels[component.status]}</span>
            </div>
            <div className="min-w-0 p-3">
              <p className="mb-1 text-xs font-semibold md:sr-only">What you said</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{component.response ?? 'Not clearly included in your response.'}</p>
            </div>
            <div className="min-w-0 p-3">
              <p className="mb-1 text-xs font-semibold md:sr-only">Feedback</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{component.feedback}</p>
            </div>
            <div className="min-w-0 p-3">
              <label htmlFor={`star-revised-${key}`} className="mb-2 block text-xs font-semibold md:sr-only">Your revised {label.toLowerCase()}</label>
              <Textarea id={`star-revised-${key}`} value={draft.values[element]} rows={5}
                placeholder={`Write your ${label.toLowerCase()} here...`}
                onChange={(event) => {
                  const value = event.target.value
                  setDraft((current) => ({ ...current, values: { ...current.values, [element]: value } }))
                }} className="min-h-32 resize-y bg-white" />
            </div>
          </div>
        )
      })}
      <div className="border-t bg-summary/50 p-5">
        <h5 className="text-sm font-semibold">Your Revised STAR Response</h5>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">{preview || 'Write in the fields above to build your revised response.'}</p>
      </div>
    </section>
  )
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
        <StarWorksheet star={feedback.star} />
      )}

      <section className="rounded-2xl border bg-white p-5" aria-labelledby="next-focus-title">
        {feedback.nextAttemptFocus !== null && <>
          <h4 id="next-focus-title" className="text-sm font-semibold text-primary">{improvements.length > 0 ? 'One goal for your next attempt' : 'Keep in mind'}</h4>
          <p className="mt-2 text-sm leading-7">{feedback.nextAttemptFocus}</p>
        </>}
        <Button type="button" onClick={onPracticeAgain} className="mt-4 min-h-11 px-4"><RotateCcw aria-hidden="true" />Practice Again</Button>
      </section>
    </section>
  )
}
