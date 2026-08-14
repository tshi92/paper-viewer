"use client";

import { useRouter } from "next/navigation";
import { useRef, type MouseEvent, type ReactNode } from "react";

/**
 * How long to give the client-side router before falling back to a real
 * navigation. Successful soft navigations here land in ~90ms and have never
 * been seen past ~300ms, so this is slack, not a race.
 */
const COMMIT_DEADLINE_MS = 600;

/**
 * A link that changes only the current route's search params — a conference
 * program chip, a "clear filters" link, a pager step.
 *
 * `next/link` alone is not dependable for these: in production builds this
 * route drops roughly a quarter of same-pathname navigations outright — the
 * click is swallowed, no request is made, the URL never changes, and clicking
 * again is the only way out. (Development never shows it, because Next only
 * prefetches in production.) Full navigation always lands but costs ~340ms and
 * a page flash.
 *
 * So: try the soft navigation, and if the URL has not moved by the deadline,
 * do the full one. Fast when the router behaves, never a lost click when it
 * does not.
 */
export function FilterLink({
  href,
  className,
  ariaCurrent,
  children
}: {
  href: string;
  className?: string;
  ariaCurrent?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  // The most recent click's target: a second click before the first deadline
  // must not be overridden by the earlier one's fallback.
  const latestHref = useRef<string | null>(null);

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    // Modified clicks mean "open somewhere else"; leave them to the browser.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    latestHref.current = href;
    router.push(href);

    // The test is "did anything move", not "did we reach exactly this href":
    // by the deadline the user may legitimately have navigated on again (typed
    // a search, clicked another chip), and forcing this href then would undo
    // their next action.
    const before = window.location.pathname + window.location.search;
    window.setTimeout(() => {
      if (latestHref.current !== href) return;
      if (window.location.pathname + window.location.search === before) {
        window.location.assign(href);
      }
    }, COMMIT_DEADLINE_MS);
  }

  return (
    <a href={href} aria-current={ariaCurrent ? "true" : undefined} className={className} onClick={onClick}>
      {children}
    </a>
  );
}
