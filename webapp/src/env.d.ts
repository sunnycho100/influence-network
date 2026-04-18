/// <reference types="vite/client" />

declare interface ImportMetaEnv {
  readonly VITE_EXTENSION_ID?: string;
}

declare interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace ChromeRuntime {
  interface LastError {
    message?: string;
  }

  interface Runtime {
    lastError?: LastError;
    sendMessage(
      extensionId: string,
      message: unknown,
      responseCallback: (response: unknown) => void
    ): void;
  }
}

declare const chrome: {
  runtime: ChromeRuntime.Runtime;
};
