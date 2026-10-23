import { Suspense } from 'react';
import { AIView } from '@/components/brain/ai/AIView';

export default function BrainAIPage() {
  // useSearchParams (the tab) needs a Suspense boundary for static rendering.
  return (
    <Suspense>
      <AIView />
    </Suspense>
  );
}
