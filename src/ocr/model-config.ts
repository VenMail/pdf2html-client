export interface ModelConfig {
  name: string;
  description: string;
  det?: {
    url: string;
    inputName?: string;
    outputName?: string;
  };
  rec?: {
    url: string;
    inputName?: string;
    outputName?: string;
  };
  cls?: {
    url: string;
    inputName?: string;
    outputName?: string;
  };
  dict?: {
    url: string;
    lang?: string;
  };
}

export const PPU_MOBILE_CONFIG: ModelConfig = {
  name: 'PPU Mobile (Fast)',
  description: 'Fastest processing, optimized for mobile devices and real-time OCR',
  det: {
    url: './models/PP-OCRv5_mobile_det_infer.onnx',
    inputName: 'x',
    outputName: 'sigmoid_0.tmp_0'
  },
  rec: {
    url: './models/en_PP-OCRv4_mobile_rec_infer.onnx',
    inputName: 'x',
    outputName: 'softmax_0.tmp_0'
  },
  dict: {
    url: './models/en_dict.txt',
    lang: 'en'
  }
};

export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  'ppu-mobile': PPU_MOBILE_CONFIG
};

export function getDefaultModelConfig(): ModelConfig {
  return PPU_MOBILE_CONFIG;
}

