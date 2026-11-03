import {
  ArrowRightLeft,
  GitBranch,
  LogIn,
  LogOut,
  Shuffle,
  Timer,
  KeyRound,
  Link2,
  History,
  Variable,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Reveal } from '@/components/Reveal';
import { ScreenshotFrame } from '@/components/ScreenshotFrame';
import { Section, SectionHeader } from '@/components/Section';
import { RocketOrbit } from '@/components/illustrations';
import { sections } from '@/lib/site';

const nodes: { icon: LucideIcon; name: string }[] = [
  { icon: LogIn, name: 'Input' },
  { icon: GitBranch, name: 'If' },
  { icon: Shuffle, name: 'Switch' },
  { icon: ArrowRightLeft, name: 'Transform' },
  { icon: KeyRound, name: 'Auth' },
  { icon: Timer, name: 'Wait for callback' },
  { icon: LogOut, name: 'Output' },
];

const traits: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: History,
    title: 'Run it whole or run one branch',
    body: 'Execute the entire flow or just the part you are working on, then read the per-step trace. Runs are saved, so last week’s result is still there to compare against.',
  },
  {
    icon: Link2,
    title: 'References repair themselves',
    body: 'Move or rename a request inside a collection and every flow pointing at it is rewritten. Move it across collections or delete it and Rocket reports the break instead of leaving a flow quietly pointing at nothing.',
  },
  {
    icon: Variable,
    title: 'Variables resolved in place',
    body: 'A live preview in the editor resolves {{variable}} across dynamic, process, global, collection, vault and active-environment scope, with secrets shown masked. No guessing what a step will actually send.',
  },
];

export function FlowSection() {
  return (
    <Section id={sections.flow}>
      <SectionHeader
        eyebrow="flow:"
        title="Chain requests on a canvas. Commit the result as YAML."
        lede="Flow wires saved requests into a graph you can run, branch and inspect — and writes it to a plain file inside the collection, so a workflow reviews like any other change."
      />

      <Reveal className="mt-12 sm:mt-14">
        <ScreenshotFrame
          src="/screenshots/flow-run.png"
          alt="A completed Rocket Flow run, with condition, transform and request nodes lit up green and each step's response shown inline"
          title="Rocket — flows / UserList-Workflow"
          illustration={RocketOrbit}
          aspect="aspect-16/10"
        />
      </Reveal>

      <Reveal delay={80} className="mt-10">
        <div className="rounded-xl border border-border bg-card p-6 sm:p-7">
          <h3 className="font-heading text-sm font-semibold tracking-tight">Node types</h3>
          <ul className="mt-4 flex flex-wrap gap-2">
            {nodes.map((node) => {
              const Icon = node.icon;
              return (
                <li
                  key={node.name}
                  className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 font-heading text-xs tracking-tight transition-colors duration-200 hover:border-primary/40 hover:text-primary"
                >
                  <Icon className="size-3.5 text-primary" aria-hidden="true" />
                  {node.name}
                </li>
              );
            })}
          </ul>
          <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
            Plus every request already saved in the collection. Flows are stored as plain YAML
            beside them — diffable, reviewable, and portable to anyone who clones the repo.
          </p>
        </div>
      </Reveal>

      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
        {traits.map((trait, index) => {
          const Icon = trait.icon;
          return (
            <Reveal key={trait.title} delay={index * 70}>
              <div className="h-full rounded-xl border border-border bg-card p-6 transition-[border-color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/40">
                <Icon className="size-5 text-primary" aria-hidden="true" />
                <h3 className="mt-4 font-heading text-base font-semibold tracking-tight">
                  {trait.title}
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{trait.body}</p>
              </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}
