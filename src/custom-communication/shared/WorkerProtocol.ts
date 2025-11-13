// Message protocol between main thread and worker thread

import type { IPIApiConfig, IPIApiError, IPIApiState } from './PIApiTypes';

// Commands sent from main thread to worker
export enum PIApiWorkerCommandType {
  // Connection management
  CONNECT = 'CONNECT',
  DISCONNECT = 'DISCONNECT',

  // Flow API
  FLOW_GET = 'FLOW_GET',
  FLOW_SUBSCRIBE = 'FLOW_SUBSCRIBE',
  FLOW_UNSUBSCRIBE = 'FLOW_UNSUBSCRIBE',

  // Job management
  JOB_CREATE = 'JOB_CREATE',
  JOB_DELETE = 'JOB_DELETE',
  JOB_EDIT = 'JOB_EDIT',
  JOB_LOAD = 'JOB_LOAD',

  // Persistence Model API
  PERSISTENCE_MODEL_GET = 'PERSISTENCE_MODEL_GET',
  PERSISTENCE_MODEL_SUBSCRIBE = 'PERSISTENCE_MODEL_SUBSCRIBE',
  PERSISTENCE_MODEL_UNSUBSCRIBE = 'PERSISTENCE_MODEL_UNSUBSCRIBE',

  // Processing Instance Status API
  PROCESSING_INSTANCE_STATUS_GET = 'PROCESSING_INSTANCE_STATUS_GET',
  PROCESSING_INSTANCE_STATUS_SUBSCRIBE = 'PROCESSING_INSTANCE_STATUS_SUBSCRIBE',
  PROCESSING_INSTANCE_STATUS_UNSUBSCRIBE = 'PROCESSING_INSTANCE_STATUS_UNSUBSCRIBE',

  // Snapshot management
  SNAPSHOT_CREATE = 'SNAPSHOT_CREATE',
  SNAPSHOT_DELETE = 'SNAPSHOT_DELETE',
  SNAPSHOT_EDIT = 'SNAPSHOT_EDIT',
  SNAPSHOT_LOAD = 'SNAPSHOT_LOAD',

  // Add more as needed...
}

// Base command interface
export interface IPIApiWorkerCommandBase {
  requestId: string;
  type: PIApiWorkerCommandType;
}

// Connection commands
export interface IPIApiConnectCommand extends IPIApiWorkerCommandBase {
  config: IPIApiConfig;
  type: PIApiWorkerCommandType.CONNECT;
}

export interface IPIApiDisconnectCommand extends IPIApiWorkerCommandBase {
  type: PIApiWorkerCommandType.DISCONNECT;
}

// Flow commands
export interface IPIApiFlowGetCommand extends IPIApiWorkerCommandBase {
  type: PIApiWorkerCommandType.FLOW_GET;
}

export interface IPIApiFlowSubscribeCommand extends IPIApiWorkerCommandBase {
  type: PIApiWorkerCommandType.FLOW_SUBSCRIBE;
}

// Generic command for commands with payloads
export interface IPIApiGenericCommand extends IPIApiWorkerCommandBase {
  payload?: unknown;
  type: PIApiWorkerCommandType;
}

// Union type of all commands
export type IPIApiWorkerCommand =
  | IPIApiConnectCommand
  | IPIApiDisconnectCommand
  | IPIApiFlowGetCommand
  | IPIApiFlowSubscribeCommand
  | IPIApiGenericCommand;

// Responses sent from worker to main thread
export enum PIApiWorkerResponseType {
  // Command responses
  ERROR = 'ERROR',

  // Data notifications
  FLOW_NOTIFICATION = 'FLOW_NOTIFICATION',
  PERSISTENCE_MODEL_NOTIFICATION = 'PERSISTENCE_MODEL_NOTIFICATION',
  PROCESSING_INSTANCE_STATUS_NOTIFICATION = 'PROCESSING_INSTANCE_STATUS_NOTIFICATION',

  // State notifications
  STATE_CHANGED = 'STATE_CHANGED',
  SUCCESS = 'SUCCESS',
}

// Base response interface
export interface IPIApiWorkerResponseBase {
  requestId?: string; // null for notifications
  type: PIApiWorkerResponseType;
}

// Success response
export interface IPIApiWorkerSuccessResponse<T = unknown> extends IPIApiWorkerResponseBase {
  data: T;
  type: PIApiWorkerResponseType.SUCCESS;
}

// Error response
export interface IPIApiWorkerErrorResponse extends IPIApiWorkerResponseBase {
  error: IPIApiError;
  type: PIApiWorkerResponseType.ERROR;
}

// State change notification
export interface IPIApiWorkerStateChangedResponse extends IPIApiWorkerResponseBase {
  requestId?: undefined;
  state: IPIApiState;
  type: PIApiWorkerResponseType.STATE_CHANGED;
}

// Data notifications
export interface IPIApiWorkerNotificationResponse<T = unknown> extends IPIApiWorkerResponseBase {
  data: T;
  requestId?: undefined;
  type:
    | PIApiWorkerResponseType.FLOW_NOTIFICATION
    | PIApiWorkerResponseType.PERSISTENCE_MODEL_NOTIFICATION
    | PIApiWorkerResponseType.PROCESSING_INSTANCE_STATUS_NOTIFICATION;
}

// Union type of all responses
export type IPIApiWorkerResponse =
  | IPIApiWorkerErrorResponse
  | IPIApiWorkerNotificationResponse
  | IPIApiWorkerStateChangedResponse
  | IPIApiWorkerSuccessResponse;
