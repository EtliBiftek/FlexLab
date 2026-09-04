/// <reference types="vite/client" />

declare global {
  interface Window {
    flexlabDesktop?: {
      managementToken: string;
      getInfo: () => Promise<{ version: string; openAtLogin: boolean; packaged: boolean }>;
      setOpenAtLogin: (enabled: boolean) => Promise<boolean>;
      checkUpdates: () => Promise<{ ok: boolean; version?: string | null; message?: string }>;
    };
  }
}
export {};
