"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./SearchBox.module.css";

// Note search box. The term lives in the URL (q param) so views are
// bookmarkable; typing is debounced before the URL write so the server
// isn't refetched on every keystroke. `others` are the page's other search
// params, preserved across searches.
export default function SearchBox({
  basePath,
  others = {},
  initialQuery = "",
  matched = null,
}: {
  basePath: string;
  others?: Record<string, string>;
  initialQuery?: string;
  matched?: number | null; // match count to show while a term is active
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [value, setValue] = useState(initialQuery);

  // Follow URL changes we didn't type (back/forward), but never fight the
  // user while the input is focused.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setValue(initialQuery);
  }, [initialQuery]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function url(q: string): string {
    const sp = new URLSearchParams(others);
    if (q) sp.set("q", q);
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  function update(q: string, immediate = false) {
    setValue(q);
    if (timer.current) clearTimeout(timer.current);
    if (immediate) router.replace(url(q));
    else timer.current = setTimeout(() => router.replace(url(q)), 400);
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.box}>
        <input
          ref={inputRef}
          type="search"
          className={styles.input}
          placeholder="Search"
          aria-label="Search"
          value={value}
          onChange={(e) => update(e.target.value)}
        />
        {value && (
          <button
            type="button"
            className={styles.clear}
            aria-label="Clear search"
            onClick={() => update("", true)}
          >
            ×
          </button>
        )}
      </div>
      {value && matched != null && (
        <p className={styles.count}>
          {matched === 0
            ? "No entries match"
            : `${matched} ${matched === 1 ? "entry matches" : "entries match"}`}
        </p>
      )}
    </div>
  );
}
