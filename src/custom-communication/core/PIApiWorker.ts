import type { IPiApiConfig, IPiApiState } from '../PiApi';
import { MessageManager } from './MessageManager';
import { Session } from './Session';
import { Transport } from './Transport';
import { Api } from '../PiRequests';

export enum WorkerCommandType {
  CONNECT = 'CONNECT',
  DISCONNECT = 'DISCONNECT',
  SEND_REQUEST = 'SEND_REQUEST',
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
  subscriptionId: string;
  type: WorkerEventType.NOTIFICATION;
}

export interface WorkerStateChangedEvent{
  state: IPiApiState;
  type: WorkerEventType.STATE_CHANGED;
}

export type WorkerCommand =
  | WorkerConnect
  | WorkerDisconnect
  | WorkerSendRequest;


export type WorkerEvent = 
  | WorkerReply<unknown>
  | WorkerNotification<unknown>
  | WorkerStateChangedEvent;

class PIApiWorker {
  private messageManager!: MessageManager;
  private pendingConnectionRequest: { requestId: string; type: WorkerCommandType.CONNECT | WorkerCommandType.DISCONNECT } | null = null;

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

  private onNotification(notification: any): void {
    console.log('PIApiWorker: Received notification from MessageManager');
    
    // Forward notification to main thread
    const response: WorkerNotification<any> = {
      data: notification,
      subscriptionId: '', // Will be extracted in PiApi from notification data
      type: WorkerEventType.NOTIFICATION,
    };
    this.postToMainThread(response);
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
