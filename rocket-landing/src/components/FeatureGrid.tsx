import {
  Braces,
  FileCheck,
  FileCode,
  GitBranch,
  KeyRound,
  ListChecks,
  Network,
  PlayCircle,
  Vault,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Reveal } from '@/components/Reveal';
import { Section, SectionHeader } from '@/components/Section';
import { sections } from '@/lib/site';

interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
  /** Short, literal facts — the part a reader scans for before the prose. */
  tags: string[];
}

const features: Feature[] = [
  {
    icon: Network,
    title: 'Four protocols, one tree',
    body: 'HTTP, GraphQL with schema introspection and subscriptions, gRPC built on tonic and prost, and WebSocket on tokio-tungstenite. All of them live in the same collection, not in separate tools.',
    tags: ['HTTP', 'GraphQL', 'gRPC', 'WebSocket'],
  },
  {
    icon: FileCode,
    title: 'Collections are files',
    body: 'Everything is OpenCollection YAML on disk — readable in an editor, reviewable in a pull request, and sane in a merge. Work across several workspaces with embedded or external collections.',
    tags: ['OpenCollection YAML', 'Multi-workspace'],
  },
  {
    icon: GitBranch,
    title: 'Git, embedded',
    body: 'Staging, commits, branches, merges, push, pull, fetch with force-with-lease, stash, remotes, SSH key discovery and per-file conflict resolution — through libgit2, never by shelling out to the git CLI.',
    tags: ['libgit2', 'Conflict resolution', 'force-with-lease'],
  },
  {
    icon: Braces,
    title: 'Scripts with real types',
    body: 'Pre-request, post-response and test scripts in Monaco with TypeScript IntelliSense for the rok.* API. Share logic through .js files loaded by a local require() that cannot resolve outside the collection directory.',
    tags: ['rok.* API', 'Bruno-compatible', 'Sandboxed require()'],
  },
  {
    icon: ListChecks,
    title: 'Assertions without scripts',
    body: 'A visual assertions builder for the checks that do not need code. Pick the field, pick the condition, done — and the scripted route is still there when a test outgrows the form.',
    tags: ['No-code', 'Per-request'],
  },
  {
    icon: PlayCircle,
    title: 'Collection Runner',
    body: 'Run a whole collection or a single folder in sequence with progress streamed live. Every history entry carries the source it ran from, so you can filter a run apart from a manual click later.',
    tags: ['manual', 'runner', 'load test', 'flow', 'agent'],
  },
  {
    icon: KeyRound,
    title: 'Every auth scheme you will meet',
    body: 'Basic, Bearer, API Key, Digest, NTLM, WSSE, OAuth 1.0 and OAuth 2.0 across client credentials, password, authorization code with PKCE and implicit, plus AWS SigV4, mTLS client certificates and proxies. Folders pass their auth down.',
    tags: ['OAuth 2.0 + PKCE', 'AWS SigV4', 'mTLS'],
  },
  {
    icon: Vault,
    title: 'Environments and vaults',
    body: 'Template anything with {{variable}} and resolve it across every scope. Pull real secrets from RocketVault or Azure Key Vault instead of committing them, and read masked values everywhere they surface.',
    tags: ['RocketVault', 'Azure Key Vault', 'Masked by default'],
  },
  {
    icon: FileCheck,
    title: 'Contract Lock',
    body: 'Attach an SLA or API contract to a collection or folder, watch drift land in a changelog, preview the PDF natively and export the contract as OpenAPI YAML when someone outside the team asks for it.',
    tags: ['Drift changelog', 'OpenAPI export'],
  },
];

export function FeatureGrid() {
  return (
    <Section id={sections.features}>
      <SectionHeader
        eyebrow="features:"
        title="The whole client, not a starting point"
        lede="Rocket ships the parts you would otherwise bolt on — protocols, git, scripting, auth, vaults and contracts — in one native app that keeps its data where you can read it."
      />

      <div className="mt-12 grid grid-cols-1 gap-4 sm:mt-14 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature, index) => (
          <Reveal key={feature.title} delay={(index % 3) * 70}>
            <FeatureCard feature={feature} />
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

function FeatureCard({ feature }: { feature: Feature }) {
  const Icon = feature.icon;

  return (
    <article className="group flex h-full flex-col rounded-xl border border-border bg-card p-6 transition-[border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors duration-200 group-hover:bg-primary/15">
        <Icon className="size-5" aria-hidden="true" />
      </span>

      <h3 className="mt-5 font-heading text-base font-semibold tracking-tight text-card-foreground">
        {feature.title}
      </h3>
      <p className="mt-2.5 flex-1 text-sm leading-relaxed text-muted-foreground">{feature.body}</p>

      <ul className="mt-5 flex flex-wrap gap-1.5">
        {feature.tags.map((tag) => (
          <li
            key={tag}
            className="rounded-md border border-border bg-muted/60 px-2 py-1 font-heading text-[10px] tracking-wide text-muted-foreground"
          >
            {tag}
          </li>
        ))}
      </ul>
    </article>
  );
}
