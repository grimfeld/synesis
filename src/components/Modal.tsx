import type { ReactNode } from "react";

export function Modal({ title, children, onClose, wide }: { title?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-lg"} rounded-xl border p-5 shadow-2xl`} style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
        {title && <div className="mb-3 text-lg font-semibold">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <div className="panel-title mb-1">{label}</div>
      {children}
    </label>
  );
}
