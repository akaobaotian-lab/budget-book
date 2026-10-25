import { useEffect, useRef, useState } from 'react';

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type Ctor = new () => SpeechRecognitionLike;

function getRecognition(): Ctor | null {
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const EXAMPLES = [
  '昨日スーパーで食費2500円',
  '自分の買い物 ユニクロ 3990円',
  '田中さんに5000円貸した',
  '田中さんから3000円返してもらった',
  '競馬で3000円買って払い戻し1万2000円',
  '副業の報酬5万円入金',
];

export function VoiceButton({ onResult }: { onResult(text: string): void }) {
  const Recognition = getRecognition();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => () => recRef.current?.stop(), []);

  const start = () => {
    if (!Recognition) return;
    setError('');
    setInterim('');
    const rec = new Recognition();
    rec.lang = 'ja-JP';
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText = text;
      }
      setInterim(text);
    };
    rec.onerror = (e) => {
      setError(e.error === 'not-allowed' ? 'マイクの使用が許可されていません' : e.error === 'no-speech' ? '音声が聞き取れませんでした' : `音声認識エラー: ${e.error}`);
    };
    rec.onend = () => {
      setListening(false);
      if (finalText.trim()) onResult(finalText.trim());
    };
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  return (
    <div className="voice">
      {Recognition ? (
        <>
          <button type="button" className={`mic ${listening ? 'live' : ''}`} onClick={listening ? () => recRef.current?.stop() : start} aria-label={listening ? '停止' : '話す'}>
            🎤
          </button>
          <p className="voice-status">{listening ? (interim || '聞いています…') : 'ボタンを押して話してください'}</p>
        </>
      ) : (
        <p className="hint">このブラウザは音声認識に対応していません（Chrome / Safari / Edge で利用できます）。下の欄にキーボードの音声入力で入力することもできます。</p>
      )}
      {error && <p className="error">{error}</p>}

      <form
        className="voice-typed"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim()) onResult(typed.trim());
        }}
      >
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="文章で入力: 例「昨日ランチ1200円」" />
        <button className="btn" type="submit">解析</button>
      </form>

      <details className="examples">
        <summary>話し方の例</summary>
        <ul>{EXAMPLES.map((x) => <li key={x}>「{x}」</li>)}</ul>
      </details>
    </div>
  );
}
