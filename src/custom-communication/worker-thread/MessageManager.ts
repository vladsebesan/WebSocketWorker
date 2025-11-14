// MessageManager - Handles request/reply correlation and message parsing

import { Message, Reply, type ProcessInstanceMessageT } from '../../generated/process-instance-message-api';
import { makeUUID } from '../../utils/uuid';
import type { ISessionConfig, ISession, ISessionState} from './core/Session';

interface IPendingRequest {
  reject: (error: Error) => void;
  resolve: (data: unknown) => void;
  timeout: NodeJS.Timeout;
}

export interface IMessageManagerConfig extends ISessionConfig {}
export interface IMessageManagerState extends ISessionState {}

export interface IMessageManager {
  connect(config: ISessionConfig): void;
  disconnect(): void;
  send<T>(requestBuffer: Uint8Array): Promise<T>;
  onConnected: (() => void) | null;
  onDisconnected: (() => void) | null;
  onStateChanged: ((state: IMessageManagerState) => void) | null;
}

export class MessageManager implements IMessageManager {
  private pendingRequests = new Map<string, IPendingRequest>();
  private session!: ISession;
  public onConnected: (() => void) | null = null;
  public onDisconnected: (() => void) | null = null;
  public onStateChanged: ((state: IMessageManagerState) => void) | null = null;

  constructor(session: ISession) {
    this.session = session;    
  }

  public connect(config: ISessionConfig): void {
    if (!this.session) {
      throw new Error('Session is not initialized');
    }
    this.session.connect(config);
    this.session.onMessage = this.onSessionMessage.bind(this);
    this.session.onDisconnected = this.onSessionDisconnected.bind(this);
    this.session.onConnected = this.onSessionConnected.bind(this);
    this.session.onStateChanged = this.onSessionStateChanged.bind(this);
  }

  public disconnect(): void {
    this.cancelAllPendingRequests();
    if (this.session) {
      this.session.disconnect();
    }
  }

  private cancelAllPendingRequests(): void {
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
  }

  public send<T>(requestBuffer: Uint8Array): Promise<T> {

    if(!this.session) {
      return Promise.reject(new Error('Session is not initialized'));
    }

    const requestId = makeUUID();

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, 30000); // 30 second timeout

      this.pendingRequests.set(requestId, {
        reject,
        resolve: (data: unknown) => resolve(data as T),
        timeout,
      });

      // Send the request
      this.session!.send(requestBuffer);
    });
  }

  private onSessionMessage(message: ProcessInstanceMessageT): void {
    
    switch (message.messageType) {
      case Message.Notification:
        break;
      case Message.Reply:
        break;
      case Message.Request:
      case Message.TestCommand:
      case Message.UnknownCommand:
      default:
        console.log('MessageManager: Received unsupported message of type:', Message[message.messageType]);
        break;
    }
  }

  private onSessionDisconnected(): void {
    this.cancelAllPendingRequests();
    if (this.onDisconnected) {
      this.onDisconnected();
    }
  }

  private onSessionConnected(): void {
    if (this.onConnected) {
      this.onConnected();
    }
  }

  private onSessionStateChanged(state: ISessionState): void {
    if (this.onStateChanged) {
      this.onStateChanged(state);
    }
  }
}
