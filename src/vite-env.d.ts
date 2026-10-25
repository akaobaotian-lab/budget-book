/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 公開時に組み込む Firebase の接続情報（firebaseConfig の JSON） */
  readonly VITE_FIREBASE_CONFIG?: string;
}
