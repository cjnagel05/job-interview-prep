import type { Ref } from 'react'
import { BriefcaseBusiness, Check, ClipboardList, MessageCircleQuestion } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { InterviewPrepAnalysis, InterviewQuestionType } from '@/lib/interview-prep-schema'

const questionTypeLabels: Record<InterviewQuestionType, string> = {
  behavioral: 'Behavioral',
  experience: 'Experience',
  technical: 'Technical',
  'role-specific': 'Role-specific',
}

const questionGroups: { title: string; types: InterviewQuestionType[] }[] = [
  { title: 'Behavioral', types: ['behavioral'] },
  { title: 'Experience', types: ['experience'] },
  { title: 'Technical / Role-specific', types: ['technical', 'role-specific'] },
]

export function InterviewPrepResults({ results, headingRef }: { results: InterviewPrepAnalysis; headingRef: Ref<HTMLHeadingElement> }) {
  return (
    <section className="mx-auto mt-16 max-w-5xl scroll-mt-8" aria-labelledby="results-title">
      <div className="mb-7">
        <p className="eyebrow">Sample interview prep</p>
        <h2 id="results-title" ref={headingRef} tabIndex={-1} className="mt-2 text-3xl font-semibold tracking-tight focus:outline-none">Your role, broken down</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">A static example for a {results.roleTitle} role. These results are not based on the text you pasted.</p>
      </div>

      <Card className="rounded-xl bg-white py-6 ring-border">
        <CardContent className="px-6 sm:px-7">
          <div className="flex items-start gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/7 text-primary"><BriefcaseBusiness className="size-5" aria-hidden="true" /></span>
            <div>
              <p className="eyebrow">Role overview</p>
              <h3 className="mt-2 text-xl font-semibold">{results.roleTitle}</h3>
              {results.companyName && <p className="mt-1 text-sm font-medium text-muted-foreground">{results.companyName}</p>}
              <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">{results.summary}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="mt-10" aria-labelledby="responsibilities-title">
        <div className="mb-4 flex items-center gap-2"><ClipboardList className="size-4 text-primary" aria-hidden="true" /><h3 id="responsibilities-title" className="text-lg font-semibold">Top Responsibilities</h3></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {results.responsibilities.map((item, index) => (
            <Card key={item.responsibility} className="rounded-xl py-5 ring-border">
              <CardContent className="px-5">
                <p className="mb-3 text-xs font-semibold tabular-nums text-primary">{String(index + 1).padStart(2, '0')}</p>
                <h4 className="text-sm font-medium leading-6">{item.responsibility}</h4>
                <div className="mt-4 flex flex-wrap gap-2">{item.skills.map((skill) => <Badge key={skill} variant="outline" className="rounded-md bg-[#f7faf8] px-2 py-1 text-xs font-normal text-muted-foreground">{skill}</Badge>)}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-10" aria-labelledby="skills-title">
        <div className="mb-4 flex items-center gap-2"><Check className="size-4 text-primary" aria-hidden="true" /><h3 id="skills-title" className="text-lg font-semibold">Key Skills</h3></div>
        <div className="flex flex-wrap gap-2">{results.keySkills.map((skill) => <Badge key={skill} className="rounded-md bg-[#eaf2ed] px-3 py-1.5 text-xs font-medium text-primary hover:bg-[#eaf2ed]">{skill}</Badge>)}</div>
      </section>

      <section id="questions" className="mt-10 scroll-mt-8" aria-labelledby="questions-title">
        <div className="mb-5 flex items-center gap-2"><MessageCircleQuestion className="size-4 text-primary" aria-hidden="true" /><h3 id="questions-title" className="text-lg font-semibold">Interview Questions</h3></div>
        <div className="space-y-8">
          {questionGroups.map((group) => {
            const groupQuestions = results.questions.filter((question) => group.types.includes(question.type))
            if (groupQuestions.length === 0) return null
            const headingId = `category-${group.title.replace(/[^a-z]+/gi, '-').toLowerCase()}`
            return (
              <section key={group.title} aria-labelledby={headingId}>
                <h4 id={headingId} className="mb-3 text-sm font-semibold text-muted-foreground">{group.title}</h4>
                <div className="grid gap-3">
                  {groupQuestions.map((item) => (
                    <Card key={item.question} className="rounded-xl py-5 ring-border">
                      <CardContent className="px-5 sm:px-6">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <p className="min-w-0 flex-1 text-base font-medium leading-7">{item.question}</p>
                          <Badge variant="outline" className="rounded-md px-2 py-1 text-xs font-normal text-muted-foreground">{questionTypeLabels[item.type]}</Badge>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">{item.skills.map((skill) => <Badge key={skill} variant="outline" className="rounded-md px-2 py-1 text-xs font-normal text-muted-foreground">{skill}</Badge>)}</div>
                        <div className="mt-5 grid gap-4 border-t pt-4 sm:grid-cols-2">
                          <div><p className="text-xs font-semibold text-foreground">Why this matters</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{item.whyItMatters}</p></div>
                          <div><p className="text-xs font-semibold text-foreground">Responsibility behind this question</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{item.basedOn}</p></div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </section>
    </section>
  )
}