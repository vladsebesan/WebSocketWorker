import type { IPiApiConfig, IPiApiState } from '../PiApi';
import { MessageManager } from './MessageManager';
import { Session, SessionState } from './Session';
import { Transport } from './Transport';
import { Api } from './Api';

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
  
  constructor() {
    this.messageManager = new MessageManager(new Session(new Transport()));
    this.messageManager.onStateChanged = this.onMessageManagerStateChange.bind(this);
    self.addEventListener('message', this.recvFromMainThread);
  }

  private resolvePromise(request: WorkerConnect | WorkerDisconnect) {

    let transitionalStates: SessionState[] = [];
    let expectedState: SessionState;
    
    if(request.type === WorkerCommandType.CONNECT) {
      transitionalStates.push(SessionState.CONNECTING, SessionState.SESSION_INIT);
      expectedState = SessionState.CONNECTED;
    }
    else {
      expectedState = SessionState.DISCONNECTED;
    }

    this.messageManager.onStateChanged = (state) => {
      //1. Notify main thread of all state changes
      this.onMessageManagerStateChange(state); 

      //2. Handle connection promise resolution (ignoring transitional states)
      if(transitionalStates.includes(state.sessionState)) {
        return;  // Still in transitional state, do nothing
      }
      //3. No more in expected transitional states, now we should be either in the expected state or a failure state
      //or there is a failure
      if(state.sessionState === expectedState) {
        this.postSuccessReply(request.requestId, undefined);
      }
      else {
        const errorMessage = `Failed to ${request.type === WorkerCommandType.CONNECT ? 'connect' : 'disconnect'}. Current state: ${SessionState[state.sessionState]}`;
        const errorCode = 'COMM_ERROR';
        this.postErrorReply(request.requestId, errorMessage, errorCode);
      }
      //4. Restore normal state change handling
      this.messageManager.onStateChanged = this.onMessageManagerStateChange.bind(this);
    }
  }

  private recvFromMainThread = (event: MessageEvent): void => {
    const command = event.data as WorkerCommand;
    switch (command.type) {
      case WorkerCommandType.CONNECT:
        {
          const connect = command as WorkerConnect;
          this.resolvePromise(connect); //hijack session state notifications until connected
          this.messageManager.connect(connect.config);
        }
        break;
      case WorkerCommandType.DISCONNECT:
        {
          const disconnect = command as WorkerDisconnect;
          this.resolvePromise(disconnect); //hijack session state notifications until connected
          this.messageManager.disconnect();
        }
        break;
      case WorkerCommandType.SEND_REQUEST:
        {
          const sendRequest = command as WorkerSendRequest;
          try {            
            const apiCommand = Api.createCommandFromTransfer(sendRequest.commandType, sendRequest.params);

            //TODO do we need a promise here?
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

    console.log('Posting success reply:', response);

    this.postToMainThread(response);
  }

  private postToMainThread(response: WorkerEvent): void {
    self.postMessage(response);
  }

  public sendNotification<T>(notificationType: WorkerEventType, data: T): void {
    const response = {
      data,
      type: notificationType,
    };
    this.postToMainThread(response as WorkerNotification<void>);
  }

  public onMessageManagerStateChange(state: IPiApiState): void {
    const response: WorkerStateChangedEvent = {
      state,
      type: WorkerEventType.STATE_CHANGED,
    };
    this.postToMainThread(response);
  }
}

// Auto-initialize when running in Web Worker context (like your current code)
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  const piApiWorker = new PIApiWorker();
  (self as any).__piApiWorker = piApiWorker; // Export for debugging (similar to your current __websocketWorker export)
}
