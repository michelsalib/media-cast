import type { ElectronAPI } from '@electron-toolkit/preload';
import type { MediaCastApi } from './index';

declare global {
  interface Window {
    electron: ElectronAPI;
    api: MediaCastApi;
  }
}
