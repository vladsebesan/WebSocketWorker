import { useEffect, useRef, useState } from 'react';

import type { IWebSocketURL } from '../interfaces/IWebsocketUrl';
import type { IMessageManagerConfig, IMessageManagerState } from './worker-thread/MessageManager';
import { WorkerCommandType, WorkerEventType, type WorkerCommand, type WorkerEvent } from './worker-thread/PIApiWorker';
import { makeUUID } from '../utils/uuid';
import { SessionState } from './worker-thread/Session';
import type { IFlowModel, IToolboxModel } from '../interfaces/IFlow';
import { Api } from './worker-thread/Api';
import type { IApiCommand } from './worker-thread/IApi';

export interface IPiApiConfig  extends IMessageManagerConfig {}

export interface IPiApiState extends IMessageManagerState {}

// interface IActiveSubscription {
//   callback: IPIApiNotificationCallback<any>;
//   subscribeCommandType: WorkerCommandType;
//   unsubscribeCommandType: WorkerCommandType;
// }

interface IPendingRequest {
  reject: (error: Error) => void;
  resolve: (data: any) => void;
}

const WORKER_URL = new URL('./worker-thread/PIApiWorker.ts', import.meta.url);

export class PiApi {
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
    };
    console.log('PiApi initialized with state:', this.state);
    try {
      this.worker = new Worker(WORKER_URL, { type: 'module' });
      this.worker.addEventListener('message', this.onWorkerEvent);
    } catch (error) {
      throw new Error(
        `Failed to create PiApi worker: ${error instanceof Error ? error.message : String(error)}`,
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

  public async getToolbox(): Promise<IToolboxModel> {
    const command = Api.ToolboxGet({});
    return this.sendRequest(command, 10000);
  }

  public async getFlow(): Promise<IFlowModel> {
    const command = Api.FlowGet({});
    return this.sendRequest(command, 10000);
  }

  private async sendRequest<TParams, TResult>(
    command: IApiCommand<TParams, TResult>,
    timeoutMs: number = 5000
  ): Promise<TResult> {
    const requestId = makeUUID();
    
    return new Promise<TResult>((resolve, reject) => {
      // Store pending request - timeout handled by worker
      this.pendingRequests.set(requestId, {
        resolve: (data: TResult) => {
          resolve(data);
        },
        reject: (error: Error) => {
          reject(error);
        }
      });

      // Send command to worker - the command object contains everything needed
      const workerCommand: WorkerCommand = {
        requestId,
        type: WorkerCommandType.SEND_REQUEST,
        ...command, // Send the entire command object
        timeoutMs
      };

      if (this.worker) {
        this.worker.postMessage(workerCommand);
        console.log(`PIApi: Sent API command ${command.commandType} with requestId: ${requestId}`);
      } else {
        this.pendingRequests.delete(requestId);
        reject(new Error('Worker not initialized'));
      }
    });
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
        console.log('PIApi: Unsupported worker event:', (response as any).type);
        break;
    }  
  };

  private cleanup(): void {
    // Cancel all pending requests
    for (const [, pending] of this.pendingRequests) {
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
      // Store pending request - timeout handled by worker
      this.pendingRequests.set(command.requestId, {
        reject,
        resolve
      });

      this.worker!.postMessage(command);
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
        console.log('Disposing PIApi on unmount');
        piApi.dispose();
      }
    };
  }, [piApi]);

  return piApi!;
};