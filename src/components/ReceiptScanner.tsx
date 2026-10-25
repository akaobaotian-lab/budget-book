import { useEffect, useState } from 'react';
import { parseReceiptText, type ParsedReceipt } from '../lib/receiptParser';
// OCRエンジンと日本語データはアプリに同梱し、外部CDNに依存しない
import workerPath from 'tesseract.js/dist/worker.min.js?url';
import corePath from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';

/** 画像を縮小・グレースケール化してOCR精度と速度を上げる */
async function preprocess(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function ReceiptScanner({ onResult }: { onResult(r: ParsedReceipt): void }) {
  const [preview, setPreview] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [rawText, setRawText] = useState('');

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setRawText('');
    setPreview(URL.createObjectURL(file));
    setProgress(0);
    setStatus('読み取りの準備中…（初回は言語データのダウンロードに時間がかかります）');
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('jpn', 1, {
        workerPath,
        corePath,
        langPath: new URL('tessdata', document.baseURI).href,
        workerBlobURL: false,
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') {
            setStatus('文字を読み取っています…');
            setProgress(m.progress);
          }
        },
      });
      const image = await preprocess(file);
      const { data } = await worker.recognize(image);
      await worker.terminate();
      setRawText(data.text);
      const parsed = parseReceiptText(data.text);
      setProgress(null);
      if (!parsed.amount) {
        setError('合計金額を読み取れませんでした。手入力で補ってください。');
      }
      onResult(parsed);
    } catch (e) {
      setProgress(null);
      setError(`読み取りに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="receipt">
      <div className="receipt-buttons">
        <label className="btn primary">
          📷 撮影する
          <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <label className="btn">
          🖼️ 画像を選ぶ
          <input type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      </div>
      <p className="hint">レシート全体が写るように、明るい場所でまっすぐ撮影してください。画像は端末内で処理され、外部に送信されません。</p>
      {preview && <img className="receipt-preview" src={preview} alt="レシート" />}
      {progress != null && (
        <div className="progress">
          <div style={{ width: `${Math.round(progress * 100)}%` }} />
          <span>{status}</span>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {rawText && (
        <details>
          <summary>読み取ったテキスト</summary>
          <pre className="ocr-text">{rawText}</pre>
        </details>
      )}
    </div>
  );
}
