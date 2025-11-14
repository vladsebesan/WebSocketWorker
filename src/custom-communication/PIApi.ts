import { useEffect, useRef, useState } from 'react';

import type { IWebSocketURL } from '../interfaces/IWebsocketUrl';
import type { IMessageManagerConfig, IMessageManagerState } from './worker-thread/MessageManager';
import { WorkerCommandType, WorkerEventType, type WorkerCommand, type WorkerEvent } from './worker-thread/PIApiWorker';
import { makeUUID } from '../utils/uuid';
import { SessionState } from './worker-thread/Session';
import type { IFlowModel } from '../interfaces/IFlow';
import { ToolboxGetT } from '../generated/process-instance-message-api';

export interface IPiApiConfig  extends IMessageManagerConfig {
  // maxReconnectAttempts: number;
  // reconnectIntervalMs: number;
  // sessionKeepaliveIntervalMs: number;
  // maxKeepaliveFailures: number; // Add optional maxKeepaliveFailures
  // url: string;
}

export interface IPiApiState extends IMessageManagerState {
  // reconnectAttemptsLeft: number;
  // sessionId: null | string;
  // sessionState: SessionState;
}

interface IPendingRequest {
  reject: (error: Error) => void;
  resolve: (data: any) => void;
  timeout: NodeJS.Timeout;
}

// interface IActiveSubscription {
//   callback: IPIApiNotificationCallback<any>;
//   subscribeCommandType: WorkerCommandType;
//   unsubscribeCommandType: WorkerCommandType;
// }

const WORKER_URL = new URL('./worker-thread/PIApiWorker.ts', import.meta.url);

export class PIApi {
  private state: IPiApiState;
  private worker: null | Worker = null;
  private config: IPiApiConfig;
  
  //private stateChangeCallbacks = new Set<IPIApiNotificationCallback<IPiApiState>>();
  //private subscriptions = new Map<string, IActiveSubscription>();
  private pendingRequests = new Map<string, IPendingRequest>();

  constructor(config: IPiApiConfig) {
    this.config = config;
    this.state = {
      reconnectAttemptsLeft: config.maxReconnectAttempts,
      sessionId: null,
      sessionState: SessionState.DISCONNECTED,
    }
    try {
      this.worker = new Worker(WORKER_URL, { type: 'module' });
      this.worker.addEventListener('message', this.onWorkerEvent);
      this.worker.addEventListener('error', this.handleWorkerError);
    } catch (error) {
      throw new Error(
        `Failed to create PIApi worker: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  public async connect(): Promise<void> {
    return this.sendCommandInternal({
      config: this.config,
      requestId: makeUUID(),
      type: WorkerCommandType.CONNECT,
    });
  }

  public async disconnect(): Promise<void> {
    await this.sendCommandInternal({
      requestId:  makeUUID(),
      type: WorkerCommandType.DISCONNECT,
    });
    this.cleanup();
  }

  public dispose(): void {
    this.cleanup();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private onWorkerEvent = (event: MessageEvent): void => {
    const response = event.data as WorkerEvent;
    switch (response.type) {
      case WorkerEventType.STATE_CHANGED:
        // this.state = (response as any).state;
        // // Notify all state change callbacks
        // for (const callback of this.stateChangeCallbacks) {
        //   try {
        //     callback(this.state);
        //   } catch (error) {
        //     console.error('Error in state change callback:', error);
        //   }
        // }
        break;
      case WorkerEventType.REPLY:
        if (!response.requestId) {
          console.error('PIApi: Received reply with no requestId');
          return;
        }
        const pending = this.pendingRequests.get(response.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(response.requestId);
          if (response.type === WorkerEventType.REPLY) {
            if(response.isError) {
              pending.reject(new Error(response.errorMessage || 'Unknown error'));
              return;
            }else{
              pending.resolve((response as any).data);
              return;
            }
          }
        }
        break;
      case WorkerEventType.NOTIFICATION:
        // Find subscriptions that match this notification type
        // for (const subscription of this.subscriptions.values()) {
        //   // Call the callback with the notification data
        //   try {
        //     subscription.callback((response as any).data);
        //   } catch (error) {
        //     console.error('Error in notification callback:', error);
        //   }
        // }
        break;
      default:
        console.log('PIApi: Unsupported worker event:', response.type);
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
    //this.subscriptions.clear();
    //this.stateChangeCallbacks.clear();
  }

  private async sendCommandInternal<T = unknown>(command: WorkerCommand): Promise<T> {
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

  public async getToolbox(): Promise<IFlowModel> {
    console.log("PIApi: getToolbox called");
    const requestId = makeUUID();
    const payload = new ToolboxGetT();
    return this.sendCommandInternal({
      requestId,
      type: WorkerCommandType.SEND_REQUEST,
      payload,
    });
  }

  // private onStateChange(callback: IPIApiNotificationCallback<IPIApiState>): IPIApiSubscription {
  //   // this.stateChangeCallbacks.add(callback);
  //   // return {
  //   //   unsubscribe: (): void => {
  //   //     this.stateChangeCallbacks.delete(callback);
  //   //   },
  //   // };
  // }

  // private async sendCommand<T = unknown>(commandType: WorkerCommandType, payload?: unknown): Promise<T> {
  //   const command: IPIApiGenericCommand = {
  //     payload,
  //     requestId: makeUUID(),
  //     type: commandType,
  //   };
  //   return this.sendCommandInternal(command);
  // }

  // public subscribeToNotifications<T>(
  //   subscribeCommandType: WorkerCommandType,
  //   unsubscribeCommandType: WorkerCommandType,
  //   callback: IPIApiNotificationCallback<T>,
  // ): IPIApiSubscription {
  //   const subscriptionId = this.generateRequestId();

  //   // Store the subscription
  //   this.subscriptions.set(subscriptionId, {
  //     callback,
  //     subscribeCommandType,
  //     unsubscribeCommandType,
  //   });

  //   // Send subscribe command
  //   const command: IPIApiGenericCommand = {
  //     requestId: subscriptionId,
  //     type: subscribeCommandType,
  //   };
  //   this.sendCommandInternal(command).catch((error) => {
  //     console.error('Failed to subscribe:', error);
  //     this.subscriptions.delete(subscriptionId);
  //   });

  //   return {
  //     unsubscribe: (): void => {
  //       const subscription = this.subscriptions.get(subscriptionId);
  //       if (subscription) {
  //         this.subscriptions.delete(subscriptionId);

  //         // Send unsubscribe command
  //         const unsubscribeCommand: IPIApiGenericCommand = {
  //           requestId: this.generateRequestId(),
  //           type: subscription.unsubscribeCommandType,
  //         };
  //         this.sendCommandInternal(unsubscribeCommand).catch((error) => {
  //           console.error('Failed to unsubscribe:', error);
  //         });
  //       }
  //     },
  //   };
  // }
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
        console.log('Disposing PIApi on unmount');
        piApi.dispose();
      }
    };
  }, [piApi]);

  return piApi!;
};