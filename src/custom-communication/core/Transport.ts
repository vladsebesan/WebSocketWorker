/* eslint-disable no-console */

export interface ITransport {
  connect(url: string): void;
  disconnect(): void;
  onConnected: (() => void) | null;
  onDisconnected: (() => void) | null;
  onError: ((error: Error) => void) | null;
  onMessage: ((buffer: Uint8Array) => void) | null;
  send(buffer: Uint8Array): void;
}

export class Transport implements ITransport {
  private websocket: null | WebSocket = null;

  public onConnected: (() => void) | null = null;

  public onDisconnected: (() => void) | null = null;

  public onError: ((error: Error) => void) | null = null;

  public onMessage: ((buffer: Uint8Array) => void) | null = null;

  private onWsClosed(): void {
    // TODO: AI: Remove console.log from production code
    console.log('TransportLayer connection closed');
    this.websocket = null;
    if (this.onDisconnected) {
      this.onDisconnected();
    }
  }

  private onWsError(event: Event): void {
    // TODO: AI: Type safety - avoid using 'as any'
    const errorMessage = `WebSocket error: ${(event as any)?.type || 'unknown'}`;
    // TODO: AI: Remove console.log from production code
    console.log(`TransportLayer connection error: ${errorMessage}`);
    if (this.onError) {
      this.onError(new Error(errorMessage));
    }
  }

  private onWsOpened(): void {
    if (this.onConnected) {
      this.onConnected();
    }
  }

  private onWsReceived(event: MessageEvent<ArrayBuffer>): void {
    if (this.onMessage && event.data) {
      this.onMessage(new Uint8Array(event.data));
    }
  }

  // TODO: AI: PERFORMANCE ISSUE - Creates new bound functions on every connect() call instead of reusing them.
  // This causes minor GC pressure on reconnection. Consider binding once in constructor and storing references.
  // Current: .bind(this) creates new function on each reconnect
  // Better: Store bound functions as class properties
  public connect(url: string): void {
    if (this.websocket) {
      this.disconnect();
    }
    this.websocket = new WebSocket(url);
    this.websocket.binaryType = 'arraybuffer';
    this.websocket.onopen = this.onWsOpened.bind(this);
    this.websocket.onerror = this.onWsError.bind(this);
    this.websocket.onclose = this.onWsClosed.bind(this);
    this.websocket.onmessage = this.onWsReceived.bind(this);
  }

  public disconnect(): void {
    if (this.websocket) {
      this.websocket.onopen = null;
      this.websocket.onclose = null;
      this.websocket.onmessage = null;
      this.websocket.onerror = null;
      this.websocket.close();
      this.websocket = null;
    }
  }

  public send(buffer: Uint8Array): void {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(buffer);
    } else {
      throw new Error('WebSocket not connected');
    }
  }
}
