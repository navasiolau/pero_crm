import type { ReactNode } from "react";

/** Composition only: permissions and mutations stay in the existing sections. */
export function ProductSinglePage({ overview, documents, assembly, installation, works, materials }: {
  overview: ReactNode; documents: ReactNode; assembly: ReactNode; installation: ReactNode;
  works: ReactNode; materials: ReactNode;
}) {
  return <div className="flex min-w-0 max-w-full flex-col gap-4" data-product-single-page>
    {overview}
    <section className="min-w-0 w-full max-w-full space-y-3 rounded-lg border p-4" aria-labelledby="product-engineer-files-heading" data-product-section="documents"><h2 id="product-engineer-files-heading" className="text-lg font-semibold">Файлы от инженера</h2>{documents}</section>
    <div className="min-w-0" data-product-section="assembly">{assembly}</div>
    <div className="min-w-0" data-product-section="installation">{installation}</div>
    <section className="min-w-0 space-y-3" aria-labelledby="product-works-heading" data-product-section="works">
      <h2 id="product-works-heading" className="text-lg font-semibold">Работы и задачи</h2>
      <div className="min-w-0 max-w-full overflow-x-auto">{works}</div>
    </section>
    {materials === null ? null : <section className="min-w-0 space-y-3" aria-labelledby="product-materials-heading" data-product-section="materials">
      <h2 id="product-materials-heading" className="text-lg font-semibold">Материалы</h2>
      <div className="min-w-0 max-w-full overflow-x-auto">{materials}</div>
    </section>}
  </div>;
}
