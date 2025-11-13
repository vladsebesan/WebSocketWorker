
// Visibility flag
export enum Visibility {
  Hidden = 0, // Always hidden in the UI
  Normal = 1, // Normal: always visible in UI.
  Extended = 2, // Extended: only visible in UI if 'extended mode' is active.
}

export enum EnumFlowStartType {
  NEW_RUN = 2,
  REPEAT_RUN = 3,
  START = 1,
  STOP = 4,
  UNKNOWN = 0,
}

export interface IFlowStateDetails {
  flowStartType: EnumFlowStartType;
  isAbortAllowed: boolean;
  isNewRunAllowed: boolean;
  isRepeatRunAllowed: boolean;
  isStartAllowed: boolean;
  isStopAllowed: boolean;
}

export interface IFlowUpdate {
  addedLinks: IFlowModuleLink[];
  addedModules: IFlowModule[];
  changedModules: IFlowModule[];
  flowStateDetails: IFlowStateDetails;
  removedLinks: string[];
  removedModules: string[];
}

export interface IPort {
  displayName: string;
  displayNameSuffix: string;
  readonly id: string;
  isDisabled: boolean;
  isLinkable: boolean;
  name: string;
  visibility: Visibility;
}

export interface IFlowModule {
  displayName: string;
  readonly id: string;
  inputs: IPort[];
  isCurrentlyRunning: boolean;
  moduleType: string;
  readonly name: string;
  outputs: IPort[];
  version: string;
  X: number;
  Y: number;
}

export interface IFlowModuleLink {
  readonly id: string;
  inputId: string;
  outputId: string;
  sourceModuleId: string;
  targetModuleId: string;
}

export interface IFlowModel {
  flowStateDetails: IFlowStateDetails;
  links: IFlowModuleLink[];
  modules: IFlowModule[];
}


export interface IToolboxEntry {
  categoryName: string;
  description: string;
  iconUrl: string;
  readonly id: string;
  isLicensed: boolean;
  moduleName: string;
  moduleType: string;
  version: string;
}

export interface IToolboxModel {
  entries: IToolboxEntry[];
}

export interface IToolboxUpdate {
  addedEntries: IToolboxEntry[];
  removedEntries: string[];
  updatedEntries: IToolboxEntry[];
}