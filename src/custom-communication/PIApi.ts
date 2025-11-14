import { useEffect, useRef, useState } from 'react';

import {
  PIApiConnectionState,
  PIApiSessionState,
  type IPIApiConfig,
  type IPIApiNotificationCallback,
  type IPIApiState,
  type IPIApiSubscription,
} from './shared/PIApiTypes';

import type { IWebSocketURL } from '../interfaces/IWebsocketUrl';
import { PIApiWorkerCommandType, PIApiWorkerResponseType, type IPIApiGenericCommand, type IPIApiWorkerResponse } from './shared/WorkerProtocol';

interface IPendingRequest {
  reject: (error: Error) => void;
  resolve: (data: any) => void;
  timeout: NodeJS.Timeout;
}

interface IActiveSubscription {
  callback: IPIApiNotificationCallback<any>;
  subscribeCommandType: PIApiWorkerCommandType;
  unsubscribeCommandType: PIApiWorkerCommandType;
}

export class PIApi {
  private nextRequestId = 1;
  private pendingRequests = new Map<string, IPendingRequest>();
  private state: IPIApiState;
  private stateChangeCallbacks = new Set<IPIApiNotificationCallback<IPIApiState>>();
  private subscriptions = new Map<string, IActiveSubscription>();
  private worker: null | Worker = null;
  private config: IPIApiConfig;

  constructor(config: IPIApiConfig) {
    this.config = config;
    this.state = this.getInitialState();
    this.initializeWorker();
  }

  public async connect(): Promise<void> {
    const command: IPIApiGenericCommand = {
      payload: { config: this.config },
      requestId: this.generateRequestId(),
      type: PIApiWorkerCommandType.CONNECT,
    };
    return this.sendCommandInternal(command);
  }

  public async disconnect(): Promise<void> {
    const command: IPIApiGenericCommand = {
      requestId: this.generateRequestId(),
      type: PIApiWorkerCommandType.DISCONNECT,
    };
    await this.sendCommandInternal(command);
    this.cleanup();
  }

  public dispose(): void {
    this.cleanup();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  public getState(): IPIApiState {
    return { ...this.state };
  }

  private handleWorkerError = (error: ErrorEvent): void => {
    console.error('PIApiWorkerClient: Worker error:', error);
    // Handle worker errors, potentially by updating state
  };
  private handleWorkerMessage = (event: MessageEvent): void => {
    const response = event.data as IPIApiWorkerResponse;

    switch (response.type) {
      case PIApiWorkerResponseType.ERROR:
      case PIApiWorkerResponseType.SUCCESS:
        this.handleCommandResponse(response);
        break;
      case PIApiWorkerResponseType.FLOW_NOTIFICATION:
      case PIApiWorkerResponseType.PERSISTENCE_MODEL_NOTIFICATION:
      case PIApiWorkerResponseType.PROCESSING_INSTANCE_STATUS_NOTIFICATION:
        this.handleNotification(response);
        break;
      case PIApiWorkerResponseType.STATE_CHANGED:
        this.handleStateChange(response);
        break;
      default:
        console.warn('PIApiWorkerClient: Unknown response type:', response);
        break;
    }
  };

  private cleanup(): void {
    // Cancel all pending requests
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();

    // Clear subscriptions
    this.subscriptions.clear();
    this.stateChangeCallbacks.clear();
  }

  private generateRequestId(): string {
    return `req_${this.nextRequestId++}`;
  }

  private getInitialState(): IPIApiState {
    return {
      connectionState: PIApiConnectionState.DISCONNECTED,
      lastError: null,
      remainingReconnectAttempts: this.config.maxReconnectAttempts,
      sessionId: null,
      sessionState: PIApiSessionState.NO_SESSION,
    };
  }

  private handleCommandResponse(response: IPIApiWorkerResponse): void {
    if (!response.requestId) {
      return;
    }

    const pending = this.pendingRequests.get(response.requestId);
    if (pending) {
      this.pendingRequests.delete(response.requestId);
      clearTimeout(pending.timeout);

      if (response.type === PIApiWorkerResponseType.SUCCESS) {
        pending.resolve((response as any).data);
      } else {
        pending.reject(new Error((response as any).error?.message || 'Unknown error'));
      }
    }
  }

  private handleNotification(response: IPIApiWorkerResponse): void {
    // Find subscriptions that match this notification type
    for (const subscription of this.subscriptions.values()) {
      // Call the callback with the notification data
      try {
        subscription.callback((response as any).data);
      } catch (error) {
        console.error('Error in notification callback:', error);
      }
    }
  }

  private handleStateChange(response: IPIApiWorkerResponse): void {
    this.state = (response as any).state;

    // Notify all state change callbacks
    for (const callback of this.stateChangeCallbacks) {
      try {
        callback(this.state);
      } catch (error) {
        console.error('Error in state change callback:', error);
      }
    }
  }

  private initializeWorker(): void {
    const workerUrl = new URL('./worker-thread/PIApiWorker.ts', import.meta.url);

    try {
      this.worker = new Worker(workerUrl, { type: 'module' });
      this.worker.addEventListener('message', this.handleWorkerMessage);
      this.worker.addEventListener('error', this.handleWorkerError);
    } catch (error) {
      throw new Error(
        `Failed to create PIApi worker: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async sendCommandInternal<T = unknown>(command: IPIApiGenericCommand): Promise<T> {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(command.requestId);
        reject(new Error('Request timeout'));
      }, 120000); // 120 second timeout

      this.pendingRequests.set(command.requestId, {
        reject,
        resolve,
        timeout,
      });

      this.worker!.postMessage(command);
    });
  }

  public onStateChange(callback: IPIApiNotificationCallback<IPIApiState>): IPIApiSubscription {
    this.stateChangeCallbacks.add(callback);
    return {
      unsubscribe: (): void => {
        this.stateChangeCallbacks.delete(callback);
      },
    };
  }

  public async sendCommand<T = unknown>(commandType: PIApiWorkerCommandType, payload?: unknown): Promise<T> {
    const command: IPIApiGenericCommand = {
      payload,
      requestId: this.generateRequestId(),
      type: commandType,
    };
    return this.sendCommandInternal(command);
  }

  public subscribeToNotifications<T>(
    subscribeCommandType: PIApiWorkerCommandType,
    unsubscribeCommandType: PIApiWorkerCommandType,
    callback: IPIApiNotificationCallback<T>,
  ): IPIApiSubscription {
    const subscriptionId = this.generateRequestId();

    // Store the subscription
    this.subscriptions.set(subscriptionId, {
      callback,
      subscribeCommandType,
      unsubscribeCommandType,
    });

    // Send subscribe command
    const command: IPIApiGenericCommand = {
      requestId: subscriptionId,
      type: subscribeCommandType,
    };
    this.sendCommandInternal(command).catch((error) => {
      console.error('Failed to subscribe:', error);
      this.subscriptions.delete(subscriptionId);
    });

    return {
      unsubscribe: (): void => {
        const subscription = this.subscriptions.get(subscriptionId);
        if (subscription) {
          this.subscriptions.delete(subscriptionId);

          // Send unsubscribe command
          const unsubscribeCommand: IPIApiGenericCommand = {
            requestId: this.generateRequestId(),
            type: subscription.unsubscribeCommandType,
          };
          this.sendCommandInternal(unsubscribeCommand).catch((error) => {
            console.error('Failed to unsubscribe:', error);
          });
        }
      },
    };
}
}

// React hook for using PIApi (similar to your current useViewerChannel)
export const usePIApi = (): PIApi => {
  const [piApi, setPiApi] = useState<PIApi | null>(null);
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
      
      const fullConfig: IPIApiConfig = {
        maxReconnectAttempts: 3,
        reconnectIntervalMs: 1000,
        sessionKeepaliveIntervalMs: 1000,
        url: getPiSocketUrl(),
      };

      const newPiApi = new PIApi(fullConfig);
      
      // Auto-connect like your current ViewerChannel
      newPiApi.connect().catch(() => {
        // Connection failed - the PIApi will handle retries internally
        // State changes will be available via piApi.onStateChange()
        console.error('Connection failed - the PIApi will handle retries internally');
      });

      setPiApi(newPiApi);
    }
  }, []); // Empty dependency array - only run once

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (piApi) {
        console.log('Disposing PIApi on unmount');
        piApi.dispose();
      }
    };
  }, [piApi]);

  return piApi!;
};