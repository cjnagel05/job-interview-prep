import { createPracticeFeedbackHandler } from '../server/practice-feedback-handler.js'

const handlePracticeFeedback = createPracticeFeedbackHandler()
export async function POST(request: Request): Promise<Response> {
  return handlePracticeFeedback(request)
}
