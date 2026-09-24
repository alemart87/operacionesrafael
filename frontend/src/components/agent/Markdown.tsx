"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Render de markdown con estilos de marca (negritas, listas, tablas, código). */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md-body text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-brand-ink">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="leading-snug">{children}</li>,
          h1: ({ children }) => <h1 className="font-display text-base text-brand-ink uppercase mt-1 mb-1.5">{children}</h1>,
          h2: ({ children }) => <h2 className="font-semibold text-brand-ink mt-2 mb-1">{children}</h2>,
          h3: ({ children }) => <h3 className="font-semibold text-brand-graphite mt-2 mb-1">{children}</h3>,
          code: ({ children }) => <code className="bg-black/5 rounded px-1 py-0.5 text-[0.85em] font-mono">{children}</code>,
          a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-brand-cyan underline">{children}</a>,
          table: ({ children }) => <div className="overflow-x-auto my-2"><table className="text-xs border border-brand-border">{children}</table></div>,
          th: ({ children }) => <th className="border border-brand-border px-2 py-1 bg-brand-bg text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="border border-brand-border px-2 py-1">{children}</td>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-brand-cyan pl-3 italic text-brand-slate my-2">{children}</blockquote>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
