import type { PDFPage } from '../../types/pdf.js';
import type { Rect, Obstacles } from './types.js';

export class ObstacleCollector {
  collect(page: PDFPage): Obstacles {
    return {
      soft: this.collectSoft(page),
      hard: this.collectHard(page)
    };
  }

  private collectSoft(page: PDFPage): Rect[] {
    const rects: Rect[] = [];

    for (const image of page.content.images || []) {
      rects.push(this.toRectFromPdf(image, page.height));
    }

    for (const g of page.content.graphics || []) {
      if (typeof g.x === 'number' && typeof g.y === 'number' && typeof g.width === 'number' && typeof g.height === 'number') {
        const w = Math.abs(g.width);
        const h = Math.abs(g.height);
        const minDim = Math.min(w, h);
        if (minDim <= 1.25) continue;
        rects.push(this.toRectFromPdf({ x: g.x, y: g.y, width: g.width, height: g.height }, page.height));
      }
    }

    for (const a of page.content.annotations || []) {
      rects.push(this.toRectFromPdf({ x: a.x, y: a.y, width: a.width, height: a.height }, page.height));
    }

    for (const f of page.content.forms || []) {
      rects.push(this.toRectFromPdf({ x: f.x, y: f.y, width: f.width, height: f.height }, page.height));
    }

    return rects;
  }

  private collectHard(page: PDFPage): Rect[] {
    const rects: Rect[] = [];

    for (const image of page.content.images || []) {
      rects.push(this.toRectFromPdf(image, page.height));
    }

    for (const a of page.content.annotations || []) {
      rects.push(this.toRectFromPdf({ x: a.x, y: a.y, width: a.width, height: a.height }, page.height));
    }

    for (const f of page.content.forms || []) {
      rects.push(this.toRectFromPdf({ x: f.x, y: f.y, width: f.width, height: f.height }, page.height));
    }

    return rects;
  }

  toRectFromPdf(
    obj: { x: number; y: number; width: number; height: number },
    pageHeight: number
  ): Rect {
    const left = obj.x;
    const top = pageHeight - (obj.y + obj.height);
    return {
      left,
      top,
      width: Math.max(0, obj.width),
      height: Math.max(0, obj.height)
    };
  }

  intersectionArea(a: Rect, b: Rect): number {
    const x1 = Math.max(a.left, b.left);
    const y1 = Math.max(a.top, b.top);
    const x2 = Math.min(a.left + a.width, b.left + b.width);
    const y2 = Math.min(a.top + a.height, b.top + b.height);
    const w = x2 - x1;
    const h = y2 - y1;
    if (w <= 0 || h <= 0) return 0;
    return w * h;
  }

  nearestDistance(a: Rect, obstacles: Rect[]): number {
    if (obstacles.length === 0) return Number.POSITIVE_INFINITY;
    let best = Number.POSITIVE_INFINITY;
    for (const b of obstacles) {
      const dx = this.axisDistance(a.left, a.left + a.width, b.left, b.left + b.width);
      const dy = this.axisDistance(a.top, a.top + a.height, b.top, b.top + b.height);
      const d = Math.hypot(dx, dy);
      if (d < best) best = d;
    }
    return best;
  }

  private axisDistance(a0: number, a1: number, b0: number, b1: number): number {
    if (a1 < b0) return b0 - a1;
    if (b1 < a0) return a0 - b1;
    return 0;
  }
}
