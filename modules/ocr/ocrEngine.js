import { applyOcrCorrections } from "./ocrCorrections.js";

const OCR_CHAR_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-@.()%+/:_[] \u00B0";
const PREPROCESS_MAX_SIZE = 2500;
const PREPROCESS_MIN_SIZE = 1500; // Target size to upscale small, blurry text

function extractLinesAndWords(data) {
  const lines = [];
  const words = [];

  const blocks = data?.blocks || [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        lines.push({
          text: line.text,
          confidence: Math.round(line.confidence || 0),
          bbox: line.bbox
        });
        for (const word of line.words || []) {
          words.push({
            text: word.text,
            confidence: Math.round(word.confidence || 0)
          });
        }
      }
    }
  }

  if (!lines.length && data?.lines?.length) {
    for (const line of data.lines) {
      lines.push({
        text: line.text,
        confidence: Math.round(line.confidence || 0),
        bbox: line.bbox
      });
    }
  }

  if (!words.length && data?.words?.length) {
    for (const word of data.words) {
      words.push({
        text: word.text,
        confidence: Math.round(word.confidence || 0)
      });
    }
  }

  return { lines, words };
}

async function preprocessImageForOcr(file) {
  if (!file || !file.type?.startsWith("image/")) {
    return file;
  }

  const loadBitmap = async () => {
    if (window.createImageBitmap) {
      return createImageBitmap(file);
    }

    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  try {
    const source = await loadBitmap();
    const width = source.width;
    const height = source.height;
    let drawWidth = width;
    let drawHeight = height;

    // --- Smart Scaling ---
    // Downscale if too massive to save memory
    if (width > PREPROCESS_MAX_SIZE || height > PREPROCESS_MAX_SIZE) {
      const scale = Math.min(PREPROCESS_MAX_SIZE / width, PREPROCESS_MAX_SIZE / height);
      drawWidth = Math.round(width * scale);
      drawHeight = Math.round(height * scale);
    } 
    // Upscale if the image is too small (helps Tesseract read small UI fonts)
    else if (width < PREPROCESS_MIN_SIZE && height < PREPROCESS_MIN_SIZE) {
      const scale = Math.max(PREPROCESS_MIN_SIZE / width, PREPROCESS_MIN_SIZE / height);
      drawWidth = Math.round(width * scale);
      drawHeight = Math.round(height * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = drawWidth;
    canvas.height = drawHeight;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      if (source.close) source.close();
      return file;
    }

    // Use high-quality image smoothing when resizing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, drawWidth, drawHeight);

    if (source.close) {
      source.close();
    }

    const imageData = ctx.getImageData(0, 0, drawWidth, drawHeight);
    const pixels = imageData.data;

    // --- Otsu's Adaptive Thresholding Implementation ---
    const histogram = new Array(256).fill(0);
    const grayscaleValues = new Uint8Array(pixels.length / 4);

    // 1. Convert to grayscale and build histogram
    let grayIdx = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const gray = Math.round(pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114);
      grayscaleValues[grayIdx++] = gray;
      histogram[gray]++;
    }

    // 2. Calculate the optimal Otsu threshold point
    const totalPixels = grayscaleValues.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * histogram[i];

    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let varMax = 0;
    let adaptiveThreshold = 128; // Sensible default fallback

    for (let t = 0; t < 256; t++) {
      wB += histogram[t];
      if (wB === 0) continue;
      wF = totalPixels - wB;
      if (wF === 0) break;

      sumB += t * histogram[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;

      const varBetween = wB * wF * (mB - mF) * (mB - mF);
      if (varBetween > varMax) {
        varMax = varBetween;
        adaptiveThreshold = t;
      }
    }

    // 3. Apply Contrast + Adaptive Threshold Binary Filter
    const contrast = 1.4; 
    grayIdx = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const gray = grayscaleValues[grayIdx++];
      
      // Apply contrast stretch around the dynamic threshold midpoint
      const adjusted = Math.max(0, Math.min(255, (gray - adaptiveThreshold) * contrast + adaptiveThreshold));
      
      // Strict binarization based on our calculated optimal threshold
      const finalValue = adjusted >= adaptiveThreshold ? 255 : 0;
      
      pixels[index] = finalValue;     // R
      pixels[index + 1] = finalValue; // G
      pixels[index + 2] = finalValue; // B
    }

    ctx.putImageData(imageData, 0, 0);
    const outputType = file.type || "image/png";

    return await new Promise((resolve) => {
      canvas.toBlob((blob) => {
        canvas.width = 0;
        canvas.height = 0;

        if (!blob) {
          resolve(file);
          return;
        }
        resolve(new File([blob], file.name, { type: outputType }));
      }, outputType);
    });
  } catch (error) {
    console.warn("OCR preprocessing failed, falling back to raw file:", error);
    return file;
  }
}

export async function runOcr(file, options = {}) {
  const { debug = false, onProgress = () => {}, preprocess = true } = options;

  if (!file) {
    throw new Error("No image file was provided.");
  }

  if (!window.Tesseract) {
    throw new Error("Tesseract.js is not available. Check the script connection and try again.");
  }

  const inputFile = preprocess ? await preprocessImageForOcr(file) : file;
  const psm = window.Tesseract?.PSM?.AUTO || window.Tesseract?.PSM?.SINGLE_BLOCK || 3;
  const oem = window.Tesseract?.OEM?.LSTM_ONLY;
  const recognizeOptions = {
    tessedit_char_whitelist: OCR_CHAR_WHITELIST,
    tessedit_pageseg_mode: String(psm),
    pageSegMode: psm,
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
    logger(event) {
      if (event.status) {
        onProgress({
          status: event.status,
          progress: typeof event.progress === "number" ? event.progress : 0
        });
      }
    }
  };

  if (oem != null) {
    recognizeOptions.tessedit_ocr_engine_mode = String(oem);
    recognizeOptions.ocrEngineMode = oem;
  }

  const result = await window.Tesseract.recognize(inputFile, "eng", recognizeOptions);

  const data = result.data || {};
  const { lines, words } = extractLinesAndWords(data);
  const cleanedRaw = (data.text || "").trim();
  const correctedText = applyOcrCorrections(cleanedRaw);
  const confidence = Math.round(data.confidence || 0);

  return {
    text: correctedText,
    rawText: cleanedRaw,
    confidence,
    corrected: correctedText !== cleanedRaw,
    lines: debug ? lines : [],
    words: debug ? words.slice(0, 120) : []
  };
}
