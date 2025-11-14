import { Message, ProcessInstanceMessageT, ReplyT } from '../../generated/process-instance-message-api';
import type { ISessionConfig, ISession, ISessionState} from './Session';
import {  tryUnwrapReply } from './FbbMessages';
import type { IApiCommand } from '../IApiDefinition';

interface IPendingRequest {
  reject: (error: Error) => void;
  resolve: (data: unknown) => void;
  timeout: NodeJS.Timeout;
  parseReply: (reply: ReplyT) => any;
}

export interface IMessageManagerConfig extends ISessionConfig {}

export interface IMessageManagerState extends ISessionState {}

export interface IMessageManager {
  connect(config: ISessionConfig): void;
  disconnect(): void;
  sendRequest<TParams, TResult>(command: IApiCommand<TParams, TResult>, requestId: string, timeoutMs: number): Promise<TResult>;
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

  public connect(config: IMessageManagerConfig): void {
    if (!this.session) {
      throw new Error('Session is not initialized');
    }
    this.session.onMessage = this.onSessionMessage.bind(this);
    this.session.onDisconnected = this.onSessionDisconnected.bind(this);
    this.session.onConnected = this.onSessionConnected.bind(this);
    this.session.onStateChanged = this.onSessionStateChanged.bind(this);
    this.session.connect(config);
  }

  public disconnect(): void {
    this.cancelAllPendingRequests();
    if (this.session) {
      this.session.disconnect();
    }
  }

  public async sendRequest<TParams, TResult>(
    command: IApiCommand<TParams, TResult>, 
    requestId: string,
    timeoutMs: number
  ): Promise<TResult> {
    const sessionId = this.session.sessionId || 'unknown';
    const requestBuffer = command.serialize(requestId, sessionId);
    const parseReply = command.deserialize.bind(command);

    return new Promise<TResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Command ${command.commandType} timed out`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: (data: any) => {
          clearTimeout(timeout);
          resolve(data as TResult);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        },
        timeout,
        parseReply: parseReply
      });

      this.session.send(requestBuffer);
    });
  }

  private cancelAllPendingRequests(): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
  }

  private onSessionMessage(message: ProcessInstanceMessageT): void {   
    switch (message.messageType) {
      case Message.Reply:
        const reply = tryUnwrapReply(message);
        if (reply?.requestId) {
          const requestId = reply.requestId.toString();
          const pending = this.pendingRequests.get(requestId);
          if (pending) {
            this.pendingRequests.delete(requestId);
            const result = pending.parseReply(reply);               // Use command-specific parser
            if (result !== null) {
              pending.resolve(result);
            } else {
              pending.reject(new Error('Failed to parse command reply'));
            }
          }
        }
        break;
      case Message.Notification:
        // Handle notifications
        break;
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
