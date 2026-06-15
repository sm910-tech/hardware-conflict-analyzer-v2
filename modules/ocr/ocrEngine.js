import { applyOcrCorrections } from "./ocrCorrections.js";

const OCR_CHAR_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-@.()%+/:_[] \u00B0";
const PREPROCESS_MAX_SIZE = 2500;

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

    if (width > PREPROCESS_MAX_SIZE || height > PREPROCESS_MAX_SIZE) {
      const scale = Math.min(PREPROCESS_MAX_SIZE / width, PREPROCESS_MAX_SIZE / height);
      drawWidth = Math.round(width * scale);
      drawHeight = Math.round(height * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = drawWidth;
    canvas.height = drawHeight;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      if (source.close) {
        source.close();
      }
      return file;
    }

    ctx.drawImage(source, 0, 0, drawWidth, drawHeight);

    if (source.close) {
      source.close();
    }

    const imageData = ctx.getImageData(0, 0, drawWidth, drawHeight);
    const pixels = imageData.data;
    const contrast = 1.35;
    const threshold = 168;

    for (let index = 0; index < pixels.length; index += 4) {
      const gray = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
      const adjusted = Math.max(0, Math.min(255, (gray - 128) * contrast + 128));
      const value = adjusted >= threshold ? 255 : adjusted <= 72 ? 0 : adjusted;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
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
    console.warn("OCR preprocessing failed:", error);
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
