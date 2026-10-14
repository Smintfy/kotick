import { UploadList } from '@/components/UploadList.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';
import { examples } from '@/examples.ts';

export function UploadsPage() {
  return (
    <>
      <PageHeader example={examples.uploads} />
      <UploadList />
    </>
  );
}
