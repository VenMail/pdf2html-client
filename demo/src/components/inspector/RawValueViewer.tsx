import React, { useMemo, useState } from 'react';

type Mode = 'summary' | 'json' | 'text' | 'hex' | 'base64';

type RawValueViewerProps = {
  label?: string;
  value: unknown;
};

const isArrayBuffer = (v: unknown): v is ArrayBuffer =>
  typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer;

const isSharedArrayBuffer = (v: unknown): v is SharedArrayBuffer =>
  typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer;

const isArrayBufferView = (v: unknown): v is ArrayBufferView =>
  typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(v as ArrayBufferView);

const toUint8Array = (value: unknown): Uint8Array | null => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof Uint8ClampedArray) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Int8Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Uint16Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Int16Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Uint32Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Int32Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Float32Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Float64Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof DataView) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (isArrayBuffer(value)) return new Uint8Array(value);
  if (isSharedArrayBuffer(value)) return new Uint8Array(value);
  if (isArrayBufferView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
};

const bytesToHex = (bytes: Uint8Array, limit: number): { content: string; truncated: boolean } => {
  const slice = bytes.length > limit ? bytes.subarray(0, limit) : bytes;
  const truncated = bytes.length > limit;
  const parts: string[] = [];
  for (let i = 0; i < slice.length; i++) {
    const hex = slice[i].toString(16).padStart(2, '0');
    parts.push(hex);
  }
  const grouped: string[] = [];
  for (let i = 0; i < parts.length; i += 16) {
    grouped.push(parts.slice(i, i + 16).join(' '));
  }
  return { content: grouped.join('\n'), truncated };
};

const bytesToBase64 = (bytes: Uint8Array, limit: number): { content: string; truncated: boolean } => {
  const slice = bytes.length > limit ? bytes.subarray(0, limit) : bytes;
  const truncated = bytes.length > limit;
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < slice.length; i += chunkSize) {
    const chunk = slice.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const base64 = btoa(binary);
  return { content: base64, truncated };
};

const safeStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_key, v) => {
      if (typeof v === 'bigint') return v.toString();
      if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`;
      const bytes = toUint8Array(v);
      if (bytes) {
        return {
          __type: v?.constructor?.name || 'Uint8Array',
          byteLength: bytes.byteLength,
          base64Preview: bytesToBase64(bytes, 2048).content
        };
      }
      if (v && typeof v === 'object') {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    },
    2
  );
};

const copyToClipboard = async (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
};

const tryImagePreviewDataUrl = (value: unknown): string | null => {
  if (typeof value === 'string' && value.startsWith('data:image/')) return value;
  if (typeof ImageData !== 'undefined' && value instanceof ImageData) {
    const canvas = document.createElement('canvas');
    canvas.width = value.width;
    canvas.height = value.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(value, 0, 0);
    return canvas.toDataURL('image/png');
  }
  return null;
};

export default function RawValueViewer({ label, value }: RawValueViewerProps) {
  const [mode, setMode] = useState<Mode>('summary');
  const [showAll, setShowAll] = useState(false);

  const imagePreview = useMemo(() => tryImagePreviewDataUrl(value), [value]);

  const { content, truncated } = useMemo((): { content: string; truncated: boolean } => {
    const limit = showAll ? Number.POSITIVE_INFINITY : 65536;

    if (mode === 'summary') {
      const t = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      const bytes = toUint8Array(value);
      if (bytes) {
        return {
          content: `${label ? `${label}\n` : ''}type: ${value?.constructor?.name || 'bytes'}\nbyteLength: ${bytes.byteLength}`,
          truncated: false
        };
      }
      if (typeof value === 'string') {
        return {
          content: `${label ? `${label}\n` : ''}type: string\nlength: ${value.length}`,
          truncated: false
        };
      }
      if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
        return {
          content: `${label ? `${label}\n` : ''}type: ${t}\nvalue: ${String(value)}`,
          truncated: false
        };
      }
      if (value && typeof value === 'object') {
        const keys = Object.keys(value as Record<string, unknown>);
        return {
          content: `${label ? `${label}\n` : ''}type: ${value.constructor?.name || 'object'}\nkeys: ${keys.length}\n${keys.slice(0, 50).join(', ')}${keys.length > 50 ? '…' : ''}`,
          truncated: false
        };
      }
      return { content: `${label ? `${label}\n` : ''}type: ${t}`, truncated: false };
    }

    if (mode === 'json') {
      try {
        const json = safeStringify(value);
        const truncated = !showAll && json.length > 200_000;
        return { content: truncated ? `${json.slice(0, 200_000)}\n…` : json, truncated };
      } catch (e) {
        return { content: `Failed to stringify: ${e instanceof Error ? e.message : String(e)}`, truncated: false };
      }
    }

    if (mode === 'text') {
      if (typeof value === 'string') {
        const truncated = !showAll && value.length > 200_000;
        return { content: truncated ? `${value.slice(0, 200_000)}\n…` : value, truncated };
      }
      const bytes = toUint8Array(value);
      if (bytes) {
        try {
          const decoder = new TextDecoder('utf-8', { fatal: false });
          const text = decoder.decode(bytes.length > limit ? bytes.subarray(0, limit) : bytes);
          const truncated = bytes.length > limit;
          return { content: text, truncated };
        } catch (e) {
          return { content: `Failed to decode as UTF-8: ${e instanceof Error ? e.message : String(e)}`, truncated: false };
        }
      }
      return { content: 'Not a string or byte buffer', truncated: false };
    }

    if (mode === 'hex') {
      const bytes = toUint8Array(value);
      if (!bytes) return { content: 'Not a byte buffer', truncated: false };
      return bytesToHex(bytes, limit);
    }

    if (mode === 'base64') {
      const bytes = toUint8Array(value);
      if (!bytes) return { content: 'Not a byte buffer', truncated: false };
      return bytesToBase64(bytes, limit);
    }

    return { content: '', truncated: false };
  }, [label, mode, showAll, value]);

  const handleCopy = async () => {
    await copyToClipboard(content);
  };

  const modes: Array<{ id: Mode; label: string }> = [
    { id: 'summary', label: 'Summary' },
    { id: 'json', label: 'JSON' },
    { id: 'text', label: 'Text' },
    { id: 'hex', label: 'Hex' },
    { id: 'base64', label: 'Base64' }
  ];

  return (
    <div className="raw-viewer">
      <div className="raw-viewer-toolbar">
        <div className="raw-viewer-title">{label || 'Value'}</div>
        <div className="raw-viewer-toolbar-actions">
          <button onClick={handleCopy}>Copy</button>
          {truncated && (
            <button onClick={() => setShowAll(true)} disabled={showAll}>
              Show all
            </button>
          )}
        </div>
      </div>

      <div className="raw-viewer-modes">
        {modes.map((m) => (
          <button
            key={m.id}
            className={mode === m.id ? 'active' : ''}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {imagePreview && (
        <div className="raw-viewer-image-preview">
          <img src={imagePreview} alt="preview" />
        </div>
      )}

      {mode === 'summary' ? (
        <div className="raw-viewer-summary">
          <pre>{content}</pre>
        </div>
      ) : (
        <pre className="raw-viewer-pre">
          <code>{content}</code>
        </pre>
      )}
    </div>
  );
}
