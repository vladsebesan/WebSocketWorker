// Shared domain models for the PI API
// These are clean TypeScript interfaces that hide FlatBuffer complexity

export interface IPIApiConfig {
  maxReconnectAttempts: number;
  reconnectIntervalMs: number;
  sessionKeepaliveIntervalMs: number;
  url: string;
}

export interface IPIApiError {
  code: string;
  details?: unknown;
  message: string;
}

export interface IPIApiState {
  connectionState: PIApiConnectionState;
  lastError: IPIApiError | null;
  remainingReconnectAttempts: number;
  sessionId: null | string;
  sessionState: PIApiSessionState;
}

export enum PIApiConnectionState {
  CONNECTED = 'CONNECTED',
  CONNECTING = 'CONNECTING',
  DISCONNECTED = 'DISCONNECTED',
  ERROR = 'ERROR',
}

export enum PIApiSessionState {
  AUTHENTICATED = 'AUTHENTICATED',
  CREATING_SESSION = 'CREATING_SESSION',
  KEEPALIVE_FAILED = 'KEEPALIVE_FAILED',
  NO_SESSION = 'NO_SESSION',
}

// Subscription interface for notifications
export interface IPIApiSubscription {
  unsubscribe(): void;
}

export type IPIApiNotificationCallback<T> = (data: T) => void;
