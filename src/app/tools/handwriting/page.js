import HandwritingStudio from '@/features/handwriting/HandwritingStudio';

export const metadata = {
  title: 'Handwriting ✦ Tony',
  description: 'Type a line and watch it get handwritten, one pen stroke at a time.',
};

export default function HandwritingPage() {
  return <HandwritingStudio />;
}
