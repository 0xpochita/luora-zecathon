"use client";

import { useState } from "react";
import type { Network } from "@contract/types";
import { Check as CheckIcon, GithubLogo, Link as LinkIcon } from "@phosphor-icons/react";
import { buildIssueMarkdown, LIBRUSTZCASH_REV, type IssueSubject } from "@/lib/issue";
import { buildShareLink, MAX_FRAGMENT_CHARS, type ShareSource } from "@/lib/share-link";
import { formatInt } from "@/lib/format";
import { Button, Drawer, Dot, Hint, Inner } from "./ui";

function useCopied(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  return [
    copied,
    (key, text) => {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopied(key);
          setTimeout(() => setCopied((current) => (current === key ? null : current)), 1400);
        })
        .catch(() => setCopied(null));
    },
  ];
}

export function CopyIssue({
  subject,
  network,
  share,
  zebraCatalog,
}: {
  subject: () => IssueSubject | null;
  network: Network;
  share: ShareSource;
  zebraCatalog: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [includeRaw, setIncludeRaw] = useState(false);
  const [copied, copy] = useCopied();
  const current = open ? subject() : null;
  const base = typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}`;
  const link = buildShareLink(base, share, includeRaw);
  const markdown = current
    ? buildIssueMarkdown(current, {
        network,
        link: link.url,
        versions: { librustzcash: LIBRUSTZCASH_REV, zebraCatalog },
      })
    : "";
  const rawKind = share.kind === "hex" ? "transaction" : share.kind === "pczt" ? "PCZT" : null;

  return (
    <>
      <Button size="xs" variant="secondary" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <GithubLogo />
        Copy as issue
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Copy as GitHub issue">
        {current && (
          <div className="flex flex-col gap-3 text-[13px]">
            <Hint>
              Markdown for a bug report: what Luora found, the rules with their ZIP and source lines, and the decoder versions.
              Read it before posting; a GitHub issue is public.
            </Hint>

            {rawKind && (
              <Inner className="flex flex-col gap-2 px-3 py-2.5">
                <label className="flex items-start gap-2 text-text">
                  <input
                    type="checkbox"
                    checked={includeRaw}
                    onChange={(event) => setIncludeRaw(event.target.checked)}
                    className="mt-[3px] size-3.5 flex-none accent-[#f4f4f5]"
                  />
                  Include the raw {rawKind} in the link
                </label>
                <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-body">
                  <Dot tone="warn" className="mt-[6px]" />
                  <span>
                    Anyone with the link can decode it. Unbroadcast hex shows its transparent addresses and amounts, and posting
                    the issue publishes them. The {rawKind} goes after the <span className="font-mono text-xs">#</span> in the
                    link, a part browsers never send to any server, Luora&apos;s included.
                  </span>
                </p>
                {link.raw === "too-big" && (
                  <p className="flex items-start gap-2 text-[12.5px] text-text">
                    <Dot tone="bad" className="mt-[6px]" />
                    Too big for a link: {formatInt(link.chars)} characters, the limit is {formatInt(MAX_FRAGMENT_CHARS)}. The link
                    below leaves it out; attach the hex to the issue as a file instead.
                  </p>
                )}
              </Inner>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-muted">Preview</span>
              <pre className="max-h-[48vh] overflow-auto rounded-inner border border-border bg-inner-grad p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-text">
                {markdown}
              </pre>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" onClick={() => copy("markdown", markdown)}>
                {copied === "markdown" ? <CheckIcon /> : <GithubLogo />}
                {copied === "markdown" ? "Copied" : "Copy Markdown"}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => copy("link", link.url)}>
                {copied === "link" ? <CheckIcon /> : <LinkIcon />}
                {copied === "link" ? "Copied" : "Copy link"}
              </Button>
              <span className="text-[12.5px] text-dim">
                {link.raw === "query"
                  ? "The link opens this txid."
                  : link.raw === "fragment"
                    ? `The link carries the ${rawKind} after the #.`
                    : rawKind
                      ? `The link opens Luora without the ${rawKind}.`
                      : "The link opens Luora."}
              </span>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
