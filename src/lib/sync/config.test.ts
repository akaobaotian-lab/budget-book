import { describe, expect, it } from 'vitest';
import { configFromText, parseFirebaseConfig, shareUrl } from './config';

const SNIPPET = `// Import the functions you need from the SDKs you need
const firebaseConfig = {
  apiKey: "AIzaSyExample-123",
  authDomain: "kakeibo-123.firebaseapp.com",
  projectId: "kakeibo-123",
  storageBucket: "kakeibo-123.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
};`;

describe('sync config', () => {
  it('parses the snippet shown in the Firebase console', () => {
    expect(parseFirebaseConfig(SNIPPET)).toEqual({
      apiKey: 'AIzaSyExample-123',
      authDomain: 'kakeibo-123.firebaseapp.com',
      projectId: 'kakeibo-123',
      appId: '1:1234567890:web:abcdef',
      storageBucket: 'kakeibo-123.firebasestorage.app',
      messagingSenderId: '1234567890',
    });
  });
  it('parses JSON too', () => {
    expect(parseFirebaseConfig('{"apiKey":"k","projectId":"p","appId":"a"}')).toMatchObject({ apiKey: 'k', projectId: 'p', authDomain: 'p.firebaseapp.com' });
  });
  it('rejects incomplete config', () => {
    expect(parseFirebaseConfig('apiKey: "x"')).toBeNull();
  });
  it('round-trips a share link (pasted with surrounding text)', () => {
    const firebase = parseFirebaseConfig(SNIPPET)!;
    const link = shareUrl('https://example.github.io/budget-book/', { firebase, linkedUid: 'secret-uid' });
    expect(link).not.toContain('secret-uid');
    expect(configFromText(`家計簿の接続リンク ${link} です`)).toEqual({ firebase, emulatorHost: undefined });
  });
});
