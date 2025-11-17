import { MessageManager } from './MessageManager';
import { Session } from './Session';
import { Transport } from './Transport';
import { Api } from '../PiRequests';
import { Subscriptions } from '../PiNotifications';
import type { IPiApiConfig, IPiApiState } from './PIApiBase';

export enum WorkerCommandType {
  CONNECT = 'CONNECT',
  DISCONNECT = 'DISCONNECT',
  SEND_REQUEST = 'SEND_REQUEST',
  SUBSCRIBE = 'SUBSCRIBE',
  UNSUBSCRIBE = 'UNSUBSCRIBE',
}

export enum WorkerEventType {
  STATE_CHANGED = 'STATE_CHANGED',
  REPLY = 'REPLY', // data contains Error or Reply data
  NOTIFICATION = 'NOTIFICATION',
}

export interface WorkerConnect {
  requestId: string;  
  config: IPiApiConfig;
  type: WorkerCommandType.CONNECT;
}

export interface WorkerDisconnect{
  requestId: string;  
  type: WorkerCommandType.DISCONNECT;
}

export interface WorkerSendRequest {
  requestId: string;  
  type: WorkerCommandType.SEND_REQUEST;
  commandType: string;
  // TODO: AI: Type safety issue - using 'any' for params. Should use generic type or unknown with proper validation
  params: any;
  timeoutMs: number;
}

export interface WorkerSubscribe {
  requestId: string;
  type: WorkerCommandType.SUBSCRIBE;
  subscriptionName: string;
  params: any;
  internalId: string;
}

export interface WorkerUnsubscribe {
  requestId: string;
  type: WorkerCommandType.UNSUBSCRIBE;
  subscriptionId: string;
}

export interface WorkerReply<T> {
  requestId: string; 
  data?: T; //data might be null for errors OR void replies
  type: WorkerEventType.REPLY;
  isError: boolean;
  errorMessage?: string; //null if no error
  errorCode?: string; //null if no error
}

export interface WorkerNotification<T> {
  data: T;
  internalId: string;
  type: WorkerEventType.NOTIFICATION;
}

export interface WorkerStateChangedEvent{
  state: IPiApiState;
  type: WorkerEventType.STATE_CHANGED;
}

export type WorkerCommand =
  | WorkerConnect
  | WorkerDisconnect
  | WorkerSendRequest
  | WorkerSubscribe
  | WorkerUnsubscribe;


export type WorkerEvent = 
  | WorkerReply<unknown>
  | WorkerNotification<unknown>
  | WorkerStateChangedEvent;

class PIApiWorker {
  private messageManager!: MessageManager;
  private pendingConnectionRequest: { requestId: string; type: WorkerCommandType.CONNECT | WorkerCommandType.DISCONNECT } | null = null;
  private subscriptions = new Map<string, string>(); // Map<subscriptionId, internalId>

  constructor() {
    this.messageManager = new MessageManager(new Session(new Transport()));
    this.messageManager.onStateChanged = this.onMessageManagerStateChange.bind(this);
    this.messageManager.onConnected = this.onMessageManagerConnected.bind(this);
    this.messageManager.onDisconnected = this.onMessageManagerDisconnected.bind(this);
    this.messageManager.onNotification = this.onNotification.bind(this);
    self.addEventListener('message', this.recvFromMainThread);
  }

  private recvFromMainThread = (event: MessageEvent): void => {
    const command = event.data as WorkerCommand;
    switch (command.type) {
      case WorkerCommandType.CONNECT:
        {
          const connect = command as WorkerConnect;
          this.pendingConnectionRequest = { requestId: connect.requestId, type: WorkerCommandType.CONNECT };
          this.messageManager.connect(connect.config);
        }
        break;
      case WorkerCommandType.DISCONNECT:
        {
          const disconnect = command as WorkerDisconnect;
          this.pendingConnectionRequest = { requestId: disconnect.requestId, type: WorkerCommandType.DISCONNECT };
          this.messageManager.disconnect();
        }
        break;
      case WorkerCommandType.SEND_REQUEST:
        {
          const sendRequest = command as WorkerSendRequest;
          try {            
            const apiCommand = Api.createCommandFromTransfer(sendRequest.commandType, sendRequest.params);
            this.messageManager.sendRequest(apiCommand, sendRequest.requestId, sendRequest.timeoutMs)
              .then((result: any) => this.postSuccessReply(sendRequest.requestId, result))
              .catch((error: any) => this.postErrorReply(sendRequest.requestId, error.message, 'COMMAND_FAILED'));
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to recreate command';
            this.postErrorReply(sendRequest.requestId, errorMessage, 'COMMAND_RECREATION_FAILED');
          }
        }
        break;
      case WorkerCommandType.SUBSCRIBE:
        this.handleSubscribe(command as WorkerSubscribe);
        break;
      case WorkerCommandType.UNSUBSCRIBE:
        this.handleUnsubscribe(command as WorkerUnsubscribe);
        break;
      default:
        // TODO: AI: Production code should not use console.warn - implement proper logging utility with 
        // conditional logging based on environment (strip logs in production build)
        console.warn(`PiApiWorker: Unknown command type received: ${(command as any).type}`);
        break;
    }
  };

  private postErrorReply = <T>(requestId: string, errorMessage: string, errorCode?: string): void => {
    const response: WorkerReply<T> = {
      requestId,
      type: WorkerEventType.REPLY,
      isError: true,
      errorMessage,
      errorCode,
    };
    this.postToMainThread(response);
  }

  private postSuccessReply = <T>(requestId: string, data: T): void => {
    const response: WorkerReply<T> = {
      requestId,
      type: WorkerEventType.REPLY,
      isError: false,
      data,
    };

    // TODO: AI: Remove console.log from production code - causes performance degradation and potential memory 
    // leaks when dev tools are open. Use conditional logging or remove entirely.
    console.log('Posting success reply:', response);

    this.postToMainThread(response);
  }

  private postToMainThread(response: WorkerEvent): void {
    self.postMessage(response);
  }

  private onNotification(internalId: string, deserializedData: any): void {
    console.log(`PIApiWorker: Received deserialized notification for internalId: ${internalId}`);
    
    // Forward deserialized notification to main thread with internalId
    const response: WorkerNotification<any> = {
      data: deserializedData,
      internalId: internalId,
      type: WorkerEventType.NOTIFICATION,
    };
    this.postToMainThread(response);
  }

  private handleSubscribe(command: WorkerSubscribe): void {
    console.log(`PIApiWorker: Handling subscribe - subscriptionName: ${command.subscriptionName}, internalId: ${command.internalId}`);
    
    try {
      // Get subscription class from registry
      const createSubscription = (Subscriptions as any)[command.subscriptionName];
      if (!createSubscription) {
        this.postErrorReply(command.requestId, `Unknown subscription: ${command.subscriptionName}`, 'UNKNOWN_SUBSCRIPTION');
        return;
      }
      
      // Create subscription instance (no callback needed on worker side)
      const apiSubscription = createSubscription(() => {}, () => {});
      
      // Create and send subscribe command
      const subscribeCommand = apiSubscription.subscribe(command.params);
      
      this.messageManager.sendRequest(subscribeCommand, command.requestId, 10000)
        .then((result: any) => {
          // Extract subscriptionId from result
          const subscriptionId = result.subscriptionId;
          if (!subscriptionId) {
            this.postErrorReply(command.requestId, 'Subscribe reply missing subscriptionId', 'INVALID_REPLY');
            return;
          }
          
          // Register subscription with MessageManager for notification routing
          this.messageManager.registerSubscription(subscriptionId, command.internalId, apiSubscription);
          
          // Track subscriptionId -> internalId mapping
          this.subscriptions.set(subscriptionId, command.internalId);
          
          // Send success reply with subscriptionId
          this.postSuccessReply(command.requestId, { subscriptionId });
        })
        .catch((error: any) => {
          this.postErrorReply(command.requestId, error.message, 'SUBSCRIBE_FAILED');
        });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create subscription';
      this.postErrorReply(command.requestId, errorMessage, 'SUBSCRIPTION_CREATION_FAILED');
    }
  }

  private handleUnsubscribe(command: WorkerUnsubscribe): void {
    console.log(`PIApiWorker: Handling unsubscribe - subscriptionId: ${command.subscriptionId}`);
    
    const internalId = this.subscriptions.get(command.subscriptionId);
    if (!internalId) {
      console.warn(`PIApiWorker: Unknown subscriptionId: ${command.subscriptionId}`);
      this.postSuccessReply(command.requestId, {}); // Still send success
      return;
    }
    
    // Unregister from MessageManager
    this.messageManager.unregisterSubscription(command.subscriptionId);
    
    // Remove from local map
    this.subscriptions.delete(command.subscriptionId);
    
    // Send success reply
    this.postSuccessReply(command.requestId, {});
  }

  public onMessageManagerStateChange(state: IPiApiState): void {
    const response: WorkerStateChangedEvent = {
      state,
      type: WorkerEventType.STATE_CHANGED,
    };
    this.postToMainThread(response);
  }

  public onMessageManagerConnected(): void {
    console.log('PIApiWorker: MessageManager connected'); //TODO AI: Remove console.log from production code
    
    if (this.pendingConnectionRequest?.type === WorkerCommandType.CONNECT) {
      this.postSuccessReply(this.pendingConnectionRequest.requestId, undefined);
      this.pendingConnectionRequest = null;
    }
  }

  public onMessageManagerDisconnected(): void {
    console.log('PIApiWorker: MessageManager disconnected'); //TODO AI: Remove console.log from production code
    
    if (this.pendingConnectionRequest) {
      if (this.pendingConnectionRequest.type === WorkerCommandType.DISCONNECT) {
        // Expected disconnection - resolve the disconnect request
        this.postSuccessReply(this.pendingConnectionRequest.requestId, undefined);
      } else {
        // Unexpected disconnection during connect - reject the connect request
        this.postErrorReply(
          this.pendingConnectionRequest.requestId,
          'Connection failed - disconnected before establishing connection',
          'CONNECT_FAILED'
        );
      }
      this.pendingConnectionRequest = null;
    }
  }
}

// Auto-initialize when running in Web Worker context (like your current code)
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  const piApiWorker = new PIApiWorker();
  // TODO: AI: Type safety issue - avoid using 'as any' and polluting global scope. This is acceptable for 
  // debugging but should be removed or properly typed in production.
  (self as any).__piApiWorker = piApiWorker; // Export for debugging (similar to your current __websocketWorker export)
}
