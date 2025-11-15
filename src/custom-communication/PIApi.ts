import { useEffect, useRef, useState } from 'react';

import type { IWebSocketURL } from '../interfaces/IWebsocketUrl';
import type { IMessageManagerConfig, IMessageManagerState } from './worker-thread/MessageManager';
import { WorkerCommandType, WorkerEventType, type WorkerCommand, type WorkerEvent } from './worker-thread/PIApiWorker';
import { makeUUID } from '../utils/uuid';
import { SessionState } from './worker-thread/Session';
import type { IFlowModel, IToolboxModel } from '../interfaces/IFlow';
import { Api } from './ApiDefinition';
import type { IApiCommand } from './IApiDefinition';

export interface IPiApiConfig  extends IMessageManagerConfig {}

export interface IPiApiState extends IMessageManagerState {}

// interface IActiveSubscription {
//   callback: IPIApiNotificationCallback<any>;
//   subscribeCommandType: WorkerCommandType;
//   unsubscribeCommandType: WorkerCommandType;
// }

// TODO: AI: CRITICAL - Missing timeout property. These promises can hang forever if worker crashes or never 
// responds, causing unbounded memory growth from orphaned promises and their closures.
interface IPendingRequest {
  reject: (error: Error) => void;
  resolve: (data: any) => void;
  // Add: timeout: NodeJS.Timeout;
}

const WORKER_URL = new URL('./worker-thread/PIApiWorker.ts', import.meta.url);

export class PiApi {
  private state: IPiApiState;
  private worker: null | Worker = null;
  private config: IPiApiConfig;
  private pendingRequests = new Map<string, IPendingRequest>();
  //private stateChangeCallbacks = new Set<IPIApiNotificationCallback<IPiApiState>>();
  //private subscriptions = new Map<string, IActiveSubscription>();

  onConnected: (() => void) | null = null;
  onDisconnected: (() => void) | null = null;
  onConnectionError: ((error: Error) => void) | null = null;


  constructor(config: IPiApiConfig) {
    this.config = config;
    this.state = {
      reconnectAttemptsLeft: config.maxReconnectAttempts,
      sessionId: null,
      sessionState: SessionState.DISCONNECTED,
    };
    // TODO: AI: Remove console.log from production code
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

  private sendWorkerCommand(command: WorkerCommand): void {
    this.pendingRequests.set(command.requestId, {
      resolve: () => {},
      reject: () => {}
    });
    if (this.worker) {
      this.worker.postMessage(command);
    }
  }

  public connect(): void {
    this.sendWorkerCommand({
      config: this.config,
      requestId: makeUUID(),
      type: WorkerCommandType.CONNECT,
    });
  }

  public disconnect(): void {
    this.sendWorkerCommand({
      requestId: makeUUID(),
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

  // TODO: AI: Hardcoded timeout (10000ms). Should be configurable via config or environment variable for 
  // different deployment scenarios (dev/staging/prod may need different timeouts).
  public async getToolbox(): Promise<IToolboxModel> {
    const command = Api.ToolboxGet({});
    return this.sendRequest(command, 10000);
  }

  // TODO: AI: Hardcoded timeout (10000ms). Should be configurable.
  public async getFlow(): Promise<IFlowModel> {
    const command = Api.FlowGet({});
    return this.sendRequest(command, 10000);
  }

  // TODO: AI: CRITICAL ISSUE - No client-side timeout mechanism. This relies entirely on the worker to timeout.
  // If the worker crashes, freezes, or never responds, these promises will never resolve/reject, causing memory leaks.
  // Should implement a timeout here as a safety mechanism (similar to MessageManager.sendRequest).
  // Also missing: request deduplication (rapid clicks send duplicate requests), request cancellation (cannot abort 
  // long-running requests when user navigates away).
  private async sendRequest<TParams, TResult>(
    command: IApiCommand<TParams, TResult>,
    timeoutMs: number = 5000
  ): Promise<TResult> {
    const requestId = makeUUID();
    
    return new Promise<TResult>((resolve, reject) => {
      // Store pending request - timeout handled by worker
      // TODO: AI: Add client-side timeout as safety net:
      // const timeout = setTimeout(() => {
      //   this.pendingRequests.delete(requestId);
      //   reject(new Error(`Request ${command.commandType} timed out after ${timeoutMs}ms`));
      // }, timeoutMs);
      
      this.pendingRequests.set(requestId, {
        resolve: (data: TResult) => {
          resolve(data);
        },
        reject: (error: Error) => {
          reject(error);
        }
        // timeout (add this field)
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
        // TODO: AI: Remove console.log from production code
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
          // TODO: AI: console.error should be replaced with proper error reporting/logging utility
          console.error('PIApi: Received reply with no requestId');
          return;
        }
        const pending = this.pendingRequests.get(response.requestId);
        if (pending) {
          this.pendingRequests.delete(response.requestId);
          // TODO: AI: If we add timeout (as recommended), remember to clear it here:
          // clearTimeout(pending.timeout);
          if (response.type === WorkerEventType.REPLY) {
            if(response.isError) {
              // Check if this is a connect/disconnect error
              if (this.onConnectionError) {
                this.onConnectionError(new Error(response.errorMessage || 'Unknown error'));
              }
              pending.reject(new Error(response.errorMessage || 'Unknown error'));
              return;
            }else{
              // Check if this is a connect/disconnect success
              if (this.onConnected && (response as any).data === undefined) {
                this.onConnected();
              }
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
        // TODO: AI: Remove console.log from production code
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
  // };
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