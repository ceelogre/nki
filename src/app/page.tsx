"use client";

import { FormEvent, useMemo, useState } from "react";
import Image from "next/image";
import styles from "./page.module.css";

export default function Home() {
  const [content, setContent] = useState("");
  const [sharePath, setSharePath] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const shareUrl = useMemo(() => {
    if (!sharePath || typeof window === "undefined") {
      return "";
    }
    return `${window.location.origin}${sharePath}`;
  }, [sharePath]);

  const qrUrl = useMemo(() => {
    if (!shareUrl) {
      return "";
    }
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(shareUrl)}`;
  }, [shareUrl]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    setSharePath("");

    try {
      const response = await fetch("/api/pastes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      });
      const result = (await response.json()) as { id?: string; error?: string };

      if (!response.ok || !result.id) {
        setError(result.error ?? "Unable to create paste.");
        return;
      }

      setSharePath(`/p/${result.id}`);
    } catch {
      setError("Unable to create paste right now.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyLink() {
    if (!shareUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      setError("Could not copy link.");
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.card}>
          <h1>Tiny Paste Bin</h1>
          <p>Create a short link for text that expires in 24 hours.</p>

          <form className={styles.form} onSubmit={onSubmit}>
            <label htmlFor="paste-content">Your text</label>
            <textarea
              id="paste-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Paste anything here..."
              maxLength={5000}
              required
            />
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Posting..." : "Post"}
            </button>
          </form>

          {error ? <p className={styles.error}>{error}</p> : null}

          {shareUrl ? (
            <div className={styles.result}>
              <p>Share this link:</p>
              <a href={sharePath}>{shareUrl}</a>
              <button type="button" onClick={copyLink}>
                Copy link
              </button>
              <Image
                src={qrUrl}
                alt="QR code for the shared paste URL"
                width={180}
                height={180}
                unoptimized
              />
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
