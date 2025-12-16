import type { ModelConfig } from './model-config.js';

export interface DownloadProgress {
  loaded: number;
  total: number;
  percent: number;
  model: string;
  type: 'det' | 'rec' | 'cls' | 'dict';
}

export interface ModelData {
  data: ArrayBuffer;
  url: string;
}

export class ModelDownloader {
  private modelCache: Map<string, ModelData> = new Map();
  private downloadProgress: Map<string, Promise<ModelData>> = new Map();

  async downloadModel(
    url: string,
    type: 'det' | 'rec' | 'cls' | 'dict',
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<ModelData> {
    const cacheKey = url;

    if (this.modelCache.has(cacheKey)) {
      return this.modelCache.get(cacheKey)!;
    }

    if (this.downloadProgress.has(cacheKey)) {
      return this.downloadProgress.get(cacheKey)!;
    }

    const downloadPromise = this._downloadWithProgress(url, type, onProgress);
    this.downloadProgress.set(cacheKey, downloadPromise);

    try {
      const modelData = await downloadPromise;
      this.modelCache.set(cacheKey, modelData);
      this.downloadProgress.delete(cacheKey);
      return modelData;
    } catch (error) {
      this.downloadProgress.delete(cacheKey);
      throw error;
    }
  }

  private async _downloadWithProgress(
    url: string,
    type: 'det' | 'rec' | 'cls' | 'dict',
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<ModelData> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download model from ${url}: ${response.statusText}`);
      }

      const contentLength = Number(response.headers.get('Content-Length')) || 0;
      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const chunks: Uint8Array[] = [];
      let receivedLength = 0;

      // eslint no-constant-condition: loop terminates on reader.done
      for (;;) {
        const { done, value } = await reader.read();
        if (done || !value) break;

        chunks.push(value);
        receivedLength += value.length;

        if (onProgress && contentLength > 0) {
          const percent = (receivedLength / contentLength) * 100;
          onProgress({
            loaded: receivedLength,
            total: contentLength,
            percent,
            model: url.split('/').pop() || 'model',
            type
          });
        }
      }

      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const arrayBuffer = new ArrayBuffer(totalLength);
      const view = new Uint8Array(arrayBuffer);
      let offset = 0;

      for (const chunk of chunks) {
        view.set(chunk, offset);
        offset += chunk.length;
      }

      return {
        data: arrayBuffer,
        url: URL.createObjectURL(new Blob([arrayBuffer]))
      };
    } catch (error) {
      console.error(`Model download error for ${url}:`, error);
      throw error;
    }
  }

  async downloadModelConfig(
    config: ModelConfig,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<{
    det?: ArrayBuffer;
    rec?: ArrayBuffer;
    cls?: ArrayBuffer;
    dict?: string;
  }> {
    const results: {
      det?: ArrayBuffer;
      rec?: ArrayBuffer;
      cls?: ArrayBuffer;
      dict?: string;
    } = {};

    const downloads: Promise<void>[] = [];

    if (config.det?.url) {
      downloads.push(
        this.downloadModel(config.det.url, 'det', onProgress).then((data) => {
          results.det = data.data;
        })
      );
    }

    if (config.rec?.url) {
      downloads.push(
        this.downloadModel(config.rec.url, 'rec', onProgress).then((data) => {
          results.rec = data.data;
        })
      );
    }

    if (config.cls?.url) {
      downloads.push(
        this.downloadModel(config.cls.url, 'cls', onProgress).then((data) => {
          results.cls = data.data;
        })
      );
    }

    if (config.dict?.url) {
      downloads.push(
        fetch(config.dict.url)
          .then((response) => response.text())
          .then((text) => {
            results.dict = text;
          })
      );
    }

    await Promise.all(downloads);

    return results;
  }

  clearCache(): void {
    for (const modelData of this.modelCache.values()) {
      if (modelData.url && modelData.url.startsWith('blob:')) {
        URL.revokeObjectURL(modelData.url);
      }
    }

    this.modelCache.clear();
    this.downloadProgress.clear();
  }

  getCachedModel(url: string): ModelData | undefined {
    return this.modelCache.get(url);
  }

  isCached(url: string): boolean {
    return this.modelCache.has(url);
  }
}

