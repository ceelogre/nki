"use client";

import styles from "./copy-button.module.css";

type CopyButtonProps = {
  content: string;
};

export default function CopyButton({ content }: CopyButtonProps) {
  return (
    <button className={styles.button} type="button" onClick={async () => {
      await navigator.clipboard.writeText(content);
    }}>
      Copy to clipboard
    </button>
  );
}
