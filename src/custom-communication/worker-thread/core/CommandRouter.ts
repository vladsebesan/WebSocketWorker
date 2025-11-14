// CommandRouter - Routes commands to appropriate handlers
import type { IPIApiGenericCommand } from '../../shared/WorkerProtocol';
import type { MainThreadClient } from './MainThreadClient';
import type { MessageManager } from './MessageManager';
import type { Session } from './Session';

import { PIApiWorkerCommandType } from '../../shared/WorkerProtocol';

export class CommandRouter {
  constructor(
    private sessionManager: Session,
    private messageManager: MessageManager,
    private mainThreadClient: MainThreadClient,
  ) {}

  private async handleFlowGet(command: IPIApiGenericCommand): Promise<void> {
    // 1. Ensure session is ready
    await this.sessionManager.ensureAuthenticated();

    // 2. TODO: Build and send FlatBuffer request
    // 3. TODO: Map FlatBuffer reply to domain model
    // 4. Send back to main thread

    // For now, send mock data
    const mockFlowModel = {
      links: [],
      modules: [],
      state: { isRunning: false },
    };

    this.mainThreadClient.sendSuccess(command.requestId, mockFlowModel);
  }

  private async handleFlowSubscribe(command: IPIApiGenericCommand): Promise<void> {
    // TODO: Implement flow subscription
    await this.sessionManager.ensureAuthenticated();
    this.mainThreadClient.sendSuccess(command.requestId, null);
  }

  private async handleProcessingInstanceStatusGet(command: IPIApiGenericCommand): Promise<void> {
    // TODO: Implement processing instance status get
    await this.sessionManager.ensureAuthenticated();

    const mockStatus = {
      isRunning: true,
      statusInfos: [],
      systemLoad: 0.5,
    };

    this.mainThreadClient.sendSuccess(command.requestId, mockStatus);
  }

  public async route(command: IPIApiGenericCommand): Promise<void> {
    try {
      switch (command.type) {
        case PIApiWorkerCommandType.FLOW_GET:
          await this.handleFlowGet(command);
          break;
        case PIApiWorkerCommandType.FLOW_SUBSCRIBE:
          await this.handleFlowSubscribe(command);
          break;
        case PIApiWorkerCommandType.PROCESSING_INSTANCE_STATUS_GET:
          await this.handleProcessingInstanceStatusGet(command);
          break;
        // Add more command handlers as needed...
        default:
          throw new Error(`Unknown command type: ${command.type}`);
      }
    } catch (error) {
      this.mainThreadClient.sendError(command.requestId, {
        code: 'COMMAND_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
