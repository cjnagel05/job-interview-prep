import { useEffect, useRef, useState } from 'react'

export const MAX_RECORDING_SECONDS = 90
type PracticePhase = 'idle' | 'requesting' | 'countdown' | 'recording' | 'saving' | 'recorded'

function mediaErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone permission was denied. Allow microphone access in your browser’s site settings, then try again.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone was found. Connect a microphone, then try again.'
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'Your microphone could not be started. Check whether another app is using it, then try again.'
  }
  return 'We could not access your microphone. Check your device and browser permissions, then try again.'
}

export function useInterviewPractice() {
  const [phase, setPhase] = useState<PracticePhase>('idle')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [countdown, setCountdown] = useState(3)
  const [seconds, setSeconds] = useState(0)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [error, setError] = useState('')
  const [cameraNotice, setCameraNotice] = useState('')
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const urlRef = useRef<string | null>(null)
  const requestId = useRef(0)
  const busy = useRef(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startedAt = useRef(0)

  function clearTimers() {
    if (timer.current !== null) clearInterval(timer.current)
    if (deadline.current !== null) clearTimeout(deadline.current)
    timer.current = null
    deadline.current = null
  }

  function clearAudio() {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
    setAudioUrl(null)
    setAudioBlob(null)
  }

  function stopRecording() {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    clearTimers()
    setSeconds(Math.min(MAX_RECORDING_SECONDS, Math.floor((performance.now() - startedAt.current) / 1000)))
    setPhase('saving')
    recorder.stop()
  }

  useEffect(() => {
    function releaseMedia() {
      requestId.current += 1
      busy.current = false
      clearTimers()
      const recorder = recorderRef.current
      if (recorder) {
        recorder.ondataavailable = null
        recorder.onstop = null
        recorder.onerror = null
        if (recorder.state !== 'inactive') recorder.stop()
      }
      recorderRef.current = null
      streamRef.current?.getTracks().forEach((track) => {
        track.onended = null
        track.stop()
      })
      streamRef.current = null
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    function handlePageHide() {
      releaseMedia()
      setStream(null)
      setAudioUrl(null)
      setAudioBlob(null)
      setPhase('idle')
      setSeconds(0)
      setError('')
      setCameraNotice('')
    }
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      releaseMedia()
    }
  }, [])

  async function startPractice() {
    if (busy.current) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' ||
        typeof MediaRecorder.isTypeSupported !== 'function') {
      setError('Recording is not supported here. Open this site over HTTPS in a browser that supports camera, microphone, and audio recording.')
      return
    }
    busy.current = true
    const id = ++requestId.current
    setError('')
    clearAudio()
    setSeconds(0)
    setPhase('requesting')
    let media = streamRef.current
    try {
      if (!media?.getAudioTracks().some((track) => track.readyState === 'live')) {
        media?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        setStream(null)
        setCameraNotice('')
        try {
          media = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        } catch {
          if (id !== requestId.current) return
          // A missing, blocked, or busy camera must not prevent microphone practice.
          media = await navigator.mediaDevices.getUserMedia({ video: false, audio: true })
          if (id === requestId.current) {
            setCameraNotice('Camera unavailable or permission denied. You can still practice with audio only.')
          }
        }
        if (id !== requestId.current) {
          media.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = media
        setStream(media)
      }
      const audioTracks = media.getAudioTracks().filter((track) => track.readyState === 'live')
      if (!audioTracks.length) throw new DOMException('No microphone', 'NotFoundError')
      // Only microphone tracks reach MediaRecorder; video remains preview-only.
      const audioStream = new MediaStream(audioTracks)
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/wav',
      ].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = mimeType
        ? new MediaRecorder(audioStream, { mimeType })
        : new MediaRecorder(audioStream)
      recorderRef.current = recorder
      const chunks: Blob[] = []
      let recordingFailed = false
      recorder.ondataavailable = (event) => {
        if (id === requestId.current && event.data.size > 0) chunks.push(event.data)
      }
      recorder.onstop = () => {
        if (id !== requestId.current) return
        clearTimers()
        busy.current = false
        recorderRef.current = null
        if (recordingFailed || !chunks.length) {
          setError('We could not capture your audio. Please try again.')
          setPhase('idle')
          return
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0].type })
        chunks.length = 0
        urlRef.current = URL.createObjectURL(blob)
        setAudioBlob(blob)
        setAudioUrl(urlRef.current)
        setPhase('recorded')
      }
      recorder.onerror = () => {
        if (id !== requestId.current) return
        recordingFailed = true
        clearTimers()
        setError('Audio recording failed. Please try again.')
        if (recorder.state !== 'inactive') {
          setPhase('saving')
          recorder.stop()
        } else {
          busy.current = false
          recorderRef.current = null
          setPhase('idle')
        }
      }
      audioTracks.forEach((track) => {
        track.onended = () => {
          if (id !== requestId.current) return
          setError('Your microphone disconnected. Reconnect it before your next take.')
          if (recorder.state !== 'inactive') stopRecording()
          else {
            clearTimers()
            recorderRef.current = null
            busy.current = false
            setPhase('idle')
          }
        }
      })
      media.getVideoTracks().forEach((track) => {
        track.onended = () => {
          if (id === requestId.current) setCameraNotice('Camera disconnected. You can continue with audio only.')
        }
      })
      setCountdown(3)
      setPhase('countdown')
      const countdownEnd = performance.now() + 3000
      timer.current = setInterval(() => {
        setCountdown(Math.max(1, Math.ceil((countdownEnd - performance.now()) / 1000)))
      }, 100)
      deadline.current = setTimeout(() => {
        clearTimers()
        if (id !== requestId.current) return
        try {
          recorder.start()
          startedAt.current = performance.now()
          setPhase('recording')
          timer.current = setInterval(() => {
            const elapsed = (performance.now() - startedAt.current) / 1000
            setSeconds(Math.min(MAX_RECORDING_SECONDS, Math.floor(elapsed)))
            if (elapsed >= MAX_RECORDING_SECONDS) stopRecording()
          }, 200)
          deadline.current = setTimeout(stopRecording, MAX_RECORDING_SECONDS * 1000)
        } catch {
          busy.current = false
          recorderRef.current = null
          setError('Audio recording could not start. Please try again.')
          setPhase('idle')
        }
      }, 3000)
    } catch (cause) {
      if (id !== requestId.current) return
      clearTimers()
      media?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      setStream(null)
      busy.current = false
      setError(mediaErrorMessage(cause))
      setPhase('idle')
    }
  }

  function stopPreview() {
    streamRef.current?.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })
    streamRef.current = null
    setStream(null)
  }

  function retake() {
    requestId.current += 1
    clearTimers()
    recorderRef.current = null
    busy.current = false
    clearAudio()
    setError('')
    setSeconds(0)
    setPhase('idle')
  }

  return { phase, stream, countdown, seconds, audioUrl, audioBlob, error, cameraNotice, startPractice, stopRecording, stopPreview, retake }
}
