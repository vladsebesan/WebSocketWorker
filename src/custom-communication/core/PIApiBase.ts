import { useEffect, useRef, useState } from 'react';
import type { IToolboxModel, IFlowModel } from '../../interfaces/IFlow';
import type { IWebSocketURL } from '../../interfaces/IWebsocketUrl';
import { makeUUID } from '../../utils/uuid';
import { Api } from '../PiRequests';
import type { IApiSubscription, IApiCommand } from './IApiInterfaces';
import type { IMessageManagerConfig, IMessageManagerState } from './MessageManager';
import { WorkerCommandType, WorkerEventType, type WorkerCommand, type WorkerEvent } from './PIApiWorker';
import { SessionState } from './Session';

export interface IPiApiConfig  extends IMessageManagerConfig {}

export interface IPiApiState extends IMessageManagerState {}

// Internal subscription tracking object
class Subscription {
  internalId: string;
  subscriptionId: string | null = null;
  apiSubscription: IApiSubscription<any, any, any>;
  state: 'pending' | 'active' | 'closed' = 'pending';

  constructor(apiSubscription: IApiSubscription<any, any, any>) {
    this.internalId = makeUUID();
    this.apiSubscription = apiSubscription;
  }
}

interface IPendingRequest {
  reject: (error: Error) => void;
  resolve: (data: any) => void;
}

const WORKER_URL = new URL('./PIApiWorker.ts', import.meta.url);

export class PiApiBase {
  private state: IPiApiState;
  private worker: null | Worker = null;
  private config: IPiApiConfig;
  private pendingRequests = new Map<string, IPendingRequest>();
  private subscriptions = new Map<string, Subscription>(); // Map<internalId, Subscription>
  private subscriptionIdMap = new Map<string, string>(); // Map<subscriptionId, internalId>

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
      requestId: 'connect_req_id',
      type: WorkerCommandType.CONNECT,
    });
  }

  public disconnect(): void {
    this.sendWorkerCommand({
      requestId: 'disconnect_req_id',
      type: WorkerCommandType.DISCONNECT,
    });
  }

  public dispose(): void {
    this.cleanup();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  protected async sendRequest<TParams, TResult>(
    command: IApiCommand<TParams, TResult>,
    timeoutMs: number = 5000
  ): Promise<TResult> {
    const requestId = makeUUID();
    
    return new Promise<TResult>((resolve, reject) => {
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
        ...command,
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

              if(response.requestId === 'connect_req_id'){
                //notify connection error
                if(this.onConnectionError) {
                  this.onConnectionError(new Error(response.errorMessage || 'Unknown error'));
                }
              }
              pending.reject(new Error(response.errorMessage || 'Unknown error'));
              return;
            }else{

              if(response.requestId === 'connect_req_id'){
                if(this.onConnected) {
                  this.onConnected();
                }
              }

              if(response.requestId === 'disconnect_req_id'){
                this.cleanup();
                if(this.onDisconnected) {
                  this.onDisconnected();
                }                
              }

              pending.resolve((response as any).data);
              return;
            }
          }
        }
        break;
      case WorkerEventType.NOTIFICATION:
        // Notification now comes pre-deserialized from worker with internalId
        const notifResponse = response as any;
        const internalId = notifResponse.internalId;
        const deserializedData = notifResponse.data;
        
        // Find subscription by internalId
        const subscription = this.subscriptions.get(internalId);
        if (subscription && subscription.state === 'active') {
          try {
            // Invoke subscription callback with deserialized data
            (subscription.apiSubscription as any).invokeCallback(deserializedData);
          } catch (error) {
            console.error(`PiApi: Error invoking subscription callback for ${internalId}:`, error);
          }
        } else {
          console.warn(`PiApi: Received notification for unknown or inactive subscription: ${internalId}`);
        }
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

    // Mark all subscriptions as closed (no auto-resubscribe)
    for (const [, subscription] of this.subscriptions) {
      subscription.state = 'closed';
    }
    this.subscriptions.clear();
    this.subscriptionIdMap.clear();
  }

  public async subscribe<TParams, TReply, TNotifData>(
    apiSubscription: IApiSubscription<TParams, TReply, TNotifData>,
    params: TParams
  ): Promise<string> {
    // Create internal subscription object
    const subscription = new Subscription(apiSubscription);
    this.subscriptions.set(subscription.internalId, subscription);

    try {
      // Send SUBSCRIBE command to worker with subscription name and internalId
      const command: WorkerCommand = {
        requestId: makeUUID(),
        type: WorkerCommandType.SUBSCRIBE,
        subscriptionName: apiSubscription.subscriptionName,
        params,
        internalId: subscription.internalId,
      };

      return new Promise<string>((resolve, reject) => {
        this.pendingRequests.set(command.requestId, {
          resolve: (data: any) => {
            // Extract subscriptionId from reply
            const subscriptionId = data.subscriptionId;
            if (subscriptionId) {
              subscription.subscriptionId = subscriptionId;
              subscription.state = 'active';
              this.subscriptionIdMap.set(subscriptionId, subscription.internalId);
              console.log(`PiApi: Subscription active - internalId: ${subscription.internalId}, subscriptionId: ${subscriptionId}`);
            }
            resolve(subscription.internalId);
          },
          reject: (error: Error) => {
            this.subscriptions.delete(subscription.internalId);
            reject(error);
          },
        });

        if (this.worker) {
          this.worker.postMessage(command);
        } else {
          this.pendingRequests.delete(command.requestId);
          this.subscriptions.delete(subscription.internalId);
          reject(new Error('Worker not initialized'));
        }
      });
    } catch (error) {
      // Cleanup failed subscription
      this.subscriptions.delete(subscription.internalId);
      throw error;
    }
  }

  public unsubscribe(internalId: string): void {
    const subscription = this.subscriptions.get(internalId);
    if (!subscription) {
      console.warn(`PiApi: Cannot unsubscribe - subscription ${internalId} not found`);
      return;
    }

    // Mark as closed
    subscription.state = 'closed';

    // Send UNSUBSCRIBE command to worker if we have a subscriptionId
    if (subscription.subscriptionId) {
      const command: WorkerCommand = {
        requestId: makeUUID(),
        type: WorkerCommandType.UNSUBSCRIBE,
        subscriptionId: subscription.subscriptionId,
      };

      if (this.worker) {
        this.worker.postMessage(command);
      }
      
      // Remove from subscriptionId map
      this.subscriptionIdMap.delete(subscription.subscriptionId);
    }

    // Remove from subscriptions map
    this.subscriptions.delete(internalId);
    
    console.log(`PiApi: Unsubscribed from ${internalId}`);
  }
}


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