/* eslint-disable no-console */
// Main thread PIApi class - Clean, Promise-based public API


import { useEffect, useRef, useState } from 'react';

import type {
  IFlowModel,
  IJobCreateRequest,
  IJobDeleteRequest,
  IJobEditRequest,
  IJobEntry,
  IJobLoadRequest,
  IPersistenceModel,
  IProcessingInstanceStatus,
  ISnapshotCreateRequest,
  ISnapshotDeleteRequest,
  ISnapshotEditRequest,
  ISnapshotEntry,
  ISnapshotLoadRequest,
} from './shared/DomainModels';
import type {
  IPIApiConfig,
  IPIApiNotificationCallback,
  IPIApiState,
  IPIApiSubscription,
} from './shared/PIApiTypes';

import { PIApiWorkerClient } from './main-thread/PIApiWorkerClient';
import { PIApiWorkerCommandType } from './shared/WorkerProtocol';
import type { IWebSocketURL } from '../interfaces/IWebsocketUrl';

export class PIApi {
  private workerClient: PIApiWorkerClient;

  constructor(config: IPIApiConfig) {
    this.workerClient = new PIApiWorkerClient(config);
  }

  // Connection management
  public async connect(): Promise<void> {
    return this.workerClient.connect();
  }

  // Job Management API
  public async createJob(request: IJobCreateRequest): Promise<IJobEntry> {
    return this.workerClient.sendCommand(PIApiWorkerCommandType.JOB_CREATE, request);
  }

  // Snapshot Management API
  public async createSnapshot(request: ISnapshotCreateRequest): Promise<ISnapshotEntry> {
    return this.workerClient.sendCommand(PIApiWorkerCommandType.SNAPSHOT_CREATE, request);
  }

  public async deleteJob(request: IJobDeleteRequest): Promise<void> {
    return this.workerClient.sendCommand(PIApiWorkerCommandType.JOB_DELETE, request);
  }

  public async deleteSnapshot(request: ISnapshotDeleteRequest): Promise<void> {
    return this.workerClient.sendCommand(PIApiWorkerCommandType.SNAPSHOT_DELETE, request);
  }

  public async disconnect(): Promise<void> {
    return this.workerClient.disconnect();
  }

  // Resource cleanup
  public dispose(): void {
    this.workerClient.dispose();
  }

  public async editJob(request: IJobEditRequest): Promise<void> {
    return this.workerClient.sendCommand(PIApiWorkerCommandType.JOB_EDIT, request);
  }

  public async editSnapshot(request: ISnapshotEditRequest): Promise<void> {
    return this.workerClient.sendCommand(PIApiWorkerCommandType.SNAPSHOT_EDIT, request);
  }

  // Flow API
  public async getFlow(): Promise<IFlowModel> {
    return this.workerClient.sendCommand(PIApiWorkerCommandType.FLOW_GET);
  }

  // Persistence Model API
  public async getPersistenceModel(): Promise<IPersistenceModel> {
    return this.workerClient.sendCommand(PIApiWorkerCommandType.PERSISTENCE_MODEL_GET);
  }

  // Processing Instance Status API
  public async getProcessingInstanceStatus(): Promise<IProcessingInstanceStatus> {
    return this.workerClient.sendCommand(PIApiWorkerCommandType.PROCESSING_INSTANCE_STATUS_GET);
  }

  public getState(): IPIApiState {
    return this.workerClient.getState();
  }

  public async loadJob(request: IJobLoadRequest): Promise<void> {
    return this.workerClient.sendCommand(PIApiWorkerCommandType.JOB_LOAD, request);
  }

  public async loadSnapshot(request: ISnapshotLoadRequest): Promise<void> {
    return this.workerClient.sendCommand(PIApiWorkerCommandType.SNAPSHOT_LOAD, request);
  }

  public onStateChange(callback: IPIApiNotificationCallback<IPIApiState>): IPIApiSubscription {
    return this.workerClient.onStateChange(callback);
  }

  public subscribeToFlow(callback: IPIApiNotificationCallback<IFlowModel>): IPIApiSubscription {
    return this.workerClient.subscribeToNotifications(
      PIApiWorkerCommandType.FLOW_SUBSCRIBE,
      PIApiWorkerCommandType.FLOW_UNSUBSCRIBE,
      callback,
    );
  }

  public subscribeToPersistenceModel(
    callback: IPIApiNotificationCallback<IPersistenceModel>,
  ): IPIApiSubscription {
    return this.workerClient.subscribeToNotifications(
      PIApiWorkerCommandType.PERSISTENCE_MODEL_SUBSCRIBE,
      PIApiWorkerCommandType.PERSISTENCE_MODEL_UNSUBSCRIBE,
      callback,
    );
  }

  public subscribeToProcessingInstanceStatus(
    callback: IPIApiNotificationCallback<IProcessingInstanceStatus>,
  ): IPIApiSubscription {
    return this.workerClient.subscribeToNotifications(
      PIApiWorkerCommandType.PROCESSING_INSTANCE_STATUS_SUBSCRIBE,
      PIApiWorkerCommandType.PROCESSING_INSTANCE_STATUS_UNSUBSCRIBE,
      callback,
    );
  }
}

// Helper function to get WebSocket URL (similar to your current getWebsocketUrl)
const getPiSocketUrl = (): IWebSocketURL => {
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const protocol = isHttps ? 'wss:' : 'ws:';
  const hostname = window.location.hostname || 'localhost';
  const port = 9090;
  const url = `${protocol}//${hostname}:${port}/ws/`;
  return url as IWebSocketURL;
};

// React hook for using PIApi (similar to your current useViewerChannel)
export const usePIApi = (): PIApi => {
  const [piApi, setPiApi] = useState<PIApi | null>(null);
  const isInitialized = useRef(false);

  // Create on first use
  useEffect(() => {
    // Only initialize once
    if (!isInitialized.current) {
      isInitialized.current = true;
      
      const fullConfig: IPIApiConfig = {
        maxReconnectAttempts: 5,
        reconnectIntervalMs: 2000,
        sessionKeepaliveIntervalMs: 1000,
        url: getPiSocketUrl(),
      };

      const newPiApi = new PIApi(fullConfig);
      
      // Auto-connect like your current ViewerChannel
      newPiApi.connect().catch(() => {
        // Connection failed - the PIApi will handle retries internally
        // State changes will be available via piApi.onStateChange()
        console.error('Connection failed - the PIApi will handle retries internally');
      });

      setPiApi(newPiApi);
    }
  }, []); // Empty dependency array - only run once

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (piApi) {
        console.log('Disposing PIApi on unmount');
        piApi.dispose();
      }
    };
  }, [piApi]);

  return piApi!;
};