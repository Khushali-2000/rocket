import { Check, Eye, Pencil, PlugZap, Play, ScanSearch, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Reveal } from '@/components/Reveal';
import { ScreenshotFrame } from '@/components/ScreenshotFrame';
import { Section, SectionHeader } from '@/components/Section';
import { RocketGroup } from '@/components/illustrations';
import { sections } from '@/lib/site';
import { cn } from '@/lib/utils';

interface Pillar {
  icon: LucideIcon;
  title: string;
  body: string;
}

const pillars: Pillar[] = [
  {
    icon: PlugZap,
    title: 'Bring your own agent',
    body: 'The panel talks to an agent over ACP, the Agent Client Protocol. Point it at Claude, at Gemini, or at any ACP-compatible agent you already run. Credentials come from RocketVault, an environment variable or the OS keychain — there is nowhere to hardcode one.',
  },
  {
    icon: ScanSearch,
    title: 'It reads the real workspace',
    body: 'Rocket exposes an MCP tool server over your own data, so the agent works from your requests, collections, environments, history and test results instead of a pasted snippet. Conversations are stored per workspace with secrets masked.',
  },
  {
    icon: ShieldCheck,
    title: 'Nothing is written until you approve',
    body: 'New requests and folders, script edits, renames, moves, environment variables, folder settings — every one of them arrives as a card you read and accept or reject. There is no path in the product for a blind write.',
  },
];

interface Mode {
  icon: LucideIcon;
  name: string;
  can: string;
}

const modes: Mode[] = [
  { icon: Eye, name: 'Ask', can: 'Reads the workspace. Changes nothing.' },
  { icon: Pencil, name: 'Edit', can: 'Everything Ask does, and may propose changes for approval.' },
  { icon: Play, name: 'Agent', can: 'Everything Edit does, and may also run requests.' },
];

export function AiAssistantSection() {
  return (
    <Section id={sections.assistant} tone="muted">
      <SectionHeader
        eyebrow="ai_assistant:"
        title="An agent in your workspace that proposes, never writes"
        lede="Most API clients bolt a chat box onto the sidebar. Rocket wires an agent into the collection itself — and then puts a review step in front of every change it wants to make."
      />

      <div className="mt-12 grid grid-cols-1 gap-10 sm:mt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start lg:gap-14">
        <div className="space-y-8">
          {pillars.map((pillar, index) => (
            <Reveal key={pillar.title} delay={index * 70}>
              <Pillar pillar={pillar} />
            </Reveal>
          ))}
        </div>

        <Reveal delay={120}>
          <ScreenshotFrame
            src="/screenshots/ai-assistant.png"
            alt="The Rocket AI Assistant panel, showing a proposed change card awaiting approval"
            title="Rocket — assistant"
            illustration={RocketGroup}
            aspect="aspect-4/3"
          />

          <ModeLadder />
        </Reveal>
      </div>
    </Section>
  );
}

function Pillar({ pillar }: { pillar: Pillar }) {
  const Icon = pillar.icon;

  return (
    <div className="flex gap-4">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-primary">
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h3 className="font-heading text-base font-semibold tracking-tight">{pillar.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{pillar.body}</p>
      </div>
    </div>
  );
}

/** Three modes, each strictly a superset of the one above it. */
function ModeLadder() {
  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-6">
      <h3 className="font-heading text-sm font-semibold tracking-tight">
        Three modes, each one step wider
      </h3>

      <ol className="mt-5 space-y-3">
        {modes.map((mode, index) => {
          const Icon = mode.icon;
          return (
            <li
              key={mode.name}
              className="flex items-start gap-3.5 rounded-lg border border-border bg-background p-3.5"
              style={{ marginLeft: `${index * 0.75}rem` }}
            >
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-md',
                  index === 2 ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary',
                )}
              >
                <Icon className="size-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="font-heading text-[13px] font-semibold tracking-tight">{mode.name}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{mode.can}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
        You pick the mode. Nothing escalates on its own.
      </p>
    </div>
  );
}
