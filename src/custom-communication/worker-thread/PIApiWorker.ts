// PIApiWorker.ts - Main worker entry point (replaces ViewerChannelWorker)
import type { IPIApiError, IPIApiState } from '../shared/PIApiTypes';
import { PIApiWorkerResponseType, type IPIApiGenericCommand, type IPIApiWorkerResponse } from '../shared/WorkerProtocol';

import { PIApiWorkerCommandType } from '../shared/WorkerProtocol';
import { MessageManager } from './MessageManager';
import { Session } from './Session';
import { Transport } from './Transport';

/**
 * Main PIApi worker class - handles all communication with the PI backend
 * This replaces the ViewerChannelWorker but is much more sophisticated
 */
class PIApiWorker {
  private messageManager!: MessageManager;

  private handleMainThreadMessage = (event: MessageEvent): void => {
    const command = event.data as IPIApiGenericCommand;

    switch (command.type) {
      // Connection management (similar to your current ViewerChannelWorker)
      case PIApiWorkerCommandType.CONNECT:
        this.handleConnect(command);
        break;
      case PIApiWorkerCommandType.DISCONNECT:
        this.handleDisconnect(command);
        break;

      // All other PI API commands are routed through the command router
      default:
        break;
    }
  };

  private postToMainThread(response: IPIApiWorkerResponse): void {
    self.postMessage(response);
  }

  public sendError(requestId: string, error: IPIApiError): void {
    const response: IPIApiWorkerResponse = {
      error,
      requestId,
      type: PIApiWorkerResponseType.ERROR,
    };
    this.postToMainThread(response);
  }

  public sendNotification<T>(notificationType: PIApiWorkerResponseType, data: T): void {
    const response = {
      data,
      type: notificationType,
    };
    this.postToMainThread(response as IPIApiWorkerResponse);
  }

  public sendStateChange(state: IPIApiState): void {
    const response: IPIApiWorkerResponse = {
      state,
      type: PIApiWorkerResponseType.STATE_CHANGED,
    };
    this.postToMainThread(response);
  }

  public sendSuccess<T>(requestId: string, data: T): void {
    const response: IPIApiWorkerResponse = {
      data,
      requestId,
      type: PIApiWorkerResponseType.SUCCESS,
    };
    this.postToMainThread(response);
  }

  constructor() {
    this.messageManager = new MessageManager(new Session(new Transport()));
    self.addEventListener('message', this.handleMainThreadMessage);
  }

  private async handleConnect(command: IPIApiGenericCommand): Promise<void> {
    try {
      const config = (command.payload as any)?.config;
      if (!config) {
        throw new Error('Missing config in CONNECT command');
      }
      this.messageManager.connect(config);
      this.sendSuccess(command.requestId, null);
    } catch (error) {
      this.sendError(command.requestId, {
        code: 'CONNECTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleDisconnect(command: IPIApiGenericCommand): Promise<void> {
    try {
      this.messageManager.disconnect();
      this.sendSuccess(command.requestId, null);
    } catch (error) {
      this.sendError(command.requestId, {
        code: 'DISCONNECT_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// Auto-initialize when running in Web Worker context (like your current code)
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  const piApiWorker = new PIApiWorker();
  (self as any).__piApiWorker = piApiWorker; // Export for debugging (similar to your current __websocketWorker export)
}
