import { useEffect, useRef, useState } from 'react';
import { PiApiBase, type IPiApiConfig } from './core/PIApiBase';
import type { IFlowModel, IToolboxModel } from '../interfaces/IFlow';
import { Api } from './PiRequests';
import type { IWebSocketURL } from '../interfaces/IWebsocketUrl';

class PiApi extends PiApiBase {
  constructor(config: IPiApiConfig) {
    super(config);
  }

  public async getToolbox(): Promise<IToolboxModel> {
    const command = Api.ToolboxGet({});
    return super.sendRequest(command, 10000);
  }

  public async getFlow(): Promise<IFlowModel> {
    const command = Api.FlowGet({});
    return super.sendRequest(command, 10000);
  }
}

// TODO: AI: CRITICAL - Multiple issues with this hook:
// 1. Returns null! (non-null assertion on nullable value) - causes crashes when components try to use piApi before initialization
// 2. Race condition - component receives null, renders, then re-renders with real value (unnecessary render)
// 3. No loading state management - components must handle null case themselves
// 4. Cleanup effect depends on piApi, but it's set asynchronously - potential timing issues
// FIX: Return an object with {piApi, isLoading} or use Suspense pattern. Never return null with ! assertion.
export const usePiApi = (): PiApi => {
  const [piApi, setPiApi] = useState<PiApi | null>(null);
  const isInitialized = useRef(false);

  // Helper function to get WebSocket URL (similar to your current getWebsocketUrl)
  const getPiSocketUrl = (): IWebSocketURL => {
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const protocol = isHttps ? 'wss:' : 'ws:';
    const hostname = window.location.hostname || 'localhost';
    const port = 9090;
    const url = `${protocol}//${hostname}:${port}/ws/`;
    return url as IWebSocketURL;
  };

  // Create on first use
  useEffect(() => {
    // Only initialize once
    if (!isInitialized.current) {
      isInitialized.current = true;
      
      // TODO: AI: Configuration values should come from environment variables or config file, not hardcoded
      const fullConfig: IPiApiConfig = {
        maxReconnectAttempts: 3,
        reconnectIntervalMs: 1000,
        sessionKeepaliveIntervalMs: 1000,
        maxKeepaliveFailures: 3,
        url: getPiSocketUrl(),
      };

      const newPiApi = new PiApi(fullConfig);
      
      // Auto-connect like your current ViewerChannel
      // newPiApi.connect().catch(() => {
      //   // Connection failed - the PIApi will handle retries internally
      //   // State changes will be available via piApi.onStateChange()
      //   console.error('Connection failed - the PIApi will handle retries internally');
      // });

      setPiApi(newPiApi);
    }
  }, []); // Empty dependency array - only run once

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (piApi) {
        // TODO: AI: Remove console.log from production code
        console.log('Disposing PIApi on unmount');
        piApi.dispose();
      }
    };
  }, [piApi]);

  // TODO: AI: CRITICAL - This returns null! which forces a non-null assertion on a nullable value.
  // Components calling this hook will crash if they try to use piApi before it's initialized.
  // Should return { piApi: PiApi | null, isLoading: boolean } or throw in Suspense.
  return piApi!;
};