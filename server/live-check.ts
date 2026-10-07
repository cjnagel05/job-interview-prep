import { interviewPrepSchema } from '../src/lib/interview-prep-schema.ts'

// Explicit opt-in integration check: sends only these fictional postings to Gemini.
// Run after npm run dev. This makes two real API requests and may use API credits.
const samples = [
  {
    name: 'realistic',
    jobDescription: `Example Orchard Software seeks a full-time Frontend Developer in Phoenix, Arizona.
      This hybrid role works in the office two days per week. Annual salary: $85,000–$110,000.
      Responsibilities: build accessible React and TypeScript interfaces, write component tests,
      review pull requests, collaborate with product designers, and troubleshoot performance issues.
      Qualifications: two years of frontend experience, practical CSS and Git knowledge, familiarity
      with REST APIs and automated testing. Benefits include health insurance and paid time off.
      The interview process includes a recruiter conversation and a technical interview.`,
  },
  {
    name: 'suspicious',
    jobDescription: `Urgent remote assistant opening! Earn $8,000 every week for one hour of work a day.
      No experience or interview needed. Employer identity will be revealed after onboarding.
      Contact our recruiter immediately on Telegram. Pay a $250 application processing fee in gift cards.
      We will send you a check to deposit so you can buy equipment from our designated supplier.
      Send any remaining balance back to us using cryptocurrency. Before the interview, send your
      bank account information and a scan of your government ID. Act in the next 30 minutes.`,
  },
]

let failures = 0
const empty = await fetch('http://localhost:5173/api/analyze', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobDescription: '' }),
})
console.log(`Empty submission: HTTP ${empty.status}`)
if (empty.status !== 400) failures += 1
for (const sample of samples) {
  const response = await fetch('http://localhost:5173/api/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobDescription: sample.jobDescription }), signal: AbortSignal.timeout(75000),
  })
  const result = interviewPrepSchema.safeParse(await response.json())
  console.log(`${sample.name}: HTTP ${response.status}; valid structured result: ${result.success}`)
  if (result.success) {
    console.log(JSON.stringify({ roleTitle: result.data.roleTitle, responsibilities: result.data.responsibilities.length, keySkills: result.data.keySkills.length, questions: result.data.questions.length }))
  } else failures += 1
}
process.exitCode = failures ? 1 : 0
