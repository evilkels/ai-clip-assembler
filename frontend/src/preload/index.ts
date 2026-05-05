import { contextBridge } from 'electron';

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8000';

const bridge = {
  backendUrl: process.env.VITE_BACKEND_URL ?? DEFAULT_BACKEND_URL,
  platform: process.platform,
};

contextBridge.exposeInMainWorld('clipAssembler', bridge);

export type ClipAssemblerBridge = typeof bridge;
