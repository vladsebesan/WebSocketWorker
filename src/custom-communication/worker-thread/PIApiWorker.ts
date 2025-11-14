// PIApiWorker.ts - Main worker entry point (replaces ViewerChannelWorker)
import type { IPIApiGenericCommand, IPIApiWorkerResponse } from '../shared/WorkerProtocol';

import { PIApiWorkerCommandType, PIApiWorkerResponseType } from '../shared/WorkerProtocol';
import { CommandRouter } from './core/CommandRouter';
import { MainThreadClient } from './core/MainThreadClient';
import { MessageManager } from './core/MessageManager';
import { Session } from './core/Session';
import { Transport } from './core/Transport';

/**
 * Main PIApi worker class - handles all communication with the PI backend
 * This replaces the ViewerChannelWorker but is much more sophisticated
 */
class PIApiWorker {
  private commandRouter!: CommandRouter;
  private handleConnectionStateChange = (state: any): void => {
    // Notify main thread of connection state changes
    this.mainThreadClient.sendStateChange(state);

    // Handle session management based on connection state
    if (state === 'CONNECTED') {
      // Connection established - session manager can create sessions
    } else if (state === 'DISCONNECTED') {
      // Handle cleanup, reset session state
      this.sessionManager.handleDisconnection();
    }
  };

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
        this.commandRouter.route(command);
        break;
    }
  };

  private handleWebSocketMessage = (buffer: ArrayBuffer): void => {
    // Pass WebSocket messages to the message manager for processing
    this.messageManager.handleIncomingMessage(buffer);
  };

  private mainThreadClient!: MainThreadClient;
  private messageManager!: MessageManager;
  private sessionManager!: Session;
  //private transportLayer!: TransportLayer;

  constructor() {
    this.initializeComponents();
    this.setupMessageHandling();
  }

  private async handleConnect(command: IPIApiGenericCommand): Promise<void> {
    try {
      const config = (command.payload as any)?.config;
      if (!config) {
        throw new Error('Missing config in CONNECT command');
      }

      this.sessionManager.connect(config);

      //await this.transportLayer.connect(config.url); // Connection successful - session manager can now create session when needed

      this.mainThreadClient.sendSuccess(command.requestId, null);
    } catch (error) {
      this.mainThreadClient.sendError(command.requestId, {
        code: 'CONNECTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleDisconnect(command: IPIApiGenericCommand): Promise<void> {
    try {
      this.transportLayer.disconnect();
      this.sessionManager.reset();
      this.messageManager.cancelAllPendingRequests();

      this.mainThreadClient.sendSuccess(command.requestId, null);
    } catch (error) {
      this.mainThreadClient.sendError(command.requestId, {
        code: 'DISCONNECT_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private initializeComponents(): void {
    // Initialize core components in the right order
    this.mainThreadClient = new MainThreadClient();
    this.sessionManager = new Session(new Transport());
    this.messageManager = new MessageManager(/*this.sessionManager*/);
    this.commandRouter = new CommandRouter(this.sessionManager, this.messageManager, this.mainThreadClient);

    // Setup event handlers
    //    this.transportLayer.onMessage = this.handleWebSocketMessage;
    //this.transportLayer.onStateChange = this.handleConnectionStateChange;
  }

  private setupMessageHandling(): void {
    // Listen for commands from main thread
    self.addEventListener('message', this.handleMainThreadMessage);
  }
}

// Auto-initialize when running in Web Worker context (like your current code)
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  const piApiWorker = new PIApiWorker();

  // Export for debugging (similar to your current __websocketWorker export)
  (self as any).__piApiWorker = piApiWorker;
}
