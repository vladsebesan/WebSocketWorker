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
  url: string;
}

export interface ISessionState {
  reconnectAttemptsLeft: number;
  sessionId: null | string;
  sessionState: SessionState;
}

export class SessionManager {
  private config: ISessionConfig | null = null;
  private lastReceivedMessageTime = 0;
  private state: ISessionState = {
    reconnectAttemptsLeft: 0,
    sessionId: null,
    sessionState: SessionState.DISCONNECTED,
  };
  private transportLayer: ITransportLayer;

  public connect = (config: ISessionConfig): void => {
    this.config = config;
    this.updateState({
      reconnectAttemptsLeft: config.maxReconnectAttempts,
      sessionId: null,
      sessionState: SessionState.CONNECTING,
    });
    this.transportLayer.connect(this.config.url);
  };

  public disconnect = (): void => {
    this.transportLayer.disconnect();
  };

  public onMessageReceived: ((buffer: Uint8Array) => void) | null = null;

  public onSessionConnected: (() => void) | null = null;

  public onSessionDisconnected: (() => void) | null = null;

  onTlConnected = (): void => {
    this.updateState({
      reconnectAttemptsLeft: this.config!.maxReconnectAttempts,
      sessionId: null,
      sessionState: SessionState.SESSION_INIT,
    });
    this.sendSessionCreate();
  };

  onTlDisonnected = (): void => {
    this.updateState({
      reconnectAttemptsLeft: 0,
      sessionId: null,
      sessionState: SessionState.DISCONNECTED,
    });
  };

  onTlError = (): void => {
    const newState = {
      reconnectAttemptsLeft: this.state.reconnectAttemptsLeft,
      sessionId: null,
      sessionState: SessionState.ERROR,
    };
    this.updateState(newState);
  };

  onTlMessage = (buffer: Uint8Array): void => {
    if (this.handleSessionMessage(buffer)) return; //swallow session handling messages and
    if (this.onMessageReceived) this.onMessageReceived(buffer); //forward other messages
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
    const reqId = makeUUID();
    const buff = makeRequestMessageBuffer(new SessionKeepaliveT(), reqId, this.state.sessionId!);
    this.transportLayer.send(buff); // Placeholder for actual session keepalive message
  };

  constructor(transportLayer: ITransportLayer) {
    this.transportLayer = transportLayer;
    this.transportLayer.onConnected = this.onTlConnected.bind(this);
    this.transportLayer.onDisconnected = this.onTlDisonnected.bind(this);
    this.transportLayer.onError = this.onTlError.bind(this);
    this.transportLayer.onMessage = this.onTlMessage.bind(this);
  }

  handleSessionMessage(buffer: Uint8Array): boolean {
    this.lastReceivedMessageTime = Date.now();
    {
      const res = tryUnwrapReplyOfType(buffer, SessionCreateReplyT);
      if (res?.payload instanceof SessionCreateReplyT) {
        this.updateState({
          reconnectAttemptsLeft: 0,
          sessionId: res.sessionId,
          sessionState: SessionState.CONNECTED,
        });
        return true;
      }
    }

    {
      const res = tryUnwrapReplyOfType(buffer, SessionKeepaliveReplyT);
      if (res?.payload instanceof SessionKeepaliveReplyT) {
        this.updateState({
          reconnectAttemptsLeft: 0,
          sessionId: res.sessionId,
          sessionState: SessionState.CONNECTED,
        });
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
      //notify further
    }
  }
}
