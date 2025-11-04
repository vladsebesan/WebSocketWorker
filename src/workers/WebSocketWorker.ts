export const WebSocketWorkerMessageType = {
  // Commands from main thread to worker
  CONNECT: 'CONNECT',
  DISCONNECT: 'DISCONNECT',
  SEND_MESSAGE: 'SEND_MESSAGE',
  
  // Events from worker to main thread
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
  ERROR: 'ERROR',
  CONNECTION_STATE_CHANGED: 'CONNECTION_STATE_CHANGED'
} as const;

export type WebSocketWorkerMessageType = typeof WebSocketWorkerMessageType[keyof typeof WebSocketWorkerMessageType];

export const WebSocketState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
} as const;

export type WebSocketState = typeof WebSocketState[keyof typeof WebSocketState];

// Message structure for communication between main thread and worker
export interface WebSocketWorkerMessage {
  id: string;
  type: WebSocketWorkerMessageType;
  payload?: any;
  timestamp: number;
}

// Commands sent from main thread to worker
export interface ConnectCommand {
  type: 'CONNECT';
  payload: {
    url: string;
    protocols?: string[];
    options?: {
      reconnect?: boolean;
      reconnectInterval?: number;
      maxReconnectAttempts?: number;
    };
  };
}

export interface DisconnectCommand {
  type: 'DISCONNECT';
  payload?: {
    code?: number;
    reason?: string;
  };
}

export interface SendMessageCommand {
  type: 'SEND_MESSAGE';
  payload: {
    data: string | ArrayBuffer | Blob;
  };
}

// Events sent from worker to main thread
export interface ConnectedEvent {
  type: 'CONNECTED';
  payload: {
    url: string;
    readyState: WebSocketState;
  };
}

export interface DisconnectedEvent {
  type: 'DISCONNECTED';
  payload: {
    code: number;
    reason: string;
    wasClean: boolean;
  };
}

export interface MessageReceivedEvent {
  type: 'MESSAGE_RECEIVED';
  payload: {
    data: any;
    origin: string;
  };
}

export interface WebSocketErrorEvent {
  type: 'ERROR';
  payload: {
    error: string;
    code?: number;
  };
}

export interface ConnectionStateChangedEvent {
  type: 'CONNECTION_STATE_CHANGED';
  payload: {
    state: WebSocketState;
    previousState: WebSocketState;
  };
}

// Union type for all possible worker messages
export type WebSocketWorkerCommand = ConnectCommand | DisconnectCommand | SendMessageCommand;
export type WebSocketWorkerEvent = ConnectedEvent | DisconnectedEvent | MessageReceivedEvent | WebSocketErrorEvent | ConnectionStateChangedEvent;

// Configuration for WebSocket connection
export interface WebSocketConfig {
  url: string;
  protocols?: string[];
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

// Status interface for the WebSocket connection
export interface WebSocketStatus {
  connected: boolean;
  connecting: boolean;
  reconnecting: boolean;
  readyState: WebSocketState;
  url: string | null;
  reconnectAttempts: number;
  lastError: string | null;
}

/**
 * WebSocketWorkerClient provides an interface to communicate with the WebSocket Worker
 * from the main thread. It handles worker lifecycle, message passing, and event handling.
 */
export class WebSocketWorker {
  private worker: Worker | null = null;
  private messageHandlers: Map<string, (event: WebSocketWorkerEvent) => void> = new Map();
  private eventListeners: Map<string, Set<(event: WebSocketWorkerEvent) => void>> = new Map();
  private status: WebSocketStatus = {
    connected: false,
    connecting: false,
    reconnecting: false,
    readyState: WebSocketState.CLOSED,
    url: null,
    reconnectAttempts: 0,
    lastError: null
  };

  constructor() {
    const workerUrl = new URL('/src/workers/WebSocketWorkerImpl.js', import.meta.url);
    this.handleWorkerMessage = this.handleWorkerMessage.bind(this);
    this.handleWorkerError = this.handleWorkerError.bind(this);    
    this.initWorker(workerUrl);
  }

  /**
   * Initialize the Web Worker
   */
  private initWorker(workerUrl: string | URL): void {
    if (this.worker) {
      this.terminateWorker();
    }

    try {
      this.worker = new Worker(workerUrl, { type: 'module' });
      this.worker.addEventListener('message', this.handleWorkerMessage);
      this.worker.addEventListener('error', this.handleWorkerError);
    } catch (error) {
      throw new Error(`Failed to create worker: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Terminate the Web Worker
   */
  public terminateWorker(): void {
    if (this.worker) {
      this.worker.removeEventListener('message', this.handleWorkerMessage);
      this.worker.removeEventListener('error', this.handleWorkerError);
      this.worker.terminate();
      this.worker = null;
    }
    
    this.messageHandlers.clear();
    this.resetStatus();
  }

  /**
   * Connect to WebSocket server
   */
  public async connect(config: WebSocketConfig): Promise<void> {
    if (!this.worker) {
      throw new Error('Worker not initialized. Call initWorker() first.');
    }

    return new Promise((resolve, reject) => {
      const connectCommand: ConnectCommand = {
        type: 'CONNECT',
        payload: {
          url: config.url,
          protocols: config.protocols,
          options: {
            reconnect: config.reconnect,
            reconnectInterval: config.reconnectInterval,
            maxReconnectAttempts: config.maxReconnectAttempts
          }
        }
      };

      // Handle connection result
      const handleConnectionResult = (event: WebSocketWorkerEvent) => {
        if (event.type === 'CONNECTED') {
          this.updateStatus({ connected: true, connecting: false });
          resolve();
        } else if (event.type === 'ERROR') {
          this.updateStatus({ connecting: false, lastError: event.payload.error });
          reject(new Error(event.payload.error));
        }
      };

      // Set up one-time handlers
      this.once('CONNECTED', handleConnectionResult);
      this.once('ERROR', handleConnectionResult);

      this.updateStatus({ connecting: true });
      this.sendCommand(connectCommand);

      // Set timeout for connection attempt
      setTimeout(() => {
        if (this.status.connecting) {
          this.off('CONNECTED', handleConnectionResult);
          this.off('ERROR', handleConnectionResult);
          this.updateStatus({ connecting: false });
          reject(new Error('Connection timeout'));
        }
      }, 2000); // 2 second timeout
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  public disconnect(code?: number, reason?: string): void {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }

    const disconnectCommand: DisconnectCommand = {
      type: 'DISCONNECT',
      payload: { code, reason }
    };

    this.sendCommand(disconnectCommand);
  }

  /**
   * Send message through WebSocket
   */
  public sendMessage(data: string | ArrayBuffer | Blob): void {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }

    const sendCommand: SendMessageCommand = {
      type: 'SEND_MESSAGE',
      payload: { data }
    };

    this.sendCommand(sendCommand);
  }

  /**
   * Add event listener for WebSocket events
   */
  public addEventListener(eventType: string, handler: (event: WebSocketWorkerEvent) => void): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(handler);
  }

  /**
   * Remove event listener
   */
  public removeEventListener(eventType: string, handler: (event: WebSocketWorkerEvent) => void): void {
    const handlers = this.eventListeners.get(eventType);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventListeners.delete(eventType);
      }
    }
  }

  /**
   * Add one-time event listener
   */
  public once(eventType: string, handler: (event: WebSocketWorkerEvent) => void): void {
    const onceHandler = (event: WebSocketWorkerEvent) => {
      handler(event);
      this.removeEventListener(eventType, onceHandler);
    };
    this.addEventListener(eventType, onceHandler);
  }

  /**
   * Alias for removeEventListener
   */
  public off(eventType: string, handler: (event: WebSocketWorkerEvent) => void): void {
    this.removeEventListener(eventType, handler);
  }

  /**
   * Get current connection status
   */
  public getStatus(): WebSocketStatus {
    return { ...this.status };
  }

  /**
   * Check if WebSocket is connected
   */
  public isConnected(): boolean {
    return this.status.connected;
  }

  /**
   * Check if WebSocket is connecting
   */
  public isConnecting(): boolean {
    return this.status.connecting;
  }

  /**
   * Handle messages from the worker
   */
  private handleWorkerMessage(event: MessageEvent<WebSocketWorkerEvent>): void {
    const message = event.data;
    
    try {
      this.processWorkerMessage(message);
      this.emitEvent(message);
    } catch (error) {
      console.error('Error processing worker message:', error);
    }
  }

  /**
   * Handle worker errors
   */
  private handleWorkerError(error: ErrorEvent): void {
    const errorMessage = `Worker error: ${error.message}`;
    this.updateStatus({ lastError: errorMessage });
    
    const errorEvent: WebSocketWorkerEvent = {
      type: 'ERROR',
      payload: { error: errorMessage }
    };
    
    this.emitEvent(errorEvent);
  }

  /**
   * Process messages from worker and update status
   */
  private processWorkerMessage(message: WebSocketWorkerEvent): void {
    switch (message.type) {
      case 'CONNECTED':
        this.updateStatus({
          connected: true,
          connecting: false,
          reconnecting: false,
          readyState: message.payload.readyState,
          url: message.payload.url,
          reconnectAttempts: 0,
          lastError: null
        });
        break;

      case 'DISCONNECTED':
        this.updateStatus({
          connected: false,
          connecting: false,
          readyState: WebSocketState.CLOSED
        });
        break;

      case 'CONNECTION_STATE_CHANGED':
        this.updateStatus({
          readyState: message.payload.state
        });
        break;

      case 'ERROR':
        this.updateStatus({
          lastError: message.payload.error,
          connected: false,
          connecting: false
        });
        break;

      case 'MESSAGE_RECEIVED':
        // Message events don't update status
        break;

      default:
        console.warn('Unknown message type from worker:', (message as any).type);
    }
  }

  /**
   * Emit event to all registered listeners
   */
  private emitEvent(event: WebSocketWorkerEvent): void {
    const handlers = this.eventListeners.get(event.type);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(event);
        } catch (error) {
          console.error('Error in event handler:', error);
        }
      });
    }
  }

  /**
   * Send command to worker
   */
  private sendCommand(command: WebSocketWorkerCommand): void {
    if (!this.worker) {
      throw new Error('Worker not available');
    }

    this.worker.postMessage(command);
  }

  /**
   * Update internal status
   */
  private updateStatus(updates: Partial<WebSocketStatus>): void {
    this.status = { ...this.status, ...updates };
  }

  /**
   * Reset status to initial state
   */
  private resetStatus(): void {
    this.status = {
      connected: false,
      connecting: false,
      reconnecting: false,
      readyState: WebSocketState.CLOSED,
      url: null,
      reconnectAttempts: 0,
      lastError: null
    };
  }
}

/**
 * Factory function to create a WebSocketWorkerClient
 */
export function createWebSocketWorker(): WebSocketWorker {
  return new WebSocketWorker();
}