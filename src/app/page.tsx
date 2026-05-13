"use client";

import { createClient } from "@supabase/supabase-js";
import { FormEvent, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { PASTE_MAX_MEDIA_BYTES, PASTE_MAX_TEXT_CHARS } from "@/lib/pasteLimits";
import { resolveMediaMimeFromFile } from "@/lib/pasteMime";
import styles from "./page.module.css";

export default function Home() {
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

    const trimmed = content.trim();
    if (!file && !trimmed) {
      setIsSubmitting(false);
      setError("Add text or choose a photo or video.");
      return;
    }

    if (file && file.size > PASTE_MAX_MEDIA_BYTES) {
      setIsSubmitting(false);
      setError(`Files must be ${PASTE_MAX_MEDIA_BYTES / (1024 * 1024)}MB or smaller.`);
      return;
    }

    try {
      if (file) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!supabaseUrl || !supabaseAnonKey) {
          setError(
            "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY for media upload.",
          );
          return;
        }

        let mime: string;
        try {
          mime = resolveMediaMimeFromFile(file);
        } catch {
          setError(
            "Unsupported file type. Use JPEG, PNG, GIF, WebP, AVIF, MP4, WebM, or MOV.",
          );
          return;
        }

        const prepareRes = await fetch("/api/pastes/media/prepare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            mimeType: mime,
            size: file.size,
          }),
        });
        const prep = (await prepareRes.json()) as {
          error?: string;
          id?: string;
          bucket?: string;
          path?: string;
          token?: string;
        };

        if (!prepareRes.ok || !prep.id || !prep.bucket || !prep.path || !prep.token) {
          setError(prep.error ?? "Unable to start upload.");
          return;
        }

        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const { error: uploadError } = await supabase.storage
          .from(prep.bucket)
          .uploadToSignedUrl(prep.path, prep.token, file, {
            contentType: mime,
            upsert: false,
            cacheControl: "3600",
          });

        if (uploadError) {
          setError(uploadError.message || "Upload to storage failed.");
          return;
        }

        let lastError = "Unable to finalize upload.";
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const completeRes = await fetch("/api/pastes/media/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: prep.id }),
          });
          const done = (await completeRes.json()) as { id?: string; error?: string };

          if (completeRes.ok && done.id) {
            setSharePath(`/p/${done.id}`);
            setFile(null);
            if (fileInputRef.current) {
              fileInputRef.current.value = "";
            }
            return;
          }

          lastError = done.error ?? lastError;
          const retryable =
            completeRes.status === 400 &&
            typeof done.error === "string" &&
            done.error.includes("not uploaded yet");
          if (retryable && attempt < 7) {
            await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
            continue;
          }
          setError(lastError);
          return;
        }

        setError(lastError);
        return;
      }

      const response = await fetch("/api/pastes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: trimmed }),
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

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.card}>
          <h1>Tiny Paste Bin</h1>
          <p>
            Create a short link for text or a photo/video (up to{" "}
            {PASTE_MAX_MEDIA_BYTES / (1024 * 1024)}MB) that expires in 24 hours. Media uploads
            go straight to storage from your browser.
          </p>

          <form className={styles.form} onSubmit={onSubmit}>
            <label htmlFor="paste-content">Your text</label>
            <textarea
              id="paste-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Paste anything here..."
              maxLength={PASTE_MAX_TEXT_CHARS}
            />
            <label htmlFor="paste-media" className={styles.fileLabel}>
              Photo or video (optional)
            </label>
            <input
              ref={fileInputRef}
              id="paste-media"
              className={styles.fileInput}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,image/avif,video/mp4,video/webm,video/quicktime,.jpg,.jpeg,.png,.gif,.webp,.avif,.mp4,.webm,.mov"
              onChange={(event) => {
                const next = event.target.files?.[0] ?? null;
                setFile(next);
              }}
            />
            {file ? (
              <p className={styles.fileHint}>
                Selected: {file.name} ({(file.size / (1024 * 1024)).toFixed(2)} MB)
              </p>
            ) : (
              <p className={styles.fileHintMuted}>
                JPEG, PNG, GIF, WebP, AVIF, MP4, WebM, or MOV — max{" "}
                {PASTE_MAX_MEDIA_BYTES / (1024 * 1024)}MB.
              </p>
            )}
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Posting..." : "Post"}
            </button>
          </form>

          {error ? <p className={styles.error}>{error}</p> : null}

          {shareUrl ? (
            <div className={styles.result}>
              <div className={styles.linkBox}>
                <p>Share this link:</p>
                <a href={sharePath}>{shareUrl}</a>
              </div>
              <Image
                src={qrUrl}
                alt="QR code for the shared paste URL"
                width={180}
                height={180}
                unoptimized
                className={styles.qr}
              />
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
