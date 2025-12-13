import { describe, it, expect } from 'vitest';
import { PDFJSWrapper } from '../../src/core/pdfjs-wrapper.js';

describe('PDFJSWrapper annotation/form mapping', () => {
  it('maps link annotation with coordinates', async () => {
    const wrapper = new PDFJSWrapper();
    const ann = {
      subtype: 'Link',
      rect: [10, 20, 110, 60],
      url: 'https://example.com',
      contents: 'Go'
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = (wrapper as any).mapAnnotation(ann, 200);
    expect(mapped).toBeTruthy();
    expect(mapped!.type).toBe('link');
    expect(mapped!.x).toBe(10);
    expect(mapped!.y).toBe(200 - 60);
    expect(mapped!.width).toBe(100);
    expect(mapped!.height).toBe(40);
    expect(mapped!.url).toBe('https://example.com');
  });

  it('maps widget form to text field', async () => {
    const wrapper = new PDFJSWrapper();
    const ann = {
      subtype: 'Widget',
      fieldType: 'Tx',
      fieldName: 'name',
      value: 'Alice',
      rect: [5, 5, 55, 25]
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = (wrapper as any).mapForm(ann, 100);
    expect(mapped).toBeTruthy();
    expect(mapped!.type).toBe('text');
    expect(mapped!.name).toBe('name');
    expect(mapped!.value).toBe('Alice');
    expect(mapped!.x).toBe(5);
    expect(mapped!.y).toBe(100 - 25);
    expect(mapped!.width).toBe(50);
    expect(mapped!.height).toBe(20);
  });
});
