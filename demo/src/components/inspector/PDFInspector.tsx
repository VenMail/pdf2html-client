import React, { useEffect, useMemo, useState } from 'react';
import RawValueViewer from './RawValueViewer';
import { getObjectShape, imageToDataUrl, invertOps, resolvePdfjsObj } from './pdfjs-utils';
import { PDFiumWrapper } from '../../../../src/core/pdfium-wrapper';

type Backend = 'unpdf-proxy' | 'pdfium';

type PDFJSOperatorListLike = {
  fnArray?: unknown;
  argsArray?: unknown;
};

type PDFJSPageLike = {
  getViewport?: (options: { scale: number }) => { width: number; height: number };
  render?: (options: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => unknown;
  getResources?: () => Promise<unknown>;
  getTextContent?: () => Promise<unknown>;
  getAnnotations?: () => Promise<unknown>;
  getOperatorList?: () => Promise<PDFJSOperatorListLike>;
  objs?: { get?: (...args: unknown[]) => unknown };
};

type PDFJSRenderTaskLike = {
  promise?: Promise<unknown>;
};

type LoadedDoc = {
  backend: Backend;
  fileName: string;
  buffer: ArrayBuffer;
  bytes: Uint8Array;
  pageCount: number;
  metadata: unknown;
  pdfjs: any | null;
  pdfjsDoc: unknown | null;
  pdfiumWrapper: PDFiumWrapper | null;
};

type LoadedPage = {
  pageIndex: number;
  page: any | null;
  viewport: { width: number; height: number } | null;
  textContent: unknown;
  annotations: unknown;
  resources: unknown;
  operatorList: { fnArray: number[]; argsArray: unknown[] } | null;
  decodedOps: Array<{ index: number; fn: number; name: string; args: unknown }>;
  resolvedImages: Array<{ id: string; opIndex: number; opName: string; image: unknown; dataUrl: string | null }>;
  pdfiumImages: Array<{
    index: number;
    object: unknown;
    rendered: unknown;
    renderedDataUrl: string | null;
    raw: unknown;
  }>;
  renderedDataUrl: string | null;
};

type Target = {
  id: string;
  label: string;
  value: unknown;
};

const isLikelyPdfjsImageOp = (name: string): boolean => {
  const n = name.toLowerCase();
  return (
    n.includes('paintimage') ||
    n.includes('paintjpeg') ||
    n.includes('paintinlineimage') ||
    n.includes('imagexobject')
  );
};

export default function PDFInspector({ file }: { file: File | null }) {
  const [backend, setBackend] = useState<Backend>('unpdf-proxy');
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [page, setPage] = useState<LoadedPage | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [opLimit, setOpLimit] = useState(200);

  const [loadingDoc, setLoadingDoc] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pdfiumSupported = true;

  const handleRenderPage = async (): Promise<void> => {
    if (!doc || !page?.page) return;

    setRendering(true);
    setError(null);

    try {
      if (doc.backend === 'pdfium') {
        throw new Error('PDFium page rendering is not implemented in the inspector yet');
      }

      if (typeof document === 'undefined') {
        throw new Error('Rendering requires a browser environment');
      }

      const p = page.page;
      if (typeof p.getViewport !== 'function' || typeof p.render !== 'function') {
        throw new Error('PDF.js page.getViewport()/render() not available on this backend');
      }

      const viewport = p.getViewport({ scale: 1 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to create canvas 2D context');
      }

      const renderResult = p.render({ canvasContext: ctx, viewport });
      const maybeTask = renderResult as unknown as PDFJSRenderTaskLike;
      if (maybeTask?.promise && typeof maybeTask.promise.then === 'function') {
        await maybeTask.promise;
      } else if (renderResult && typeof (renderResult as Promise<unknown>).then === 'function') {
        await (renderResult as Promise<unknown>);
      }

      const dataUrl = canvas.toDataURL('image/png');
      setPage((prev) => (prev ? { ...prev, renderedDataUrl: dataUrl } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRendering(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      if (!file) {
        setDoc(null);
        setPage(null);
        setError(null);
        return;
      }

      setLoadingDoc(true);
      setError(null);

      try {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);

        if (backend === 'pdfium') {
          const pdfiumWrapper = new PDFiumWrapper();
          await pdfiumWrapper.initialize();
          await pdfiumWrapper.loadDocument(buffer);
          const pageCount = await pdfiumWrapper.getPageCount();
          const metadata = await pdfiumWrapper.getMetadata();

          if (cancelled) return;
          setDoc({
            backend,
            fileName: file.name,
            buffer,
            bytes,
            pageCount,
            metadata,
            pdfjs: null,
            pdfjsDoc: null,
            pdfiumWrapper
          });
          setPageIndex(0);
          return;
        }

        const unpdf = (await import('unpdf')) as unknown as {
          getDocumentProxy: (bytes: Uint8Array) => Promise<unknown>;
          getResolvedPDFJS: () => Promise<unknown>;
        };
        const { getDocumentProxy, getResolvedPDFJS } = unpdf;
        const pdfjs = (await getResolvedPDFJS()) as unknown as { getDocument?: unknown; OPS?: unknown };

        let pdfjsDoc: unknown;
        if (backend === 'unpdf-proxy') {
          pdfjsDoc = await getDocumentProxy(bytes);
        } else {
          const getDocument = pdfjs.getDocument as (params: unknown) => { promise: Promise<unknown> };
          const task = getDocument({
            data: bytes,
            disableWorker: true
          });
          pdfjsDoc = await task.promise;
        }

        const pageCount = typeof (pdfjsDoc as { numPages?: unknown } | null)?.numPages === 'number' ? (pdfjsDoc as { numPages: number }).numPages : 0;
        const metadata =
          typeof (pdfjsDoc as { getMetadata?: unknown } | null)?.getMetadata === 'function'
            ? await (pdfjsDoc as { getMetadata: () => Promise<unknown> }).getMetadata()
            : null;

        if (cancelled) return;
        setDoc({
          backend,
          fileName: file.name,
          buffer,
          bytes,
          pageCount,
          metadata,
          pdfjs,
          pdfjsDoc,
          pdfiumWrapper: null
        });
        setPageIndex(0);
      } catch (e) {
        if (!cancelled) {
          setDoc(null);
          setPage(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoadingDoc(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [backend, file]);

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      if (!doc) {
        setPage(null);
        return;
      }

      if (doc.pageCount > 0 && (pageIndex < 0 || pageIndex >= doc.pageCount)) {
        setPageIndex(0);
        return;
      }

      setLoadingPage(true);
      try {
        if (doc.backend === 'pdfium') {
          const pdfiumWrapper = doc.pdfiumWrapper;
          if (!pdfiumWrapper) {
            setPage(null);
            return;
          }

          const parsed = await pdfiumWrapper.parsePage(pageIndex, {
            extractText: true,
            extractImages: true,
            extractGraphics: false,
            extractForms: false,
            extractAnnotations: false
          });
          if (cancelled) return;

          const viewport: { width: number; height: number } | null =
            typeof parsed.width === 'number' && typeof parsed.height === 'number'
              ? { width: parsed.width, height: parsed.height }
              : null;

          let textContent: unknown = null;
          textContent = parsed.content.text;

          const resources: unknown = parsed;
          const pdfiumImages: LoadedPage['pdfiumImages'] = parsed.content.images.slice(0, 30).map((img, idx) => ({
            index: idx,
            object: img,
            rendered: img,
            renderedDataUrl: typeof img?.data === 'string' ? img.data : null,
            raw: null
          }));

          setPage({
            pageIndex,
            page: parsed,
            viewport,
            textContent,
            annotations: null,
            resources,
            operatorList: null,
            decodedOps: [],
            resolvedImages: [],
            pdfiumImages,
            renderedDataUrl: null
          });
          return;
        }

        const pdfjsDoc = doc.pdfjsDoc as { getPage?: unknown } | null;
        if (!pdfjsDoc || typeof pdfjsDoc.getPage !== 'function') {
          setPage(null);
          return;
        }

        const p = (await (pdfjsDoc.getPage as (pageNumber: number) => Promise<unknown>)(pageIndex + 1)) as PDFJSPageLike;
        if (cancelled) return;

        const viewport = typeof p?.getViewport === 'function' ? p.getViewport({ scale: 1 }) : null;

        let resources: unknown = null;
        try {
          if (typeof p?.getResources === 'function') {
            resources = await p.getResources();
          }
        } catch {
          resources = null;
        }

        let textContent: unknown = null;
        try {
          if (typeof p?.getTextContent === 'function') {
            textContent = await p.getTextContent();
          }
        } catch {
          textContent = null;
        }

        let annotations: unknown = null;
        try {
          if (typeof p?.getAnnotations === 'function') {
            annotations = await p.getAnnotations();
          }
        } catch {
          annotations = null;
        }

        let operatorList: { fnArray: number[]; argsArray: unknown[] } | null = null;
        let decodedOps: Array<{ index: number; fn: number; name: string; args: unknown }> = [];
        let resolvedImages: Array<{ id: string; opIndex: number; opName: string; image: unknown; dataUrl: string | null }> = [];

        try {
          if (typeof p?.getOperatorList === 'function') {
            const opList = await p.getOperatorList();
            const fnArray = (opList as PDFJSOperatorListLike)?.fnArray as number[];
            const argsArray = (opList as PDFJSOperatorListLike)?.argsArray as unknown[];
            if (Array.isArray(fnArray) && Array.isArray(argsArray)) {
              operatorList = { fnArray, argsArray };

              const inv = invertOps((doc.pdfjs?.OPS || {}) as Record<string, number>);
              const limit = Math.min(fnArray.length, Math.max(0, opLimit));
              decodedOps = [];
              for (let i = 0; i < limit; i++) {
                const fn = fnArray[i];
                decodedOps.push({ index: i, fn, name: inv.get(fn) || String(fn), args: argsArray[i] });
              }

              const wanted: Array<{ id: string; opIndex: number; opName: string; inlineImage?: unknown }> = [];
              const seen = new Set<string>();

              for (const op of decodedOps) {
                const args = op.args;
                if (!Array.isArray(args)) continue;

                const a0 = args[0];
                if (typeof a0 === 'string' && isLikelyPdfjsImageOp(op.name) && !seen.has(a0) && wanted.length < 30) {
                  seen.add(a0);
                  wanted.push({ id: a0, opIndex: op.index, opName: op.name });
                }

                if (op.name.toLowerCase().includes('inline') && a0 && typeof a0 === 'object') {
                  const id = `inline@${op.index}`;
                  if (!seen.has(id) && wanted.length < 30) {
                    seen.add(id);
                    wanted.push({ id, opIndex: op.index, opName: op.name, inlineImage: a0 });
                  }
                }
              }

              resolvedImages = [];
              for (const w of wanted) {
                const image = w.id.startsWith('inline@')
                  ? w.inlineImage
                  : await resolvePdfjsObj(p as unknown as Parameters<typeof resolvePdfjsObj>[0], w.id);
                const dataUrl = imageToDataUrl(doc.pdfjs, image);
                resolvedImages.push({
                  id: w.id,
                  opIndex: w.opIndex,
                  opName: w.opName,
                  image,
                  dataUrl
                });
              }
            }
          }
        } catch {
          operatorList = null;
          decodedOps = [];
          resolvedImages = [];
        }

        setPage({
          pageIndex,
          page: p,
          viewport: viewport && typeof viewport.width === 'number' && typeof viewport.height === 'number' ? viewport : null,
          textContent,
          annotations,
          resources,
          operatorList,
          decodedOps,
          resolvedImages,
          pdfiumImages: [],
          renderedDataUrl: null
        });
      } catch (e) {
        if (!cancelled) {
          setPage(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoadingPage(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [doc, opLimit, pageIndex]);

  const targets = useMemo((): Target[] => {
    const t: Target[] = [];

    if (file) {
      t.push({ id: 'file-info', label: 'File info', value: { name: file.name, size: file.size, type: file.type } });
    }
    if (!doc) return t;

    t.push({ id: 'file-bytes', label: 'File bytes', value: doc.bytes });
    t.push({ id: 'doc', label: 'Document', value: doc.backend === 'pdfium' ? doc.pdfiumWrapper : doc.pdfjsDoc });
    t.push({ id: 'doc-shape', label: 'Document shape', value: getObjectShape(doc.backend === 'pdfium' ? doc.pdfiumWrapper : doc.pdfjsDoc) });
    t.push({ id: 'metadata', label: 'Metadata', value: doc.metadata });

    if (doc.backend !== 'pdfium') {
      t.push({ id: 'pdfjs-module', label: 'PDF.js module', value: doc.pdfjs });
      t.push({ id: 'pdfjs-ops', label: 'PDF.js OPS', value: doc.pdfjs?.OPS || null });
    } else {
      t.push({ id: 'pdfium-wrapper', label: 'PDFium wrapper', value: doc.pdfiumWrapper });
    }

    if (page) {
      t.push({ id: 'page', label: `Page ${page.pageIndex + 1}`, value: page.page });
      t.push({ id: 'page-shape', label: 'Page shape', value: getObjectShape(page.page) });
      t.push({ id: 'viewport', label: 'Viewport', value: page.viewport });
      t.push({ id: 'resources', label: 'Resources', value: page.resources });
      t.push({ id: 'text', label: 'Text content', value: page.textContent });
      t.push({ id: 'annotations', label: 'Annotations', value: page.annotations });

      if (doc.backend !== 'pdfium') {
        t.push({ id: 'operator-list-raw', label: 'Operator list (raw)', value: page.operatorList });
        t.push({ id: 'operator-list-decoded', label: 'Operator list (decoded)', value: page.decodedOps });
        t.push({ id: 'resolved-images', label: 'Resolved images', value: page.resolvedImages });

        for (const img of page.resolvedImages.slice(0, 20)) {
          t.push({ id: `img-preview:${img.id}`, label: `Image ${img.id} (preview)`, value: img.dataUrl });
          t.push({ id: `img-raw:${img.id}`, label: `Image ${img.id} (raw)`, value: img.image });
        }
      } else {
        t.push({ id: 'pdfium-images', label: 'PDFium images', value: page.pdfiumImages });
        for (const img of page.pdfiumImages.slice(0, 20)) {
          t.push({ id: `pdfium-img-preview:${img.index}`, label: `PDFium image #${img.index} (preview)`, value: img.renderedDataUrl });
          t.push({ id: `pdfium-img-raw:${img.index}`, label: `PDFium image #${img.index} (raw)`, value: img.raw });
          t.push({ id: `pdfium-img-obj:${img.index}`, label: `PDFium image #${img.index} (object)`, value: img.object });
          t.push({ id: `pdfium-img-rendered:${img.index}`, label: `PDFium image #${img.index} (rendered)`, value: img.rendered });
        }
      }

      if (page.renderedDataUrl) {
        t.push({ id: 'rendered-page', label: 'Rendered page', value: page.renderedDataUrl });
      }
    }

    return t;
  }, [doc, file, page]);

  useEffect(() => {
    if (!targets.length) {
      setSelectedTargetId(null);
      return;
    }
    if (!selectedTargetId || !targets.some((v) => v.id === selectedTargetId)) {
      setSelectedTargetId(targets[0].id);
    }
  }, [selectedTargetId, targets]);

  const selectedTarget = useMemo(() => {
    if (!selectedTargetId) return null;
    return targets.find((t) => t.id === selectedTargetId) || null;
  }, [selectedTargetId, targets]);

  return (
    <div className="pdf-inspector">
      <div className="pdf-inspector-toolbar">
        <div className="pdf-inspector-toolbar-row">
          <label>
            Backend
            <select
              value={backend}
              onChange={(e) => setBackend(e.target.value as Backend)}
              disabled={!file || loadingDoc}
            >
              <option value="unpdf-proxy">unpdf (proxy)</option>
              <option value="pdfium" disabled={!pdfiumSupported}>
                pdfium
              </option>
            </select>
          </label>

          <label>
            Page
            <input
              type="number"
              value={doc?.pageCount ? pageIndex + 1 : 1}
              min={1}
              max={doc?.pageCount || 1}
              onChange={(e) => setPageIndex(Math.max(0, Number(e.target.value) - 1))}
              disabled={!doc || loadingPage}
            />
            <span className="pdf-inspector-page-count">/ {doc?.pageCount || 0}</span>
          </label>

          <label>
            Ops
            <input
              type="number"
              value={opLimit}
              min={0}
              onChange={(e) => setOpLimit(Math.max(0, Number(e.target.value)))}
              disabled={!doc || doc.backend === 'pdfium' || loadingPage}
            />
          </label>

          <button
            onClick={handleRenderPage}
            disabled={!page?.page || loadingPage || rendering || doc?.backend === 'pdfium'}
          >
            {rendering ? 'Rendering…' : 'Render'}
          </button>
        </div>

        <div className="pdf-inspector-status">
          {loadingDoc ? 'Loading document…' : null}
          {!loadingDoc && loadingPage ? 'Loading page…' : null}
          {!loadingDoc && !loadingPage && doc ? `Loaded (${doc.backend})` : null}
          {!file ? 'Select a PDF to inspect.' : null}
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="pdf-inspector-body">
        <div className="pdf-inspector-targets">
          <select
            value={selectedTargetId || ''}
            onChange={(e) => setSelectedTargetId(e.target.value)}
            disabled={!targets.length}
          >
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="pdf-inspector-viewer">
          {selectedTarget ? (
            <RawValueViewer label={selectedTarget.label} value={selectedTarget.value} />
          ) : (
            <div className="pdf-inspector-empty">No selection</div>
          )}
        </div>
      </div>
    </div>
  );
}

