import { useEffect, useRef } from 'react'
import { Camera, LoaderCircle, Mic, RotateCcw, Square, X } from 'lucide-react'
import { InterviewFeedbackView } from '@/components/interview-feedback-view'
import { usePracticeFeedback } from '@/hooks/use-practice-feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MAX_RECORDING_SECONDS, useInterviewPractice } from '@/hooks/use-interview-practice'
import type { InterviewPrepQuestion } from '@/lib/interview-prep-schema'

const categoryLabels = {
  behavioral: 'Behavioral',
  experience: 'Experience',
  technical: 'Technical',
  'role-specific': 'Role-specific',
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function InterviewPractice({ question, roleTitle, onClose }: {
  question: InterviewPrepQuestion
  roleTitle?: string
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const review = usePracticeFeedback()
  const { feedback, isLoading, progressText, error: feedbackError } = review
  const practice = useInterviewPractice()
  const { phase, stream, countdown, seconds, audioUrl, audioBlob, error, cameraNotice } = practice
  const hasCamera = Boolean(stream?.getVideoTracks().some((track) => track.readyState === 'live')) && !cameraNotice
  const status = phase === 'requesting' ? 'Waiting for camera and microphone permission…'
    : phase === 'countdown' ? `Recording starts in ${countdown}…`
    : phase === 'recording' ? 'Recording your answer'
    : phase === 'saving' ? 'Preparing your audio…'
    : phase === 'recorded' ? 'Your answer is ready to replay'
    : 'Take a breath. Start when you’re ready.'

  useEffect(() => {
    const dialog = dialogRef.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    dialog?.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog?.close()
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (video) video.srcObject = stream
    return () => {
      if (video) video.srcObject = null
    }
  }, [stream, hasCamera, feedback])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="practice-title"
      aria-describedby="practice-description"
      onCancel={(event) => { event.preventDefault(); onClose() }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto rounded-2xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-foreground/40"
    >
      <div className="flex items-center justify-between gap-4 border-b bg-white px-5 py-4 sm:px-7">
        <div>
          <p className="eyebrow">Interview practice</p>
          <h2 id="practice-title" className="mt-1 text-lg font-semibold">Make your answer feel natural</h2>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Close practice" onClick={onClose} autoFocus>
          <X className="size-5" aria-hidden="true" />
        </Button>
      </div>
      <div className="space-y-5 p-5 sm:p-7">
        <p id="practice-description" className="text-sm leading-6 text-muted-foreground">
          Practice for up to 90 seconds. Your camera is for a live preview; only your audio is recorded.
          When you choose Get Feedback, your audio and question context are sent to Google Gemini for review. Video is never sent.
        </p>
        <section className="rounded-xl border bg-white p-5" aria-label="Question context">
          <Badge variant="outline" className="rounded-md text-primary">{categoryLabels[question.type]}</Badge>
          <h3 className="mt-3 text-lg font-medium leading-7">{question.question}</h3>
          <p className="mt-4 text-xs font-semibold">Skills being evaluated</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {question.skills.map((skill) => <Badge key={skill} variant="outline" className="rounded-md bg-background font-normal text-muted-foreground">{skill}</Badge>)}
          </div>
          <p className="mt-4 text-xs font-semibold">Responsibility behind this question</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{question.basedOn}</p>
        </section>
        {feedback ? <InterviewFeedbackView feedback={feedback} onPracticeAgain={() => {
          review.reset()
          practice.retake()
          requestAnimationFrame(() => {
            dialogRef.current?.querySelector<HTMLButtonElement>('[data-start-practice]')?.focus()
          })
        }} /> : <>
          <div className="grid gap-5 md:grid-cols-[1.25fr_1fr]">
            <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border bg-[#eaf2ed]">
              {hasCamera ? (
                <video ref={videoRef} autoPlay muted playsInline aria-label="Live camera preview" className="absolute inset-0 size-full -scale-x-100 object-cover" />
              ) : (
                <div className="px-5 text-center text-muted-foreground">
                  {stream ? <Mic className="mx-auto size-7 text-primary" aria-hidden="true" /> : <Camera className="mx-auto size-7 text-primary" aria-hidden="true" />}
                  <p className="mt-3 text-sm font-medium">{stream ? 'Audio-only practice' : 'Your interview space'}</p>
                  <p className="mt-1 text-xs leading-5">{stream ? 'Your microphone is ready.' : 'Camera preview appears when you start.'}</p>
                </div>
              )}
              {hasCamera && <span className="absolute bottom-3 left-3 rounded-md bg-white/90 px-2 py-1 text-xs text-primary">Live preview · never recorded</span>}
              {phase === 'countdown' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90">
                  <span className="text-5xl font-semibold tabular-nums text-primary" aria-hidden="true">{countdown}</span>
                  <span className="mt-3 text-sm text-muted-foreground">Get comfortable. You’ve got this.</span>
                </div>
              )}
            </div>
            <div className="flex flex-col justify-center rounded-xl border bg-white p-5">
              <p role="status" className="text-sm font-medium leading-6">{status}</p>
              <div className="mt-4 flex items-baseline gap-2">
                {phase === 'recording' && <span className="size-2 rounded-full bg-primary" aria-hidden="true" />}
                <span className="text-3xl font-semibold tabular-nums text-primary" role="timer" aria-label="Recording time">{formatTime(seconds)}</span>
                <span className="text-sm text-muted-foreground">/ {formatTime(MAX_RECORDING_SECONDS)}</span>
              </div>
              <progress max={MAX_RECORDING_SECONDS} value={seconds} aria-label="Recording progress" className="mt-3 h-1.5 w-full accent-primary" />
              <div className="mt-5 flex flex-wrap gap-2">
                {phase === 'idle' && <Button data-start-practice type="button" onClick={() => { review.reset(); void practice.startPractice() }} className="h-10 px-4"><Mic aria-hidden="true" />Start Practice</Button>}
                {phase === 'requesting' && <Button type="button" disabled className="h-10 px-4">Connecting…</Button>}
                {phase === 'countdown' && <Button type="button" variant="outline" onClick={practice.retake} className="h-10 px-4">Cancel countdown</Button>}
                {phase === 'recording' && <Button type="button" onClick={practice.stopRecording} className="h-10 px-4"><Square aria-hidden="true" />Stop Recording</Button>}
                {phase === 'saving' && <Button type="button" disabled className="h-10 px-4">Preparing audio…</Button>}
                {phase === 'recorded' && <>
                  <Button type="button" variant="outline" disabled={isLoading} onClick={() => { review.reset(); practice.retake() }} className="h-10 px-4"><RotateCcw aria-hidden="true" />Retake</Button>
                  <Button type="button" disabled={isLoading} onClick={() => {
                    practice.stopPreview()
                    void review.getFeedback(audioBlob, { question: question.question, questionType: question.type, responsibility: question.basedOn, skills: question.skills, roleTitle })
                  }} className="h-10 px-4">{isLoading && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}{isLoading ? 'Reviewing…' : 'Get Feedback'}</Button>
                </>}
              </div>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">Recording starts automatically after a 3-second countdown and stops at 90 seconds.</p>
            </div>
          </div>
          {isLoading && <p role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-primary">{progressText}</p>}
          {feedbackError && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">{feedbackError}</p>}
          {cameraNotice && <p role="status" className="rounded-lg border bg-white p-3 text-sm leading-6 text-muted-foreground">{cameraNotice}</p>}
          {error && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">{error}</p>}
          {audioUrl && <section className="rounded-xl border bg-white p-5" aria-label="Recorded answer">
            <h3 className="text-sm font-semibold">Replay your answer</h3>
            <audio controls src={audioUrl} className="mt-3 w-full" aria-label="Replay recorded audio" />
          </section>}
        </>}
      </div>
    </dialog>
  )
}
