import { WebSocketWorkerMessageType, WebSocketState } from './WebSocketWorker.js';
import type {
  WebSocketConfig,
  WebSocketStatus,
  WebSocketWorkerMessage,
  WebSocketWorkerCommand,
  ConnectCommand,
  DisconnectCommand,
  SendMessageCommand
} from './WebSocketWorker.js';

/**
 * WebSocketWorker class manages a WebSocket connection within a Web Worker.
 * It handles connection lifecycle, message sending/receiving, and automatic reconnection.
 */
export class WebSocketWorkerImpl {
  private websocket: WebSocket | null = null;
  private config: WebSocketConfig | null = null;
  private status: WebSocketStatus = {
    connected: false,
    connecting: false,
    reconnecting: false,
    readyState: WebSocketState.CLOSED,
    url: null,
    reconnectAttempts: 0,
    lastError: null
  };
  
  private reconnectTimer: number | null = null;
  private messageQueue: Array<{ data: string | ArrayBuffer | Blob }> = [];

  constructor() {
    this.handleMessage = this.handleMessage.bind(this);
    this.handleOpen = this.handleOpen.bind(this);
    this.handleClose = this.handleClose.bind(this);
    this.handleError = this.handleError.bind(this);
    this.handleWebSocketMessage = this.handleWebSocketMessage.bind(this);
  }

  /**
   * Initialize the WebSocket Worker
   */
  public init(): void {
    // Listen for messages from the main thread
    self.addEventListener('message', this.handleMessage);
    
    // Send initial status
    this.sendToMainThread({
      id: this.generateId(),
      type: WebSocketWorkerMessageType.CONNECTION_STATE_CHANGED,
      payload: {
        state: this.status.readyState,
        previousState: this.status.readyState
      },
      timestamp: Date.now()
    });
  }

  /**
   * Handle messages from the main thread
   */
  private handleMessage(event: MessageEvent<WebSocketWorkerCommand>): void {
    const { data: command } = event;

    try {
      switch (command.type) {
        case WebSocketWorkerMessageType.CONNECT:
          this.handleConnect(command as ConnectCommand);
          break;
        case WebSocketWorkerMessageType.DISCONNECT:
          this.handleDisconnect(command as DisconnectCommand);
          break;
        case WebSocketWorkerMessageType.SEND_MESSAGE:
          this.handleSendMessage(command as SendMessageCommand);
          break;
        default:
          this.sendError(`Unknown command type: ${(command as any).type}`);
      }
    } catch (error) {
      this.sendError(`Error handling command: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Handle connect command
   */
  private handleConnect(command: ConnectCommand): void {
    if (this.status.connected || this.status.connecting) {
      this.sendError('WebSocket is already connected or connecting');
      return;
    }

    const { url, protocols, options } = command.payload;
    
    this.config = {
      url,
      protocols,
      reconnect: options?.reconnect ?? true,
      reconnectInterval: options?.reconnectInterval ?? 3000,
      maxReconnectAttempts: options?.maxReconnectAttempts ?? 5
    };

    this.connect();
  }

  /**
   * Handle disconnect command
   */
  private handleDisconnect(command: DisconnectCommand): void {
    const { code = 1000, reason = 'Normal closure' } = command.payload || {};
    this.disconnect(code, reason);
  }

  /**
   * Handle send message command
   */
  private handleSendMessage(command: SendMessageCommand): void {
    const { data } = command.payload;

    if (!this.websocket || this.websocket.readyState !== WebSocketState.OPEN) {
      // Queue message if not connected
      this.messageQueue.push({ data });
      this.sendError('WebSocket is not connected. Message queued.');
      return;
    }

    try {
      this.websocket.send(data);
    } catch (error) {
      this.sendError(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Establish WebSocket connection
   */
  private connect(): void {
    if (!this.config) {
      this.sendError('No configuration provided');
      return;
    }

    this.updateStatus({ connecting: true, reconnecting: false });
    this.clearReconnectTimer();

    try {
      this.websocket = new WebSocket(this.config.url, this.config.protocols);
      this.websocket.addEventListener('open', this.handleOpen);
      this.websocket.addEventListener('close', this.handleClose);
      this.websocket.addEventListener('error', this.handleError);
      this.websocket.addEventListener('message', this.handleWebSocketMessage);

      this.updateStatus({
        url: this.config.url,
        readyState: this.websocket.readyState as WebSocketState
      });
    } catch (error) {
      this.handleConnectionError(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Disconnect WebSocket
   */
  private disconnect(code: number = 1000, reason: string = 'Normal closure'): void {
    this.clearReconnectTimer();
    this.config = null; // Prevent reconnection

    if (this.websocket) {
      this.websocket.removeEventListener('open', this.handleOpen);
      this.websocket.removeEventListener('close', this.handleClose);
      this.websocket.removeEventListener('error', this.handleError);
      this.websocket.removeEventListener('message', this.handleWebSocketMessage);

      if (this.websocket.readyState === WebSocketState.OPEN || 
          this.websocket.readyState === WebSocketState.CONNECTING) {
        this.websocket.close(code, reason);
      }

      this.websocket = null;
    }

    this.updateStatus({
      connected: false,
      connecting: false,
      reconnecting: false,
      readyState: WebSocketState.CLOSED,
      url: null
    });
  }

  /**
   * Handle WebSocket open event
   */
  private handleOpen(): void {
    this.updateStatus({
      connected: true,
      connecting: false,
      reconnecting: false,
      reconnectAttempts: 0,
      readyState: WebSocketState.OPEN,
      lastError: null
    });

    this.sendToMainThread({
      id: this.generateId(),
      type: WebSocketWorkerMessageType.CONNECTED,
      payload: {
        url: this.config?.url || '',
        readyState: WebSocketState.OPEN
      },
      timestamp: Date.now()
    });

    // Send queued messages
    this.processMessageQueue();
  }

  /**
   * Handle WebSocket close event
   */
  private handleClose(event: CloseEvent): void {
    const previousState = this.status.readyState;
    
    this.updateStatus({
      connected: false,
      connecting: false,
      readyState: WebSocketState.CLOSED
    });

    this.sendToMainThread({
      id: this.generateId(),
      type: WebSocketWorkerMessageType.DISCONNECTED,
      payload: {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean
      },
      timestamp: Date.now()
    });

    this.sendToMainThread({
      id: this.generateId(),
      type: WebSocketWorkerMessageType.CONNECTION_STATE_CHANGED,
      payload: {
        state: WebSocketState.CLOSED,
        previousState
      },
      timestamp: Date.now()
    });

    // Attempt reconnection if configured
    if (this.config?.reconnect && this.shouldReconnect()) {
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket error event
   */
  private handleError(): void {
    const error = 'WebSocket connection error occurred';
    this.handleConnectionError(error);
  }

  /**
   * Handle WebSocket message event
   */
  private handleWebSocketMessage(event: MessageEvent): void {
    this.sendToMainThread({
      id: this.generateId(),
      type: WebSocketWorkerMessageType.MESSAGE_RECEIVED,
      payload: {
        data: event.data,
        origin: event.origin
      },
      timestamp: Date.now()
    });
  }

  /**
   * Handle connection errors
   */
  private handleConnectionError(error: string): void {
    this.updateStatus({
      connected: false,
      connecting: false,
      lastError: error
    });

    this.sendError(error);

    if (this.config?.reconnect && this.shouldReconnect()) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (!this.config) return;

    this.updateStatus({
      reconnecting: true,
      reconnectAttempts: this.status.reconnectAttempts + 1
    });

    this.reconnectTimer = self.setTimeout(() => {
      if (this.config) {
        this.connect();
      }
    }, this.config.reconnectInterval);
  }

  /**
   * Check if reconnection should be attempted
   */
  private shouldReconnect(): boolean {
    return this.config !== null && 
           this.status.reconnectAttempts < (this.config.maxReconnectAttempts || 5);
  }

  /**
   * Clear reconnection timer
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      self.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Process queued messages
   */
  private processMessageQueue(): void {
    while (this.messageQueue.length > 0 && 
           this.websocket?.readyState === WebSocketState.OPEN) {
      const message = this.messageQueue.shift();
      if (message) {
        try {
          this.websocket.send(message.data);
        } catch (error) {
          this.sendError(`Failed to send queued message: ${error instanceof Error ? error.message : String(error)}`);
          break;
        }
      }
    }
  }

  /**
   * Update internal status
   */
  private updateStatus(updates: Partial<WebSocketStatus>): void {
    const previousState = this.status.readyState;
    this.status = { ...this.status, ...updates };

    if (updates.readyState !== undefined && updates.readyState !== previousState) {
      this.sendToMainThread({
        id: this.generateId(),
        type: WebSocketWorkerMessageType.CONNECTION_STATE_CHANGED,
        payload: {
          state: updates.readyState,
          previousState
        },
        timestamp: Date.now()
      });
    }
  }

  /**
   * Send message to main thread
   */
  private sendToMainThread(message: WebSocketWorkerMessage): void {
    self.postMessage(message);
  }

  /**
   * Send error message to main thread
   */
  private sendError(error: string): void {
    this.sendToMainThread({
      id: this.generateId(),
      type: WebSocketWorkerMessageType.ERROR,
      payload: { error },
      timestamp: Date.now()
    });
  }

  /**
   * Generate unique message ID
   */
  private generateId(): string {
    return `ws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get current status
   */
  public getStatus(): WebSocketStatus {
    return { ...this.status };
  }
}

// Auto-initialize when running in a Web Worker context
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  const websocketWorker = new WebSocketWorkerImpl();
  websocketWorker.init();
  
  // Export for potential debugging (optional)
  (self as any).__websocketWorker = websocketWorker;
}