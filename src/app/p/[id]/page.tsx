import Link from "next/link";
import { notFound } from "next/navigation";
import { getPaste, getPasteTtlHours } from "@/lib/pastes";
import styles from "./paste.module.css";

type PastePageProps = {
  params: Promise<{ id: string }>;
};

export default async function PastePage({ params }: PastePageProps) {
  const { id } = await params;
  const paste = await getPaste(id);
  if (!paste) {
    notFound();
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>Shared Paste</h1>
        <p className={styles.meta}>This paste expires in {getPasteTtlHours()} hours.</p>
        {paste.kind === "media" ? (
          <div className={styles.mediaWrap}>
            {paste.mimeType.startsWith("video/") ? (
              <video
                className={styles.media}
                src={`/api/pastes/${paste.id}/media`}
                controls
                preload="metadata"
              >
                Your browser does not support embedded video.
              </video>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- dynamic user uploads from same origin
              <img
                className={styles.media}
                src={`/api/pastes/${paste.id}/media`}
                alt={paste.originalName}
              />
            )}
            <p className={styles.mediaCaption}>{paste.originalName}</p>
          </div>
        ) : (
          <pre className={styles.content}>{paste.content}</pre>
        )}
        <Link href="/" className={styles.back}>
          Create another paste
        </Link>
      </main>
    </div>
  );
}
