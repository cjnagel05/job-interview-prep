import { useEffect, useRef, useState } from 'react'
import type { InterviewFeedback } from '@/lib/interview-feedback-schema'
import { PracticeFeedbackClientError, requestPracticeFeedback } from '@/lib/practice-feedback-client'
import { practiceFeedbackErrorMessages, type PracticeFeedbackContext } from '@/lib/practice-feedback-contract'

const progressMessages = [
  'Reviewing your response...',
  'Checking how well it answered the question...',
  'Preparing feedback...',
]

export function usePracticeFeedback() {
  const [feedback, setFeedback] = useState<InterviewFeedback | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const requestId = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearRequest() {
    if (progressTimer.current !== null) clearInterval(progressTimer.current)
    if (timeout.current !== null) clearTimeout(timeout.current)
    progressTimer.current = null
    timeout.current = null
    controller.current?.abort()
    controller.current = null
  }

  useEffect(() => {
    function cancel() {
      requestId.current += 1
      clearRequest()
    }
    function handlePageHide() {
      cancel()
      setFeedback(null)
      setError('')
      setIsLoading(false)
    }
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      cancel()
    }
  }, [])

  function reset() {
    requestId.current += 1
    clearRequest()
    setFeedback(null)
    setError('')
    setIsLoading(false)
  }

  async function getFeedback(audio: Blob | null, context: PracticeFeedbackContext) {
    if (controller.current) return
    const id = ++requestId.current
    const abort = new AbortController()
    controller.current = abort
    setIsLoading(true)
    setFeedback(null)
    setError('')
    setProgress(0)
    let stage = 0
    progressTimer.current = setInterval(() => {
      stage = Math.min(stage + 1, progressMessages.length - 1)
      setProgress(stage)
    }, 10000)
    timeout.current = setTimeout(() => abort.abort(), 75000)
    try {
      const result = await requestPracticeFeedback(audio, context, abort.signal)
      if (id === requestId.current) setFeedback(result)
    } catch (cause) {
      if (id !== requestId.current) return
      setError(cause instanceof PracticeFeedbackClientError ? cause.message
        : abort.signal.aborted ? practiceFeedbackErrorMessages.temporary_service_issue
        : 'We could not reach the feedback service. Check your connection and try again.')
    } finally {
      if (id === requestId.current) {
        clearRequest()
        setIsLoading(false)
      }
    }
  }

  return { feedback, isLoading, progressText: progressMessages[progress], error, getFeedback, reset }
}
