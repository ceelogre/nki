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
        <pre className={styles.content}>{paste.content}</pre>
        <Link href="/" className={styles.back}>
          Create another paste
        </Link>
      </main>
    </div>
  );
}
