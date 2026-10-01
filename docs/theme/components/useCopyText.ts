import { useEffect, useRef, useState } from 'react';

/** Copies text to the clipboard; `copied` stays true for 1.5s after a copy succeeds. */
export function useCopyText(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = (text: string): void => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  };

  return [copied, copy];
}
