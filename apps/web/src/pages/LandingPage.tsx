import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Reveal } from '../components/Reveal.js';
import { PIPELINE_STAGES } from '../lib/pipeline.js';

const CAPABILITIES: Array<{ title: string; body: string; icon: ReactNode }> = [
  {
    title: 'Match records automatically',
    body: 'Join every fault or event to the account it belongs to, even when an account appears many times.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <circle cx="18" cy="12" r="2.5" />
        <path d="M8.4 7.2 15.6 11M8.4 16.8 15.6 13" />
      </svg>
    ),
  },
  {
    title: 'Latest record, selected consistently',
    body: 'Pick the most recent event with a deterministic, explainable rule — no more eyeballing dates.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 1.8" />
      </svg>
    ),
  },
  {
    title: 'Rules as data, not code',
    body: 'Describe classifications once, version them, and know exactly which rule produced every result.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 7h16M4 12h16M4 17h16" />
        <circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />
        <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
        <circle cx="7" cy="17" r="2" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    title: 'AI only where it helps',
    body: 'An optional assistant proposes outcomes for uncertain cases and never overrides a matched rule.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 4l1.8 4.6L18.5 10l-4.7 1.4L12 16l-1.8-4.6L5.5 10l4.7-1.4L12 4Z" />
        <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
      </svg>
    ),
  },
  {
    title: 'Review only the exceptions',
    body: 'A fast queue shows the unusual rows with the full history side by side, then records the decision.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="4" y="4" width="16" height="16" rx="2.5" />
        <path d="M8 12l2.5 2.5L16 9" />
      </svg>
    ),
  },
  {
    title: 'A reproducible report',
    body: 'Each run freezes the setup and rules it used, so last month’s file always matches last month’s result.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5Z" />
        <path d="M13.5 3.5V8H18M9 13h6M9 16.5h4" />
      </svg>
    ),
  },
];

type FooterLink = { label: string; to?: string; href?: string };

const FOOTER_COLUMNS: Array<{ heading: string; links: FooterLink[] }> = [
  {
    heading: 'Product',
    links: [
      { label: 'Dashboard', to: '/dashboard' },
      { label: 'Datasets', to: '/datasets' },
      { label: 'Runs', to: '/runs' },
      { label: 'Review queue', to: '/review' },
    ],
  },
  {
    heading: 'Workflow',
    links: [
      { label: 'Setup', to: '/setup' },
      { label: 'Rules', to: '/rules' },
      { label: 'Workflow types', to: '/workflows' },
      { label: 'Saved workflows', to: '/saved-workflows' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'How it works', href: '#how-it-works' },
      { label: 'Capabilities', href: '#capabilities' },
      { label: 'Automation', href: '#automation' },
    ],
  },
];

export function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <Link className="landing-brand" to="/">
            <span className="brand-mark" aria-hidden="true">
              SP
            </span>
            <strong>SheetPilot</strong>
          </Link>
          <nav className="landing-links" aria-label="Landing">
            <a href="#how-it-works">How it works</a>
            <a href="#capabilities">Capabilities</a>
            <a href="#automation">Automation</a>
            <span className="landing-nav-actions">
              <Link className="button button-ghost" to="/dashboard">
                Log in
              </Link>
              <Link className="button button-primary button-pill" to="/dashboard">
                Open the app
              </Link>
            </span>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="hero">
          <div className="hero-mesh" aria-hidden="true" />
          <div className="hero-grid" aria-hidden="true" />
          <div className="hero-inner">
            <Reveal as="p" className="hero-eyebrow">
              <span className="hero-eyebrow-dot" aria-hidden="true" />
              Recurring spreadsheet workflows
            </Reveal>
            <Reveal as="h1" className="hero-title" delay={70}>
              Turn a manual spreadsheet chore into a repeatable report.
            </Reveal>
            <Reveal as="p" className="hero-lead" delay={140}>
              Upload the files you already use. SheetPilot matches the records, applies your
              business rules, asks a person to review only the unusual cases, and produces the
              finished Excel file — the same way, every time.
            </Reveal>
            <Reveal className="hero-actions" delay={210}>
              <Link className="button button-primary button-pill" to="/dashboard">
                Open the app
              </Link>
              <Link className="button button-secondary button-pill" to="/datasets">
                Upload a file
              </Link>
            </Reveal>
            <Reveal as="p" className="hero-note" delay={280}>
              Runs locally with your own files. No spreadsheet data leaves the process unless you
              explicitly enable an AI provider.
            </Reveal>
          </div>

          <Reveal className="hero-visual" delay={320}>
            <div className="terminal">
              <div className="terminal-bar">
                <span className="terminal-dot" aria-hidden="true" />
                <span className="terminal-dot" aria-hidden="true" />
                <span className="terminal-dot" aria-hidden="true" />
                <span className="terminal-title">sheetpilot.workflow.yaml</span>
              </div>
              <pre className="terminal-body">
                <span className="tk-com">
                  {'# Describe the job once — SheetPilot replays it exactly.'}
                </span>
                {'\n'}
                <span className="tk-key">workflow</span>
                {': '}
                <span className="tk-str">monthly_fault_report</span>
                {'\n\n'}
                <span className="tk-key">match</span>
                {':\n  '}
                <span className="tk-key">on</span>
                {': account_id\n  '}
                <span className="tk-key">keep</span>
                {': latest(event_date)\n\n'}
                <span className="tk-key">rules</span>
                {':\n  - '}
                <span className="tk-key">when</span>
                {': severity in ["high", "critical"]\n    '}
                <span className="tk-key">classify</span>
                {': escalate\n    '}
                <span className="tk-key">owner</span>
                {': on-call\n\n'}
                <span className="tk-key">review</span>
                {':\n  '}
                <span className="tk-key">when</span>
                {': confidence < 0.9\n\n'}
                <span className="tk-key">report</span>
                {': monthly_fault_report.xlsx'}
              </pre>
            </div>
          </Reveal>
        </section>

        <section className="logo-strip" aria-label="Supported file formats">
          <Reveal as="p" className="mono-eyebrow">
            Built for the files you already use
          </Reveal>
          <div className="logo-row">
            {['XLSX', 'CSV', 'XLS', 'TSV', 'ODS', 'Excel exports', 'UTF-8', 'Delimited'].map(
              (label) => (
                <span className="logo-item" key={label}>
                  {label}
                </span>
              ),
            )}
          </div>
        </section>

        <section className="landing-section" id="capabilities">
          <div className="section-head">
            <Reveal as="p" className="mono-eyebrow">
              Capabilities
            </Reveal>
            <Reveal as="h2" className="section-title" delay={60}>
              What it does for you
            </Reveal>
            <Reveal as="p" className="section-lead" delay={120}>
              Every step is deterministic and explainable. You can see exactly which rule produced
              every row in the finished report.
            </Reveal>
          </div>

          <div className="feature-grid">
            {CAPABILITIES.map((capability, index) => (
              <Reveal
                as="article"
                className="feature-card"
                delay={(index % 3) * 70}
                key={capability.title}
              >
                <span className="feature-icon" aria-hidden="true">
                  {capability.icon}
                </span>
                <h3>{capability.title}</h3>
                <p>{capability.body}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="landing-section" id="how-it-works">
          <div className="section-head">
            <Reveal as="p" className="mono-eyebrow">
              How it works
            </Reveal>
            <Reveal as="h2" className="section-title" delay={60}>
              Five clear steps
            </Reveal>
            <Reveal as="p" className="section-lead" delay={120}>
              You always know where you are, and you can pause and resume at any point.
            </Reveal>
          </div>

          <ol className="steps-grid">
            {PIPELINE_STAGES.map((stage, index) => (
              <Reveal as="li" className="step-card" delay={index * 60} key={stage.key}>
                <span className="step-number">{String(index + 1).padStart(2, '0')}</span>
                <h3>{stage.label}</h3>
                <p>{stage.description}</p>
              </Reveal>
            ))}
          </ol>
        </section>

        <section className="code-band" id="automation">
          <div className="code-copy">
            <Reveal as="p" className="mono-eyebrow">
              Automate the run
            </Reveal>
            <Reveal as="h2" delay={60}>
              A report that runs itself, on your schedule.
            </Reveal>
            <Reveal as="p" delay={120}>
              Save a workflow once and run it again next month with one command. The same inputs and
              rules produce the same file — review returns only when something genuinely needs a
              human decision.
            </Reveal>
          </div>

          <Reveal delay={120}>
            <div className="code-window">
              <div className="terminal-bar">
                <span className="terminal-dot" aria-hidden="true" />
                <span className="terminal-dot" aria-hidden="true" />
                <span className="terminal-dot" aria-hidden="true" />
                <span className="terminal-title">terminal</span>
              </div>
              <pre className="terminal-body">
                <span className="tk-in">{'$ sheetpilot run --workflow monthly_fault_report'}</span>
                {'\n'}
                <span className="tk-com">{'✓'}</span>
                {' loaded 2 files · 18,402 rows\n'}
                <span className="tk-com">{'✓'}</span>
                {' matched 18,391 records to accounts\n'}
                <span className="tk-com">{'✓'}</span>
                {' applied 12 rules · 41 need review\n'}
                <span className="tk-com">{'✓'}</span>
                {' report ready → '}
                <span className="tk-str">monthly_fault_report.xlsx</span>
              </pre>
            </div>
          </Reveal>
        </section>

        <section className="cta-band">
          <div className="cta-inner">
            <Reveal as="h2">Ready to automate today’s report?</Reveal>
            <Reveal as="p" delay={70}>
              Start by uploading the files you already work with. Nothing is changed in place.
            </Reveal>
            <Reveal className="cta-actions" delay={140}>
              <Link className="button button-primary button-pill" to="/dashboard">
                Get started
              </Link>
              <Link className="button button-secondary button-pill" to="/datasets">
                Upload a file
              </Link>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <Link className="landing-brand" to="/">
              <span className="brand-mark" aria-hidden="true">
                SP
              </span>
              <strong>SheetPilot</strong>
            </Link>
            <p>A local-first automation workspace for spreadsheet workflows.</p>
          </div>
          {FOOTER_COLUMNS.map((column) => (
            <div className="footer-col" key={column.heading}>
              <h4>{column.heading}</h4>
              <ul>
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.to ? (
                      <Link to={link.to}>{link.label}</Link>
                    ) : (
                      <a href={link.href}>{link.label}</a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} SheetPilot</span>
          <span className="mono-eyebrow">Local-first · Explainable · Reproducible</span>
        </div>
      </footer>
    </div>
  );
}
