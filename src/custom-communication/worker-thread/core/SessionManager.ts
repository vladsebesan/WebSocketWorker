import type { ITransportLayer } from './TransportLayer';

import { makeRequestMessageBuffer, tryUnwrapReplyOfType } from './FbbMessages';
import { SessionCreateReplyT, SessionCreateT, SessionDestroyT, SessionKeepaliveReplyT, SessionKeepaliveT } from '../../../generated/process-instance-message-api';
import { makeUUID } from '../../../utils/uuid';

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

export class SessionManager {
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
  private keepaliveTimer: number | null = null;
  private keepaliveFailureCount: number = 0;
  private lastKeepaliveSentTime: number = 0;
  private reconnectTimer: number | null = null;
  private transportLayer: ITransportLayer;

  constructor(transportLayer: ITransportLayer) {
    this.transportLayer = transportLayer;
    this.transportLayer.onConnected = this.onTlConnected.bind(this);
    this.transportLayer.onDisconnected = this.onTlDisonnected.bind(this);
    this.transportLayer.onError = this.onTlError.bind(this);
    this.transportLayer.onMessage = this.onTlMessage.bind(this);
  }

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
    this.stopKeepaliveTimer();
    this.stopReconnectTimer();
    this.transportLayer.disconnect();
  };

  public onMessage: ((buffer: Uint8Array) => void) | null = null;

  public onConnected: (() => void) | null = null;

  public onDisconnected: (() => void) | null = null;

  public onStateChanged: ((state: ISessionState) => void) | null = null;

  private startKeepaliveTimer = (): void => {
    if (!this.config || this.keepaliveTimer !== null) return;

    this.keepaliveTimer = setInterval(() => {
      this.performKeepalive();
    }, this.config.sessionKeepaliveIntervalMs);

    console.log(`Keepalive timer started with ${this.config.sessionKeepaliveIntervalMs}ms interval`);
  };

  private stopKeepaliveTimer = (): void => {
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
      this.keepaliveFailureCount = 0;
      console.log('Keepalive timer stopped');
    }
  };

  private startReconnectTimer = (): void => {
    if (this.reconnectTimer !== null || this.state.reconnectAttemptsLeft <= 0) {
      return;
    }

    console.log(`Starting reconnect timer. Attempts left: ${this.state.reconnectAttemptsLeft}`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.attemptReconnect();
    }, this.config.reconnectIntervalMs);
  };  private stopReconnectTimer = (): void => {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      console.log('Reconnect timer stopped');
    }
  };

  private attemptReconnect = (): void => {
    if (this.state.reconnectAttemptsLeft <= 0) {
      console.log('No more reconnect attempts left');
      return;
    }

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
      console.log('Cannot trigger reconnection - invalid state or no attempts left');
      return;
    }

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

  onTlMessage = (buffer: Uint8Array): void => {
    if (this.handleSessionMessage(buffer)) return; //swallow session handling messages and
    if (this.onMessage) this.onMessage(buffer); //forward other messages
  };

  sendSessionCreate = (): void => {
    const sessionId = makeUUID() + 'new session'; //PI might override this
    const reqId = makeUUID();
    const buff = makeRequestMessageBuffer(new SessionCreateT(), reqId, sessionId);
    this.transportLayer.send(buff); // Placeholder for actual session creation message
  };

  sendSessionDestroy = (): void => {
    const reqId = makeUUID();
    const sessionDestroyReq = makeRequestMessageBuffer(new SessionDestroyT(), reqId, this.state.sessionId!);
    this.transportLayer.send(sessionDestroyReq); // Placeholder for actual session destruction message
  };

  sendSessionKeepalive = (): void => {
    if (!this.state.sessionId) return;
    
    const reqId = makeUUID();
    const buff = makeRequestMessageBuffer(new SessionKeepaliveT(), reqId, this.state.sessionId);
    this.transportLayer.send(buff); // Placeholder for actual session keepalive message
    console.log('Keepalive message sent');
  };

  handleSessionMessage(buffer: Uint8Array): boolean {
    this.lastReceivedMessageTime = Date.now();
    
    {
      const res = tryUnwrapReplyOfType(buffer, SessionCreateReplyT);
      if (res?.payload instanceof SessionCreateReplyT) {
        this.keepaliveFailureCount = 0; // Reset failure count on successful session creation
        this.stopReconnectTimer(); // Stop any pending reconnection attempts
        this.updateState({
          reconnectAttemptsLeft: this.config.maxReconnectAttempts, // Reset to full attempts on successful connection
          sessionId: res.sessionId,
          sessionState: SessionState.CONNECTED,
        });
        
        // Start keepalive timer when session is connected
        this.startKeepaliveTimer();
        
        if (this.onConnected) {
          this.onConnected();
        }
        
        return true;
      }
    }

    {
      const res = tryUnwrapReplyOfType(buffer, SessionKeepaliveReplyT);
      if (res?.payload instanceof SessionKeepaliveReplyT) {
        this.keepaliveFailureCount = 0; // Reset failure count on successful keepalive response
        this.updateState({
          reconnectAttemptsLeft: this.config.maxReconnectAttempts, // Reset to full attempts on successful keepalive
          sessionId: res.sessionId,
          sessionState: SessionState.CONNECTED,
        });
        console.log('Keepalive response received');
        return true;
      }
    }

    return false;
  }

  updateState(newState: ISessionState) {
    const hasChanged =
      newState.sessionId !== this.state.sessionId ||
      newState.sessionState !== this.state.sessionState ||
      newState.reconnectAttemptsLeft !== this.state.reconnectAttemptsLeft;

    if (hasChanged) {
      this.state = newState;
      console.log('SessionManager state updated:', this.state);
      
      // Notify state change listeners
      if (this.onStateChanged) {
        this.onStateChanged({ ...this.state });
      }
    }
  }
}
