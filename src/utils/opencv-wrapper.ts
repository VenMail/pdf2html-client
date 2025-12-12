import cv from '@techstark/opencv-js';

let cvReadyPromise: Promise<typeof cv> | null = null;

export function getOpenCv(): Promise<typeof cv> {
  if (!cvReadyPromise) {
    cvReadyPromise = new Promise((resolve, reject) => {
      if (typeof cv !== 'undefined' && cv.Mat) {
        resolve(cv);
        return;
      }

      const checkReady = () => {
        if (typeof cv !== 'undefined') {
          if (cv.onRuntimeInitialized) {
            const originalCallback = cv.onRuntimeInitialized;
            cv.onRuntimeInitialized = () => {
              originalCallback();
              resolve(cv);
            };
          } else if (cv.Mat) {
            resolve(cv);
          } else {
            setTimeout(checkReady, 100);
          }
        } else {
          setTimeout(checkReady, 100);
        }
      };

      checkReady();

      setTimeout(() => {
        reject(new Error('OpenCV.js failed to load after 30 seconds'));
      }, 30000);
    });
  }

  return cvReadyPromise;
}

export async function ensureOpenCvReady(): Promise<typeof cv> {
  const cvModule = await getOpenCv();
  if (typeof window !== 'undefined') {
    (window as any).cv = cvModule;
  }
  return cvModule;
}

