import type { Metadata } from 'next';
import { PageNotFound } from '@/components/page-not-found';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return <PageNotFound />;
}
