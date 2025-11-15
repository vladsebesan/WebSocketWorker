import type { ITransport } from './Transport';

import { makeRequestMessageBuffer, tryUnwrapNotification, tryUnwrapPiMessageBuffer, tryUnwrapReply } from './FbbMessages';
import { Message, NotificationT, ReplyMessage, ReplyT, SessionCreateT, SessionDestroyT, SessionKeepaliveT } from '../../generated/process-instance-message-api';
import { makeUUID } from '../../utils/uuid';

export enum SessionState {
  CONNECTED = 'CONNECTED',
  CONNECTING = 'CONNECTING',
  DISCONNECTED = 'DISCONNECTED',
  ERROR = 'ERROR',
  SESSION_INIT = 'SESSION_INIT',
  SESSION_KEEPALIVE_FAILED = 'SESSION_KEEPALIVE_FAILED',
}

export interface ISessionConfig {
  maxReconnectAttempts: number;
  reconnectIntervalMs: number;
  sessionKeepaliveIntervalMs: number;
  maxKeepaliveFailures: number; // Add optional maxKeepaliveFailures
  url: string;
}

export interface ISessionState {
  reconnectAttemptsLeft: number;
  sessionId: null | string;
  sessionState: SessionState;
}

export interface ISession {
  connect: (config: ISessionConfig) => void;
  disconnect: () => void;
  onMessage: ((message: NotificationT | ReplyT) => void) | null;
  onConnected: (() => void) | null;
  onDisconnected: (() => void) | null;
  onStateChanged: ((state: ISessionState) => void) | null;
  send: (buffer: Uint8Array) => void;
  readonly sessionId: string | null;
}

export class Session implements ISession {
  private state: ISessionState = {
    reconnectAttemptsLeft: 0,
    sessionId: null,
    sessionState: SessionState.DISCONNECTED,
  };
  private config: ISessionConfig = {
    maxReconnectAttempts: 3, // upon disconnection, try to reconnect 3 times
    reconnectIntervalMs: 1000, //wait 1 second between reconnect attempts
    sessionKeepaliveIntervalMs: 1000, // keepalive is sent if there is silence for 1 second
    maxKeepaliveFailures: 3, // tolerate three keepalive failures before disconnecting
    url: '', //ws url
  };
  private lastReceivedMessageTime = 0;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private keepaliveFailureCount: number = 0;
  private lastKeepaliveSentTime: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private transportLayer: ITransport;

  constructor(transportLayer: ITransport) {
    this.transportLayer = transportLayer;
    this.transportLayer.onConnected = this.onTlConnected.bind(this);
    this.transportLayer.onDisconnected = this.onTlDisonnected.bind(this);
    this.transportLayer.onError = this.onTlError.bind(this);
    this.transportLayer.onMessage = this.onTlMessage.bind(this);
  }

  public onMessage: ((message: NotificationT | ReplyT) => void) | null = null;
  public onConnected: (() => void) | null = null;
  public onDisconnected: (() => void) | null = null;
  public onStateChanged: ((state: ISessionState) => void) | null = null;

  public connect = (config: ISessionConfig): void => {
    this.config = {
      ...this.config,  // Use existing defaults
      ...config        // Override with provided config
    };
   
    this.updateState({
      reconnectAttemptsLeft: this.config.maxReconnectAttempts,
      sessionId: null,
      sessionState: SessionState.CONNECTING,
    });
    this.transportLayer.connect(this.config.url);
  };

  public disconnect = (): void => {
    // Only send session destroy if we have an active session
    if (this.state.sessionId && this.state.sessionState === SessionState.CONNECTED) {
      this.sendSessionDestroy();
    }
    this.stopKeepaliveTimer();
    this.stopReconnectTimer();
    this.transportLayer.disconnect();
    if (this.onDisconnected) {
      this.onDisconnected();
    }
  };

  public send = (buffer: Uint8Array): void => {
    this.transportLayer.send(buffer);
  }

  public get sessionId(): string | null {
    return this.state.sessionId;
  }

  private startKeepaliveTimer = (): void => {
    if (!this.config || this.keepaliveTimer !== null) return;

    // TODO: AI: PERFORMANCE ISSUE - Using setInterval for keepalive runs continuously even when messages are 
    // actively flowing. This is wasteful - should use setTimeout and reschedule only when needed based on 
    // actual message activity. Current implementation checks conditions inside the interval callback, but the 
    // interval itself runs forever.
    this.keepaliveTimer = setInterval(() => {
      this.performKeepalive();
    }, this.config.sessionKeepaliveIntervalMs);

    // TODO: AI: Remove console.log from production code
    console.log(`Keepalive timer started with ${this.config.sessionKeepaliveIntervalMs}ms interval`);
  };

  private stopKeepaliveTimer = (): void => {
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
      this.keepaliveFailureCount = 0;
      // TODO: AI: Remove console.log from production code
      console.log('Keepalive timer stopped');
    }
  };

  private startReconnectTimer = (): void => {
    if (this.reconnectTimer !== null || this.state.reconnectAttemptsLeft <= 0) {
      return;
    }

    // TODO: AI: Remove console.log from production code
    console.log(`Starting reconnect timer. Attempts left: ${this.state.reconnectAttemptsLeft}`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.attemptReconnect();
    }, this.config.reconnectIntervalMs);
  };  
  
  private stopReconnectTimer = (): void => {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      // TODO: AI: Remove console.log from production code
      console.log('Reconnect timer stopped');
    }
  };

  private attemptReconnect = (): void => {
    if (this.state.reconnectAttemptsLeft <= 0) {
      // TODO: AI: Remove console.log from production code
      console.log('No more reconnect attempts left');
      return;
    }

    // TODO: AI: Remove console.log from production code
    console.log(`Attempting reconnect. Attempts left: ${this.state.reconnectAttemptsLeft}`);
    
    this.updateState({
      reconnectAttemptsLeft: this.state.reconnectAttemptsLeft - 1,
      sessionId: null,
      sessionState: SessionState.CONNECTING,
    });

    this.transportLayer.connect(this.config.url);
  };

  private triggerReconnectionFromKeepaliveFailure = (): void => {
    if (this.state.sessionState !== SessionState.SESSION_KEEPALIVE_FAILED || this.state.reconnectAttemptsLeft <= 0) {
      // TODO: AI: Remove console.log from production code
      console.log('Cannot trigger reconnection - invalid state or no attempts left');
      return;
    }

    // TODO: AI: Remove console.log from production code
    console.log('Triggering immediate reconnection from keepalive failure');
    
    // Set state to CONNECTING and start reconnection
    this.updateState({
      reconnectAttemptsLeft: this.state.reconnectAttemptsLeft - 1,
      sessionId: null,
      sessionState: SessionState.CONNECTING,
    });

    // Attempt to connect immediately
    this.transportLayer.connect(this.config.url);
  };

  private performKeepalive = (): void => {
    if (this.state.sessionState !== SessionState.CONNECTED || !this.state.sessionId) {
      return;
    }

    const now = Date.now();
    const timeSinceLastMessage = now - this.lastReceivedMessageTime;
    const timeSinceLastKeepalive = now - this.lastKeepaliveSentTime;

    // Only send keepalive if we haven't received any message recently
    // and haven't sent a keepalive too recently
    if (timeSinceLastMessage >= this.config!.sessionKeepaliveIntervalMs &&
        timeSinceLastKeepalive >= this.config!.sessionKeepaliveIntervalMs) {
      
      this.sendSessionKeepalive();
      this.lastKeepaliveSentTime = now;
      
      // Check for keepalive timeout
      const maxFailures = this.config!.maxKeepaliveFailures ?? 3;
      if (this.keepaliveFailureCount >= maxFailures) {
        // TODO: AI: Remove console.error from production code - use proper error reporting
        console.error(`Keepalive failed ${this.keepaliveFailureCount} times, triggering reconnection`);
        this.stopKeepaliveTimer();
        
        // Notify that session is effectively disconnected due to keepalive failure
        if (this.onDisconnected) {
          this.onDisconnected();
        }
        
        // Update state to indicate keepalive failure and prepare for reconnection
        this.updateState({
          reconnectAttemptsLeft: this.config.maxReconnectAttempts, // Always reset to full attempts on keepalive failure
          sessionId: null,
          sessionState: SessionState.SESSION_KEEPALIVE_FAILED,
        });
        
        // Force disconnect and immediately start reconnection process
        this.transportLayer.disconnect();
        
        // Immediately trigger reconnection without waiting for onTlDisconnected
        setTimeout(() => {
          this.triggerReconnectionFromKeepaliveFailure();
        }, 100); // Small delay to ensure disconnect completes
        
        return;
      }

      // Increment failure count - will be reset when we receive a response
      this.keepaliveFailureCount++;
    }
  };

  onTlConnected = (): void => {
    this.stopReconnectTimer(); // Stop reconnection timer since we're now connected
    this.updateState({
      reconnectAttemptsLeft: this.state.reconnectAttemptsLeft, // Preserve current attempts count
      sessionId: null,
      sessionState: SessionState.SESSION_INIT,
    });
    this.sendSessionCreate();
  };

  onTlDisonnected = (): void => {
    this.stopKeepaliveTimer();
    
    // Only attempt reconnection if we have attempts left and we were previously connected/connecting
    const shouldReconnect = this.state.reconnectAttemptsLeft > 0 && 
      (this.state.sessionState === SessionState.CONNECTED || 
       this.state.sessionState === SessionState.SESSION_INIT ||
       this.state.sessionState === SessionState.CONNECTING ||
       this.state.sessionState === SessionState.SESSION_KEEPALIVE_FAILED);

    if (shouldReconnect) {
      this.updateState({
        reconnectAttemptsLeft: this.state.reconnectAttemptsLeft,
        sessionId: null,
        sessionState: SessionState.CONNECTING,
      });
      this.startReconnectTimer();
    } else {
      this.stopReconnectTimer();
      this.updateState({
        reconnectAttemptsLeft: 0,
        sessionId: null,
        sessionState: SessionState.DISCONNECTED,
      });
      console.log('All reconnection attempts exhausted, session disconnected');
      if (this.onDisconnected) {
        this.onDisconnected();
      }
    }
  };

  onTlError = (): void => {
    this.stopKeepaliveTimer();
    
    // Attempt reconnection on error if we have attempts left
    if (this.state.reconnectAttemptsLeft > 0) {
      this.updateState({
        reconnectAttemptsLeft: this.state.reconnectAttemptsLeft,
        sessionId: null,
        sessionState: SessionState.CONNECTING,
      });
      this.startReconnectTimer();
    } else {
      this.updateState({
        reconnectAttemptsLeft: 0,
        sessionId: null,
        sessionState: SessionState.ERROR,
      });
    }
  };

  private validateSessionId = (message: ReplyT | NotificationT): boolean => {
    return message.sessionId !== null && this.state.sessionId !== null && message.sessionId === this.state.sessionId;
  }

  onTlMessage = (buffer: Uint8Array): void => {
    // we've received a message, so communication is still alive
    this.lastReceivedMessageTime = Date.now();

    const piMessage = tryUnwrapPiMessageBuffer(buffer);
    if(piMessage === null) {
      console.error('Failed to unwrap incoming message buffer');
      return;
    }

    switch (piMessage.messageType) {
      case Message.Reply:
        {
          // 1. check for illformed reply
          const reply = tryUnwrapReply(piMessage);
          if (!reply) {
            break;
          }

          // 3.1. handle session-related replies internally
          if(reply.messageType === ReplyMessage.SessionCreateReply) {
            this.keepaliveFailureCount = 0; // Reset failure count on successful keepalive response
            this.updateState({
              reconnectAttemptsLeft: this.config.maxReconnectAttempts, // Reset to full attempts on successful keepalive
              sessionId: reply.sessionId!.toString(),
              sessionState: SessionState.CONNECTED,
            });
            this.startKeepaliveTimer(); // Start keepalive timer when session is connected
            this.onConnected?.(); //Notify about successful connection
            return;
          // 3.2. handle session-related replies internally
          } else if(reply.messageType === ReplyMessage.SessionKeepaliveReply) {
            this.keepaliveFailureCount = 0; // Reset failure count on successful session creation
            this.stopReconnectTimer(); // Stop any pending reconnection attempts
            this.updateState({
              reconnectAttemptsLeft: this.config.maxReconnectAttempts, // Reset to full attempts on successful connection
              sessionId: reply.sessionId!.toString(),
              sessionState: SessionState.CONNECTED,
            });
            return;
          } 
          // 3.3. forward all other replies to onMessage handler
          else {
            // 2. sessions must match before we proceed
            if (!this.validateSessionId(reply)) {
              console.warn(`Received reply with mismatched sessionId. Expected: ${this.state.sessionId}, Received: ${reply.sessionId}`);
              return;
            }
            this.onMessage?.(reply);
          }
        }
        break;
      case Message.Notification:
        {
          // 1. check for illformed notification
          const notif = tryUnwrapNotification(piMessage);
          if (!notif) {
            console.warn('Received malformed notification message');
            return;
          }

          // 2. sessions must match before we proceed
          if (!this.validateSessionId(notif)) {
            console.warn(`Received reply with mismatched sessionId. Expected: ${this.state.sessionId}, Received: ${notif.sessionId}`);
            return;
          }

          this.onMessage?.(notif);
        }
        break;
      default:
        console.warn('Received unsupported message type:', Message[piMessage.messageType]);
        return;
    }
  };

  sendSessionCreate = (): void => {
    const sessionId = '@worker_session_' + makeUUID();
    const reqId = makeUUID();
    const buff = makeRequestMessageBuffer(new SessionCreateT(), reqId, sessionId);
    this.transportLayer.send(buff); // Placeholder for actual session creation message
  };

  sendSessionDestroy = (): void => {
    if (!this.state.sessionId) return;
    const reqId = makeUUID();
    const sessionDestroyReq = makeRequestMessageBuffer(new SessionDestroyT(), reqId, this.state.sessionId);
    this.transportLayer.send(sessionDestroyReq); // Placeholder for actual session destruction message
  };

  sendSessionKeepalive = (): void => {
    if (!this.state.sessionId) return;
    
    const reqId = makeUUID();
    const buff = makeRequestMessageBuffer(new SessionKeepaliveT(), reqId, this.state.sessionId);
    this.transportLayer.send(buff); // Placeholder for actual session keepalive message
    //console.log('Keepalive message sent');
  };

  updateState(newState: ISessionState) {
    const hasChanged =
      newState.sessionId !== this.state.sessionId ||
      newState.sessionState !== this.state.sessionState ||
      newState.reconnectAttemptsLeft !== this.state.reconnectAttemptsLeft;

    if (hasChanged) {
      this.state = newState;
      console.log('SessionManager state updated:', this.state);
      if (this.onStateChanged) {
        this.onStateChanged({ ...this.state });
      }
    }
  }
}

