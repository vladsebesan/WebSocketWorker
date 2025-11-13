// Clean domain models that hide FlatBuffer complexity
// These interfaces represent the business data in a user-friendly way

// Flow domain models
export interface IFlowModel {
  links: IFlowLink[];
  modules: IFlowModule[];
  state: IFlowState;
}

export interface IFlowModule {
  displayName: string;
  id: string;
  inputPorts: IFlowPort[];
  isRunning: boolean;
  moduleType: string;
  name: string;
  outputPorts: IFlowPort[];
  position: IFlowPosition;
}

export interface IFlowPort {
  id: string;
  name: string;
  type: string;
}

export interface IFlowLink {
  id: string;
  sourceModuleId: string;
  sourcePortId: string;
  targetModuleId: string;
  targetPortId: string;
}

export interface IFlowPosition {
  x: number;
  y: number;
}

export interface IFlowState {
  isRunning: boolean;
  lastError?: string;
}

// Processing Instance Status domain models
export interface IProcessingInstanceStatus {
  isRunning: boolean;
  statusInfos: IStatusInfo[];
  systemLoad: number;
}

export interface IStatusInfo {
  level: SeverityLevel;
  message: string;
  timestamp: number;
}

export enum SeverityLevel {
  DEBUG = 'DEBUG',
  ERROR = 'ERROR',
  INFO = 'INFO',
  WARNING = 'WARNING',
}

// Persistence Model domain models
export interface IPersistenceModel {
  jobs: IJobEntry[];
  recordRuns: IRecordRunEntry[];
  records: IRecordEntry[];
  snapshots: ISnapshotEntry[];
}

export interface IJobEntry {
  createdAt: number;
  description: string;
  id: string;
  isActive: boolean;
  modifiedAt: number;
  name: string;
}

export interface ISnapshotEntry {
  createdAt: number;
  description: string;
  id: string;
  name: string;
}

export interface IRecordEntry {
  createdAt: number;
  description: string;
  durationMs: number;
  id: string;
  name: string;
  sizeBytes: number;
}

export interface IRecordRunEntry {
  createdAt: number;
  id: string;
  isCapturing: boolean;
  progress: IRecordCaptureProgress;
}

export interface IRecordCaptureProgress {
  capturedFrames: number;
  elapsedTimeMs: number;
  estimatedTotalFrames: number;
  isComplete: boolean;
}

// Job management domain models
export interface IJobCreateRequest {
  description?: string;
  name: string;
}

export interface IJobEditRequest {
  description?: string;
  id: string;
  name?: string;
}

export interface IJobLoadRequest {
  id: string;
}

export interface IJobDeleteRequest {
  id: string;
}

// Snapshot management domain models
export interface ISnapshotCreateRequest {
  description?: string;
  name: string;
}

export interface ISnapshotEditRequest {
  description?: string;
  id: string;
  name?: string;
}

export interface ISnapshotLoadRequest {
  id: string;
}

export interface ISnapshotDeleteRequest {
  id: string;
}
