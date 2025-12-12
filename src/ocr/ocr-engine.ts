import type { OCRConfig, OCRResult, BoundingBox } from '../types/ocr.js';
import * as ort from 'onnxruntime-web';
import { ensureOpenCvReady } from '../utils/opencv-wrapper.js';
import cv from '@techstark/opencv-js';
import { getDefaultModelConfig, type ModelConfig as ModelConfigType } from './model-config.js';
import { ModelDownloader, type DownloadProgress } from './model-downloader.js';

interface ModelData {
  det?: string | ArrayBuffer;
  rec?: string | ArrayBuffer;
  cls?: string | ArrayBuffer;
  dict?: string;
}

interface DetectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  points?: number[][];
}

interface RecognitionResult {
  text: string;
  confidence: number;
  box: DetectionBox;
}

export class OCREngine {
  private detModel: ort.InferenceSession | null = null;
  private recModel: ort.InferenceSession | null = null;
  private clsModel: ort.InferenceSession | null = null;
  private cv: typeof cv | null = null;
  private initialized: boolean = false;
  private config: OCRConfig;
  private characterDict: string[] = [];
  private modelConfig: ModelConfigType | null = null;
  private downloader: ModelDownloader;

  constructor(config: OCRConfig = { confidenceThreshold: 0.7 }) {
    this.config = config;
    this.downloader = new ModelDownloader();
  }

  async initialize(
    modelConfig?: ModelData | ModelConfigType,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.cv = await ensureOpenCvReady();

      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';

      const sessionOptions: ort.InferenceSession.SessionOptions = {
        executionProviders: ['webgl', 'wasm'],
        graphOptimizationLevel: 'all'
      };

      let modelData: ModelData;

      if (modelConfig) {
        if ('det' in modelConfig && 'rec' in modelConfig) {
          modelData = modelConfig as ModelData;
        } else {
          this.modelConfig = modelConfig as ModelConfigType;
          modelData = await this.downloader.downloadModelConfig(
            this.modelConfig,
            onProgress
          );
        }
      } else {
        this.modelConfig = getDefaultModelConfig();
        modelData = await this.downloader.downloadModelConfig(
          this.modelConfig,
          onProgress
        );
      }

      if (modelData.det) {
        const detData = modelData.det instanceof ArrayBuffer
          ? modelData.det
          : await this.loadModel(modelData.det);
        this.detModel = await ort.InferenceSession.create(detData, sessionOptions);
      }

      if (modelData.rec) {
        const recData = modelData.rec instanceof ArrayBuffer
          ? modelData.rec
          : await this.loadModel(modelData.rec);
        this.recModel = await ort.InferenceSession.create(recData, sessionOptions);
      }

      if (modelData.cls) {
        const clsData = modelData.cls instanceof ArrayBuffer
          ? modelData.cls
          : await this.loadModel(modelData.cls);
        this.clsModel = await ort.InferenceSession.create(clsData, sessionOptions);
      }

      if (modelData.dict) {
        await this.loadCharacterDictFromText(modelData.dict);
      }

      this.initialized = true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to initialize OCR engine: ${errorMessage}`);
    }
  }

  private async loadModel(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load model from ${url}`);
    }
    return await response.arrayBuffer();
  }

  private async loadCharacterDictFromText(text: string): Promise<void> {
    this.characterDict = text.trim().split('\n');
    if (!this.characterDict.includes(' ')) {
      this.characterDict.push(' ');
    }
  }

  async recognize(imageData: ImageData | string): Promise<OCRResult[]> {
    if (!this.initialized) {
      throw new Error('OCR engine not initialized. Call initialize() first.');
    }

    if (!this.detModel || !this.recModel || !this.cv) {
      throw new Error('OCR models not loaded. Please provide model configuration.');
    }

    try {
      let mat: cv.Mat;
      
      if (typeof imageData === 'string') {
        mat = await this.loadImageFromUrl(imageData);
      } else {
        mat = this.cv.matFromImageData(imageData);
      }

      try {
        const detectionResult = await this.detectText(mat);
        const sortedBoxes = this.sortBoxes(detectionResult.boxes);
        const croppedRegions = this.cropTextRegions(mat, sortedBoxes);
        
        let processedRegions = croppedRegions;
        if (this.clsModel) {
          processedRegions = await this.classifyAngles(croppedRegions);
        }

        const recognitionResults = await this.recognizeText(processedRegions);
        
        processedRegions.forEach(region => {
          if (region.mat && region.mat.delete) {
            region.mat.delete();
          }
        });

        const results = this.formatResults(recognitionResults, sortedBoxes);
        mat.delete();

        return results.filter(
          (result) => result.confidence >= this.config.confidenceThreshold
        );
      } catch (error) {
        mat.delete();
        throw error;
      }
    } catch (error) {
      throw new Error(`OCR recognition failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async detectText(mat: cv.Mat): Promise<{ boxes: DetectionBox[]; inferenceTime: number }> {
    if (!this.detModel || !this.cv) {
      throw new Error('Detection model not loaded');
    }

    const input = await this.preprocessDetection(mat);
    const startTime = performance.now();
    const detection = await this.runDetectionInference(input.tensor, input.width, input.height);
    const inferenceTime = performance.now() - startTime;

    if (!detection) {
      return { boxes: [], inferenceTime };
    }

    const boxes = await this.postprocessDetection(detection, input);
    return { boxes, inferenceTime };
  }

  private async preprocessDetection(mat: cv.Mat): Promise<{
    tensor: Float32Array;
    width: number;
    height: number;
    resizeRatio: number;
    originalWidth: number;
    originalHeight: number;
  }> {
    if (!this.cv) throw new Error('OpenCV not initialized');

    const maxSideLength = 960;
    const mean = [0.485, 0.456, 0.406];
    const stdDeviation = [0.229, 0.224, 0.225];

    const [h, w] = [mat.rows, mat.cols];
    let resizeW = w;
    let resizeH = h;
    let ratio = 1.0;

    if (Math.max(h, w) > maxSideLength) {
      ratio = maxSideLength / Math.max(h, w);
      resizeW = Math.round(w * ratio);
      resizeH = Math.round(h * ratio);
    }

    const resized = new this.cv.Mat();
    this.cv.resize(mat, resized, new this.cv.Size(resizeW, resizeH));

    const targetW = Math.ceil(resizeW / 32) * 32;
    const targetH = Math.ceil(resizeH / 32) * 32;

    const padded = new this.cv.Mat();
    this.cv.copyMakeBorder(
      resized,
      padded,
      0,
      targetH - resizeH,
      0,
      targetW - resizeW,
      this.cv.BORDER_CONSTANT,
      new this.cv.Scalar(0, 0, 0, 0)
    );

    const rgb = new this.cv.Mat();
    this.cv.cvtColor(padded, rgb, this.cv.COLOR_RGBA2RGB);

    const tensor = new Float32Array(3 * targetH * targetW);
    const data = rgb.data;
    const dataLength = data.length;

    for (let h = 0; h < targetH; h++) {
      for (let w = 0; w < targetW; w++) {
        const idx = (h * targetW + w) * 3;
        if (idx + 2 < dataLength) {
          for (let c = 0; c < 3; c++) {
            const value = data[idx + c] / 255.0;
            const normalized = (value - mean[c]) / stdDeviation[c];
            tensor[c * targetH * targetW + h * targetW + w] = normalized;
          }
        }
      }
    }

    resized.delete();
    padded.delete();
    rgb.delete();

    return {
      tensor,
      width: targetW,
      height: targetH,
      resizeRatio: ratio,
      originalWidth: w,
      originalHeight: h
    };
  }

  private async runDetectionInference(
    tensor: Float32Array,
    width: number,
    height: number
  ): Promise<Float32Array | null> {
    if (!this.detModel) {
      throw new Error('Detection model not loaded');
    }

    try {
      const inputTensor = new ort.Tensor('float32', tensor, [1, 3, height, width]);
      const feeds = { x: inputTensor };
      const results = await this.detModel.run(feeds);

      const outputName = this.detModel.outputNames[0];
      const outputTensor = results[outputName];

      return outputTensor ? (outputTensor.data as Float32Array) : null;
    } catch (error) {
      console.error('Detection inference error:', error);
      return null;
    }
  }

  private async postprocessDetection(
    detection: Float32Array,
    input: {
      width: number;
      height: number;
      resizeRatio: number;
      originalWidth: number;
      originalHeight: number;
    }
  ): Promise<DetectionBox[]> {
    if (!this.cv) throw new Error('OpenCV not initialized');

    const { width, height, resizeRatio, originalWidth, originalHeight } = input;
    const threshold = 0.3;
    const boxThreshold = 0.6;
    const minimumAreaThreshold = 20;

    const probMap = new this.cv.Mat(height, width, this.cv.CV_32F);
    for (let i = 0; i < height * width; i++) {
      probMap.data32F[i] = detection[i];
    }

    const binaryMap = new this.cv.Mat();
    this.cv.threshold(probMap, binaryMap, threshold, 1, this.cv.THRESH_BINARY);

    const binaryMap8 = new this.cv.Mat();
    binaryMap.convertTo(binaryMap8, this.cv.CV_8U, 255);

    const contours = new this.cv.MatVector();
    const hierarchy = new this.cv.Mat();
    this.cv.findContours(binaryMap8, contours, hierarchy, this.cv.RETR_EXTERNAL, this.cv.CHAIN_APPROX_SIMPLE);

    const boxes: DetectionBox[] = [];

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const rect = this.cv.boundingRect(contour);

      if (rect.width * rect.height < minimumAreaThreshold) {
        continue;
      }

      const mask = this.cv.Mat.zeros(height, width, this.cv.CV_8U);
      this.cv.drawContours(mask, contours, i, new this.cv.Scalar(255), -1);

      let score = 0;
      let count = 0;
      for (let y = rect.y; y < rect.y + rect.height && y < height; y++) {
        for (let x = rect.x; x < rect.x + rect.width && x < width; x++) {
          const idx = y * width + x;
          if (idx < mask.data.length && mask.data[idx] > 0) {
            score += probMap.data32F[idx];
            count++;
          }
        }
      }
      score = count > 0 ? score / count : 0;

      if (score < boxThreshold) {
        mask.delete();
        continue;
      }

      const vPad = Math.round(rect.height * 0.4);
      const hPad = Math.round(rect.height * 0.6);

      let x = Math.max(0, rect.x - hPad);
      let y = Math.max(0, rect.y - vPad);
      let w = Math.min(width - x, rect.width + 2 * hPad);
      let h = Math.min(height - y, rect.height + 2 * vPad);

      x = Math.round(x / resizeRatio);
      y = Math.round(y / resizeRatio);
      w = Math.round(w / resizeRatio);
      h = Math.round(h / resizeRatio);

      x = Math.max(0, Math.min(x, originalWidth - 1));
      y = Math.max(0, Math.min(y, originalHeight - 1));
      w = Math.min(w, originalWidth - x);
      h = Math.min(h, originalHeight - y);

      if (w > 5 && h > 5) {
        boxes.push({ x, y, width: w, height: h, score });
      }

      mask.delete();
    }

    probMap.delete();
    binaryMap.delete();
    binaryMap8.delete();
    contours.delete();
    hierarchy.delete();

    return boxes;
  }

  private sortBoxes(boxes: DetectionBox[]): DetectionBox[] {
    return [...boxes].sort((a, b) => {
      if (Math.abs(a.y - b.y) < (a.height + b.height) / 4) {
        return a.x - b.x;
      }
      return a.y - b.y;
    });
  }

  private cropTextRegions(mat: cv.Mat, boxes: DetectionBox[]): Array<{ mat: cv.Mat; box: DetectionBox }> {
    if (!this.cv) throw new Error('OpenCV not initialized');

    const regions: Array<{ mat: cv.Mat; box: DetectionBox }> = [];

    for (const box of boxes) {
      try {
        const padding = 5;
        const x = Math.max(0, box.x - padding);
        const y = Math.max(0, box.y - padding);
        const width = Math.min(mat.cols - x, box.width + 2 * padding);
        const height = Math.min(mat.rows - y, box.height + 2 * padding);

        const rect = new this.cv.Rect(x, y, width, height);
        const roi = mat.roi(rect);
        const cropped = new this.cv.Mat();
        roi.copyTo(cropped);

        regions.push({ mat: cropped, box });
      } catch (error) {
        console.error('Error cropping region:', error);
      }
    }

    return regions;
  }

  private async classifyAngles(
    regions: Array<{ mat: cv.Mat; box: DetectionBox }>
  ): Promise<Array<{ mat: cv.Mat; box: DetectionBox }>> {
    if (!this.clsModel || !this.cv) {
      return regions;
    }

    const classifiedRegions: Array<{ mat: cv.Mat; box: DetectionBox }> = [];

    for (const region of regions) {
      const angle = await this.classifyAngle(region.mat);

      if (angle === 180) {
        const rotated = new this.cv.Mat();
        const center = new this.cv.Point(region.mat.cols / 2, region.mat.rows / 2);
        const M = this.cv.getRotationMatrix2D(center, 180, 1);
        this.cv.warpAffine(region.mat, rotated, M, new this.cv.Size(region.mat.cols, region.mat.rows));

        region.mat.delete();
        M.delete();

        classifiedRegions.push({ mat: rotated, box: region.box });
      } else {
        classifiedRegions.push(region);
      }
    }

    return classifiedRegions;
  }

  private async classifyAngle(mat: cv.Mat): Promise<number> {
    if (!this.clsModel || !this.cv) return 0;

    const targetH = 48;
    const targetW = 192;
    const resized = new this.cv.Mat();
    this.cv.resize(mat, resized, new this.cv.Size(targetW, targetH));

    const rgb = new this.cv.Mat();
    this.cv.cvtColor(resized, rgb, this.cv.COLOR_RGBA2RGB);

    const data = new Float32Array(3 * targetH * targetW);
    for (let h = 0; h < targetH; h++) {
      for (let w = 0; w < targetW; w++) {
        const idx = (h * targetW + w) * 3;
        for (let c = 0; c < 3; c++) {
          const value = rgb.data[idx + c] / 255.0;
          const normalized = (value - 0.5) / 0.5;
          data[c * targetH * targetW + h * targetW + w] = normalized;
        }
      }
    }

    const tensor = new ort.Tensor('float32', data, [1, 3, targetH, targetW]);
    const feeds = { x: tensor };
    const results = await this.clsModel.run(feeds);

    const output = results[this.clsModel.outputNames[0]];
    const probs = output.data as Float32Array;

    resized.delete();
    rgb.delete();

    return probs[0] > probs[1] ? 0 : 180;
  }

  private async recognizeText(
    regions: Array<{ mat: cv.Mat; box: DetectionBox }>
  ): Promise<RecognitionResult[]> {
    if (!this.recModel || !this.cv) {
      throw new Error('Recognition model not loaded');
    }

    const results: RecognitionResult[] = [];
    const imageHeight = 48;
    const imageWidth = 320;

    for (const region of regions) {
      try {
        const aspectRatio = region.mat.cols / region.mat.rows;
        const targetHeight = imageHeight;
        let targetWidth = Math.round(targetHeight * aspectRatio);
        targetWidth = Math.max(8, Math.min(targetWidth, imageWidth));

        const resized = new this.cv.Mat();
        this.cv.resize(region.mat, resized, new this.cv.Size(targetWidth, targetHeight));

        const gray = new this.cv.Mat();
        this.cv.cvtColor(resized, gray, this.cv.COLOR_RGBA2GRAY);

        const padded = new this.cv.Mat();
        if (targetWidth < imageWidth) {
          this.cv.copyMakeBorder(
            gray,
            padded,
            0,
            0,
            0,
            imageWidth - targetWidth,
            this.cv.BORDER_CONSTANT,
            new this.cv.Scalar(0)
          );
        } else {
          gray.copyTo(padded);
        }

        const tensor = new Float32Array(3 * targetHeight * imageWidth);
        for (let h = 0; h < targetHeight; h++) {
          for (let w = 0; w < imageWidth; w++) {
            const value = padded.data[h * imageWidth + w] / 255.0;
            const normalized = (value - 0.5) / 0.5;
            for (let c = 0; c < 3; c++) {
              tensor[c * targetHeight * imageWidth + h * imageWidth + w] = normalized;
            }
          }
        }

        const inputTensor = new ort.Tensor('float32', tensor, [1, 3, targetHeight, imageWidth]);
        const feeds = { x: inputTensor };
        const inferenceResults = await this.recModel.run(feeds);

        const output = inferenceResults[this.recModel.outputNames[0]];
        const decoded = this.ctcGreedyDecode(output.data as Float32Array, output.dims);

        resized.delete();
        gray.delete();
        padded.delete();

        results.push({
          text: decoded.text,
          confidence: decoded.confidence,
          box: region.box
        });
      } catch (error) {
        console.error('Error recognizing text in region:', error);
      }
    }

    return results;
  }

  private ctcGreedyDecode(logits: Float32Array, dims: readonly number[]): { text: string; confidence: number } {
    const [, seqLen, numClasses] = dims;
    const blankIndex = 0;

    let text = '';
    let lastIdx = -1;
    const confidences: number[] = [];

    for (let t = 0; t < seqLen; t++) {
      let maxIdx = 0;
      let maxProb = logits[t * numClasses];

      for (let c = 1; c < numClasses; c++) {
        if (logits[t * numClasses + c] > maxProb) {
          maxProb = logits[t * numClasses + c];
          maxIdx = c;
        }
      }

      if (maxIdx !== blankIndex && maxIdx !== lastIdx && maxIdx < this.characterDict.length) {
        text += this.characterDict[maxIdx];
        confidences.push(maxProb);
      }

      lastIdx = maxIdx;
    }

    const confidence = confidences.length > 0
      ? confidences.reduce((a, b) => a + b) / confidences.length
      : 0;

    return { text: text.trim(), confidence };
  }

  private formatResults(recognitionResults: RecognitionResult[], boxes: DetectionBox[]): OCRResult[] {
    const results: OCRResult[] = [];

    for (let i = 0; i < recognitionResults.length; i++) {
      const result = recognitionResults[i];
      const box = boxes[i];

      const boundingBox: BoundingBox = {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height
      };

      results.push({
        text: result.text,
        confidence: result.confidence,
        boundingBox,
        words: [{
          text: result.text,
          confidence: result.confidence,
          boundingBox
        }]
      });
    }

    return results;
  }

  private async loadImageFromUrl(url: string): Promise<cv.Mat> {
    if (!this.cv) throw new Error('OpenCV not initialized');

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const mat = this.cv!.imread(img);
        resolve(mat);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    if (this.detModel) {
      this.detModel.release();
      this.detModel = null;
    }
    if (this.recModel) {
      this.recModel.release();
      this.recModel = null;
    }
    if (this.clsModel) {
      this.clsModel.release();
      this.clsModel = null;
    }
    this.initialized = false;
    this.modelConfig = null;
  }
}
