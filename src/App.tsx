import { ArrowDown, ArrowUpRight, BriefcaseBusiness } from 'lucide-react'
import { AnalysisTool } from '@/components/analysis-tool'
import { HowItWorks } from '@/components/how-it-works'
import { Separator } from '@/components/ui/separator'

function App() {
  return (
    <>
      <a href="#prepare" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-4">
        Skip to interview prep tool
      </a>
      <header className="border-b border-border/70 bg-white">
        <nav aria-label="Main navigation" className="page-width flex min-h-20 flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
          <a href="#" aria-label="Interview Prep home" className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-white">
              <BriefcaseBusiness className="size-5" aria-hidden="true" />
            </span>
            Interview Prep<span className="-ml-2 text-primary">.</span>
          </a>
          <div className="flex items-center gap-5 text-sm font-medium text-muted-foreground sm:gap-8">
            <a className="nav-link" href="#prepare">Prepare</a>
            <a className="nav-link" href="#how-it-works">How It Works</a>
            <a className="nav-link" href="#questions">Questions</a>
          </div>
        </nav>
      </header>

      <main>
        <section className="page-width pb-12 pt-16 text-center sm:pb-14 sm:pt-24" aria-labelledby="hero-title">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-white px-3.5 py-1.5 text-xs font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" />
            Make the job description your interview guide
          </div>
          <h1 id="hero-title" className="mx-auto max-w-3xl text-4xl font-semibold leading-[1.12] tracking-[-0.045em] sm:text-6xl lg:text-[4.25rem]">
            Prepare for the interview they’re actually hiring for.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            Turn a job description into the responsibilities, skills, and questions you should be ready to discuss.
          </p>
          <a href="#prepare" aria-label="Go to interview prep tool" className="mt-8 inline-flex rounded-full p-2 text-muted-foreground transition-colors hover:bg-white hover:text-primary">
            <ArrowDown className="size-4" aria-hidden="true" />
          </a>
        </section>

        <div className="page-width"><AnalysisTool /></div>
        <HowItWorks />

        <section id="disclaimer" className="page-width scroll-mt-8 pb-20" aria-labelledby="disclaimer-title">
          <div className="flex flex-col justify-between gap-6 rounded-2xl border bg-white p-7 sm:flex-row sm:items-center sm:p-10">
            <div className="max-w-2xl">
              <p className="eyebrow">A useful starting point</p>
              <h2 id="disclaimer-title" className="mt-3 text-2xl font-semibold tracking-tight">Prepare with the role in mind.</h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Interview questions are generated from signals in the provided job description and are intended for preparation. Actual interview questions may vary.
              </p>
            </div>
            <a href="#prepare" className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-primary hover:underline">
              Build your prep<ArrowUpRight className="size-4" aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t bg-white py-9">
        <div className="page-width">
          <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
            <span className="flex items-center gap-2 font-semibold"><BriefcaseBusiness className="size-4 text-primary" aria-hidden="true" />Interview Prep</span>
            <span className="text-muted-foreground">Walk in knowing what matters.</span>
          </div>
          <Separator className="my-6" />
          <p className="max-w-4xl text-xs leading-6 text-muted-foreground">
            Interview questions are generated from signals in the provided job description and are intended for preparation. Actual interview questions may vary.
          </p>
        </div>
      </footer>
    </>
  )
}

export default App