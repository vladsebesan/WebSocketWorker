import { NotificationMessage, NotificationT, ReplyT } from '../../generated/process-instance-message-api';
import type { ISessionConfig, ISession, ISessionState} from './Session';
import type { IApiCommand, IApiSubscription } from './IApiInterfaces';

interface IPendingRequest {
  reject: (error: Error) => void;
  resolve: (data: unknown) => void;
  timeout: NodeJS.Timeout;
  parseReply: (reply: ReplyT) => any;
}

interface IActiveSubscription {
  subscriptionId: string;
  internalId: string;
  apiSubscription: IApiSubscription<any, any, any>;
  parseNotification: (notification: NotificationT) => any;
}

export interface IMessageManagerConfig extends ISessionConfig {}

export interface IMessageManagerState extends ISessionState {}

export interface IMessageManager {
  connect(config: ISessionConfig): void;
  disconnect(): void;
  sendRequest<TParams, TResult>(command: IApiCommand<TParams, TResult>, requestId: string, timeoutMs: number): Promise<TResult>;
  registerSubscription(subscriptionId: string, internalId: string, apiSubscription: IApiSubscription<any, any, any>): void;
  unregisterSubscription(subscriptionId: string): void;
  onConnected: (() => void) | null;
  onDisconnected: (() => void) | null;
  onStateChanged: ((state: IMessageManagerState) => void) | null;
  onNotification: ((internalId: string, deserializedData: any) => void) | null;
}

export class MessageManager implements IMessageManager {
  private pendingRequests = new Map<string, IPendingRequest>();
  private subscriptions = new Map<string, IActiveSubscription>(); // Map<subscriptionId, IActiveSubscription>
  private session!: ISession;
  public onConnected: (() => void) | null = null;
  public onDisconnected: (() => void) | null = null;
  public onStateChanged: ((state: IMessageManagerState) => void) | null = null;
  public onNotification: ((internalId: string, deserializedData: any) => void) | null = null;

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

  private onSessionMessage(message: NotificationT | ReplyT): void {
    
    if(message instanceof ReplyT) {
      if (message.requestId) {
        const requestId = message.requestId.toString();
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          this.pendingRequests.delete(requestId);
          const result = pending.parseReply(message);               // Use command-specific parser
          if (result !== null) {
            pending.resolve(result);
          } else {
            pending.reject(new Error('Failed to parse command reply'));
          }
        }
      }
    }
    else if(message instanceof NotificationT) {
      // Deserialize notification and forward to subscription callback
      console.log(`MessageManager: Received notification of type: ${NotificationMessage[message.messageType]} with sessionId:`, message.sessionId);
      
      // Extract subscriptionId from notification (assuming backend includes it)
      // For now, use sessionId as placeholder for subscriptionId
      const subscriptionId = message.sessionId?.toString() || '';
      
      const subscription = this.subscriptions.get(subscriptionId);
      if (subscription) {
        try {
          // Deserialize notification using subscription's deserializer
          const deserializedData = subscription.parseNotification(message);
          if (deserializedData && this.onNotification) {
            // Forward deserialized data with internalId to PIApiWorker
            this.onNotification(subscription.internalId, deserializedData);
          } else if (!deserializedData) {
            console.warn(`MessageManager: Failed to deserialize notification for subscription ${subscriptionId}`);
          }
        } catch (error) {
          console.error(`MessageManager: Error deserializing notification for subscription ${subscriptionId}:`, error);
        }
      } else {
        console.warn(`MessageManager: Received notification for unknown subscriptionId: ${subscriptionId}`);
      }
    } else {
      console.log('MessageManager: Received unsupported message of type:', message);
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

  public registerSubscription(subscriptionId: string, internalId: string, apiSubscription: IApiSubscription<any, any, any>): void {
    console.log(`MessageManager: Registering subscription - subscriptionId: ${subscriptionId}, internalId: ${internalId}`);
    this.subscriptions.set(subscriptionId, {
      subscriptionId,
      internalId,
      apiSubscription,
      parseNotification: apiSubscription.deserialize.bind(apiSubscription),
    });
  }

  public unregisterSubscription(subscriptionId: string): void {
    console.log(`MessageManager: Unregistering subscription - subscriptionId: ${subscriptionId}`);
    this.subscriptions.delete(subscriptionId);
  }
}
