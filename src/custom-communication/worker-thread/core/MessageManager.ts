// MessageManager - Handles request/reply correlation and message parsing
import type { MainThreadClient } from './MainThreadClient';
import type { TransportLayer } from './TransportLayer';

interface IPendingRequest {
  reject: (error: Error) => void;
  resolve: (data: unknown) => void;
  timeout: NodeJS.Timeout;
}

export class MessageManager {
  private nextRequestId = 1;
  private pendingRequests = new Map<string, IPendingRequest>();

  constructor(/*session: SessionManager*/) {
    //private mainThreadClient: MainThreadClient, //private transportLayer: TransportLayer,
  }

  public cancelAllPendingRequests(): void {
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
  }

  public generateRequestId(): string {
    return `req_${this.nextRequestId++}`;
  }

  public handleIncomingMessage(buffer: ArrayBuffer): void {
    // TODO: Implement FlatBuffers message parsing
    // For now, just log that we received a message
    console.log('MessageManager: Received message of size:', buffer.byteLength);
  }

  public async sendRequest<T>(requestBuffer: ArrayBuffer): Promise<T> {
    const requestId = this.generateRequestId();

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
      //this.transportLayer.send(requestBuffer);
    });
  }
}
