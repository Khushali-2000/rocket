import { AiAssistantSection } from '@/components/AiAssistantSection';
import { BenchmarkSection } from '@/components/BenchmarkSection';
import { ContractsSection } from '@/components/ContractsSection';
import { FeatureGrid } from '@/components/FeatureGrid';
import { FinalCta } from '@/components/FinalCta';
import { FlowSection } from '@/components/FlowSection';
import { Footer } from '@/components/Footer';
import { Hero } from '@/components/Hero';
import { LoadTestingSection } from '@/components/LoadTestingSection';
import { LocalFirstSection } from '@/components/LocalFirstSection';
import { Nav } from '@/components/Nav';
import { OpenApiSyncSection } from '@/components/OpenApiSyncSection';
import { ProofStrip } from '@/components/ProofStrip';
import { SecuritySection } from '@/components/SecuritySection';

function App() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-60 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:font-heading focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <Nav />

      <main id="main">
        <Hero />
        <ProofStrip />
        <FeatureGrid />
        <AiAssistantSection />
        <FlowSection />
        <BenchmarkSection />
        <SecuritySection />
        <OpenApiSyncSection />
        <ContractsSection />
        <LoadTestingSection />
        <LocalFirstSection />
        <FinalCta />
      </main>

      <Footer />
    </>
  );
}

export default App;
