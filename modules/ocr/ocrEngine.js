export async function runOcr(file, options = {}) {
  const { debug = false, onProgress = () => {} } = options;

  if (!file) {
    throw new Error("No image file was provided.");
  }

  if (!window.Tesseract) {
    throw new Error("Tesseract.js is not available. Check the script connection and try again.");
  }

  const psm = window.Tesseract?.PSM?.AUTO || window.Tesseract?.PSM?.SINGLE_BLOCK || 3;
  const result = await window.Tesseract.recognize(file, "eng", {
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-@.()% \u00B0",
    tessedit_pageseg_mode: psm,
    pageSegMode: psm,
    logger(event) {
      if (event.status) {
        onProgress({
          status: event.status,
          progress: typeof event.progress === "number" ? event.progress : 0
        });
      }
    }
  });

  const data = result.data || {};
  const confidence = Math.round(data.confidence || 0);
  const text = data.text || "";
  const lines = (data.lines || []).map((line) => ({
    text: line.text,
    confidence: Math.round(line.confidence || 0),
    bbox: line.bbox
  }));

  return {
    text,
    confidence,
    lines: debug ? lines : [],
    words: debug ? (data.words || []).map((word) => ({
      text: word.text,
      confidence: Math.round(word.confidence || 0)
    })) : []
  };
}
