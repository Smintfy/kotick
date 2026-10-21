import { useRef, useState } from 'react';
import type { ActorRefFrom } from 'xstate';
import { useActor, useSelector } from 'state-viewer/xstate';
import { formatSize } from '@/lib/format.ts';
import { useRenderStats } from '@/lib/renderStats.ts';
import { uploadMachine, type UploadInput } from '@/machines/upload.ts';

type FileEntry = UploadInput & { id: number };

const initialFiles: FileEntry[] = [
  { id: 1, fileName: 'hero.png', size: 2_400_000 },
  { id: 2, fileName: 'specs.pdf', size: 860_000 },
  { id: 3, fileName: 'walkthrough.mov', size: 48_000_000, failAt: 60 },
];

export function UploadList() {
  const [files, setFiles] = useState(initialFiles);
  const nextId = useRef(initialFiles.length + 1);
  const stats = useRenderStats('uploads');

  function addFile() {
    const id = nextId.current++;
    setFiles((current) => [...current, { id, fileName: `photo-${id}.jpg`, size: 1_200_000 }]);
  }

  function removeFile(id: number) {
    setFiles((current) => current.filter((file) => file.id !== id));
  }

  return (
    <section className="card" aria-label="Uploads">
      <small ref={stats} className="stats" />

      <ul className="uploads">
        {files.map((file) => (
          <UploadRow key={file.id} file={file} onRemove={() => removeFile(file.id)} />
        ))}
      </ul>

      <button type="button" onClick={addFile}>
        Add file
      </button>
    </section>
  );
}

function UploadRow({ file, onRemove }: { file: FileEntry; onRemove: () => void }) {
  const { id, ...input } = file;
  const [snapshot, send, actorRef] = useActor(uploadMachine, { input });
  const stats = useRenderStats(`upload-${id}`);
  const { fileName, size, error } = snapshot.context;

  return (
    <li className="upload">
      <div className="upload-heading">
        <strong>{fileName}</strong>
        <span className="muted">{formatSize(size)}</span>
        <small ref={stats} className="stats" />
      </div>

      <UploadProgress actorRef={actorRef} label={`${fileName} progress`} />

      <div className="actions">
        {snapshot.matches('queued') && (
          <button type="button" onClick={() => send({ type: 'START' })}>
            Start
          </button>
        )}
        {snapshot.matches('uploading') && (
          <button type="button" onClick={() => send({ type: 'CANCEL' })}>
            Cancel
          </button>
        )}
        {snapshot.matches('failed') && (
          <>
            <span role="alert" className="error-text">
              {error ?? 'Upload failed'}
            </span>
            <button type="button" onClick={() => send({ type: 'RETRY' })}>
              Retry
            </button>
          </>
        )}
        {snapshot.matches('done') && <span className="success-text">Uploaded</span>}
        {!snapshot.hasTag('busy') && (
          <button type="button" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

// This component gets the actor of the row from a prop. Child components usually get an actor with this method.
function UploadProgress({ actorRef, label }: { actorRef: ActorRefFrom<typeof uploadMachine>; label: string }) {
  const progress = useSelector(actorRef, (snapshot) => snapshot.context.progress);

  return <progress max={100} value={progress} aria-label={label} />;
}
